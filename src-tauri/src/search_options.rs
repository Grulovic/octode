use crate::{git_tools, search_core};
use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::atomic::AtomicBool,
};
#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Options {
    #[serde(default)]
    pub regex: bool,
    #[serde(default)]
    pub exclusions: Vec<String>,
    #[serde(default = "yes")]
    pub respect_gitignore: bool,
}
fn yes() -> bool {
    true
}
pub fn matcher(query: &str, case: bool, regex: bool) -> Result<Regex, String> {
    RegexBuilder::new(&if regex {
        query.to_string()
    } else {
        regex::escape(query)
    })
    .case_insensitive(!case)
    .size_limit(1024 * 1024)
    .build()
    .map_err(|error| format!("Invalid search pattern: {error}"))
}
pub fn search(
    roots: &[PathBuf],
    query: &str,
    mode: search_core::Mode,
    cancel: &AtomicBool,
    options: Option<Options>,
) -> Result<search_core::Results, String> {
    let options = options.unwrap_or(Options {
        respect_gitignore: true,
        ..Default::default()
    });
    if options.exclusions.len() > 30 {
        return Err("Use at most 30 exclusion patterns".into());
    }
    let patterns = options
        .exclusions
        .iter()
        .filter(|pattern| !pattern.is_empty())
        .map(|pattern| glob(pattern))
        .collect::<Result<Vec<_>, _>>()?;
    let mut known = Vec::new();
    if options.respect_gitignore {
        for root in roots {
            if let Some(paths) = git_tools::search_paths(root)? {
                known.push((root.clone(), paths));
            }
        }
    }
    let include = |path: &Path, _directory: bool| {
        if known
            .iter()
            .any(|(root, paths)| path.starts_with(root) && !paths.contains(path))
        {
            return false;
        }
        let relative = roots
            .iter()
            .find_map(|root| path.strip_prefix(root).ok())
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/");
        !patterns.iter().any(|pattern| pattern.is_match(&relative))
    };
    let case = matches!(mode, search_core::Mode::Text { match_case: true });
    let matcher = if options.regex {
        Some(matcher(query, case, true)?)
    } else {
        None
    };
    let text_matches = |line: &str| {
        matcher
            .as_ref()
            .is_some_and(|matcher| matcher.is_match(line))
    };
    Ok(search_core::search_filtered(
        roots,
        query,
        mode,
        cancel,
        matcher
            .as_ref()
            .map(|_| &text_matches as &dyn Fn(&str) -> bool),
        Some(&include),
    ))
}
fn glob(pattern: &str) -> Result<Regex, String> {
    if pattern.len() > 256 {
        return Err("Exclusion patterns must be under 256 characters".into());
    }
    let mut expression = String::from("(?:^|/)");
    let mut chars = pattern.trim_matches('/').chars().peekable();
    while let Some(character) = chars.next() {
        match character {
            '*' => {
                if chars.peek() == Some(&'*') {
                    chars.next();
                    if chars.peek() == Some(&'/') {
                        chars.next();
                        expression.push_str("(?:.*/)?");
                    } else {
                        expression.push_str(".*");
                    }
                } else {
                    expression.push_str("[^/]*");
                }
            }
            '?' => expression.push_str("[^/]"),
            other => expression.push_str(&regex::escape(&other.to_string())),
        }
    }
    expression.push_str("(?:/|$)");
    Regex::new(&expression).map_err(|_| "Invalid exclusion pattern".into())
}
#[derive(Serialize)]
pub struct Replacement {
    pub path: String,
    pub before: String,
    pub after: String,
    pub count: usize,
}
#[derive(Deserialize)]
pub struct ApplyReplacement {
    pub path: String,
    pub before: String,
    pub after: String,
}
#[derive(Serialize)]
pub struct Applied {
    pub path: String,
    pub error: Option<String>,
}
pub fn preview(
    roots: &[PathBuf],
    query: &str,
    replacement: &str,
    match_case: bool,
    options: Options,
) -> Result<Vec<Replacement>, String> {
    if query.is_empty() || query.len() > 1024 || replacement.len() > 8192 {
        return Err("Enter a bounded search pattern and replacement".into());
    }
    let regex = matcher(query, match_case, options.regex)?;
    let literal = !options.regex;
    let result = search(
        roots,
        query,
        search_core::Mode::Text { match_case },
        &AtomicBool::new(false),
        Some(options),
    )?;
    if result.truncated {
        return Err("More than 200 matching lines. Narrow the search before replacing.".into());
    }
    let files = result
        .matches
        .into_iter()
        .map(|item| item.path)
        .collect::<std::collections::BTreeSet<_>>();
    let mut total = 0;
    let mut changes = Vec::new();
    for path in files {
        let before = crate::file_core::read(Path::new(&path))?;
        total += before.len();
        if total > 8 * 1024 * 1024 {
            return Err("Replacement preview exceeds 8 MB. Narrow the search.".into());
        }
        let count = regex.find_iter(&before).count();
        let after = if literal {
            regex
                .replace_all(&before, regex::NoExpand(replacement))
                .into_owned()
        } else {
            regex.replace_all(&before, replacement).into_owned()
        };
        if before != after {
            changes.push(Replacement {
                path,
                before,
                after,
                count,
            });
        }
    }
    Ok(changes)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounded_regex_and_exclusion_patterns() {
        assert!(matcher("(", false, true).is_err());
        assert!(matcher("user_[0-9]+", true, true)
            .unwrap()
            .is_match("user_42"));
        assert!(glob("**/*.log").unwrap().is_match("app/error.log"));
        assert!(glob("tests").unwrap().is_match("src/tests/a.php"));
        assert!(!glob("tests").unwrap().is_match("src/testsmith.php"));
    }
    #[test]
    fn replacement_preview_respects_gitignore_and_preserves_literal_dollars() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir(&root).unwrap();
        let root = root.canonicalize().unwrap();
        std::process::Command::new("git")
            .arg("-C")
            .arg(&root)
            .args(["init", "-q"])
            .status()
            .unwrap();
        std::fs::write(root.join(".gitignore"), "ignored.php\n").unwrap();
        std::fs::write(root.join("file.php"), "one one").unwrap();
        std::fs::write(root.join("ignored.php"), "one").unwrap();
        let changes = preview(
            std::slice::from_ref(&root),
            "one",
            "$value",
            true,
            Options {
                respect_gitignore: true,
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].after, "$value $value");
        assert_eq!(changes[0].count, 2);
        std::fs::remove_dir_all(root).unwrap();
    }
}
