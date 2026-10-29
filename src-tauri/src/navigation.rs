use serde::Serialize;
use std::{
    fs,
    path::Path,
    time::{Duration, Instant},
};
#[derive(Serialize)]
pub struct Target {
    pub path: String,
    pub line: usize,
    pub label: String,
    pub preview: String,
}
#[derive(Serialize)]
pub struct Targets {
    pub targets: Vec<Target>,
    pub truncated: bool,
}
// A bounded declaration finder, deliberately independent of autocomplete/language servers.
pub fn find(roots: &[String], source: &Path, query: &str) -> Result<Targets, String> {
    if query.is_empty() || query.len() > 256 {
        return Err("Select a symbol or file path".into());
    }
    let mut result = Targets {
        targets: Vec::new(),
        truncated: false,
    };
    if query.contains('/') || query.contains('.') {
        let parent = source.parent().ok_or("File has no parent")?;
        for base in [
            parent.to_path_buf(),
            roots
                .iter()
                .find(|root| source.starts_with(root))
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|| parent.to_path_buf()),
        ] {
            for suffix in [
                "",
                ".ts",
                ".tsx",
                ".js",
                ".jsx",
                ".php",
                ".json",
                "/index.ts",
                "/index.tsx",
                "/index.js",
            ] {
                let path = base.join(format!("{query}{suffix}"));
                if let Ok(path) = path.canonicalize() {
                    if roots.iter().any(|root| path.starts_with(root)) && path.is_file() {
                        result.targets.push(Target {
                            path: path.to_string_lossy().into(),
                            line: 1,
                            label: query.into(),
                            preview: "File reference".into(),
                        });
                    }
                }
            }
        }
        result.targets.sort_by(|a, b| a.path.cmp(&b.path));
        result.targets.dedup_by(|a, b| a.path == b.path);
        if !result.targets.is_empty() {
            return Ok(result);
        }
    }
    let symbol = query
        .rsplit(['\\', ':', '.'])
        .find(|part| !part.is_empty())
        .unwrap_or(query);
    if !symbol
        .chars()
        .all(|c| c.is_alphanumeric() || c == '_' || c == '$')
    {
        return Ok(result);
    }
    let started = Instant::now();
    let mut dirs = roots
        .iter()
        .map(std::path::PathBuf::from)
        .collect::<Vec<_>>();
    let mut files = 0;
    let mut bytes = 0;
    while let Some(dir) = dirs.pop() {
        let Ok(entries) = fs::read_dir(dir) else {
            continue;
        };
        for entry in entries.flatten() {
            if files >= 5000
                || bytes > 32 * 1024 * 1024
                || started.elapsed() > Duration::from_secs(3)
                || result.targets.len() >= 100
            {
                result.truncated = true;
                break;
            }
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            let path = entry.path();
            if kind.is_symlink() {
                continue;
            }
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if kind.is_dir() {
                if ![
                    ".git",
                    "node_modules",
                    "vendor",
                    "target",
                    "dist",
                    "build",
                    ".tools",
                    ".next",
                    ".idea",
                ]
                .contains(&name.as_ref())
                {
                    dirs.push(path);
                }
                continue;
            }
            if !["php", "ts", "tsx", "js", "jsx", "mjs", "rs", "py"].contains(
                &path
                    .extension()
                    .and_then(|s| s.to_str())
                    .unwrap_or_default(),
            ) {
                continue;
            }
            files += 1;
            let Ok(metadata) = entry.metadata() else {
                continue;
            };
            if metadata.len() > 1024 * 1024 {
                continue;
            }
            bytes += metadata.len();
            let Ok(text) = fs::read_to_string(&path) else {
                continue;
            };
            for line in declarations(&text, symbol) {
                result.targets.push(Target {
                    path: path.to_string_lossy().into(),
                    line,
                    label: symbol.into(),
                    preview: text
                        .lines()
                        .nth(line - 1)
                        .unwrap_or_default()
                        .chars()
                        .take(180)
                        .collect(),
                });
            }
        }
        if result.truncated {
            break;
        }
    }
    result.targets.sort_by_key(|target| {
        (
            target.path != source.to_string_lossy(),
            target.path.clone(),
            target.line,
        )
    });
    result
        .targets
        .dedup_by(|a, b| a.path == b.path && a.line == b.line);
    Ok(result)
}
fn declarations(text: &str, symbol: &str) -> Vec<usize> {
    let mut words = Vec::<(String, usize)>::new();
    let mut token = String::new();
    let mut line = 1;
    let mut token_line = 1;
    let mut chars = text.chars().peekable();
    let mut block = false;
    let mut quote = None;
    while let Some(c) = chars.next() {
        if c == '\n' {
            line += 1;
        }
        if block {
            if c == '*' && chars.peek() == Some(&'/') {
                chars.next();
                block = false;
            }
            continue;
        }
        if let Some(q) = quote {
            if c == '\\' {
                chars.next();
            } else if c == q {
                quote = None;
            }
            continue;
        }
        if c == '/' && chars.peek() == Some(&'*') {
            chars.next();
            block = true;
            continue;
        }
        if c == '/' && chars.peek() == Some(&'/') {
            for c in chars.by_ref() {
                if c == '\n' {
                    line += 1;
                    break;
                }
            }
            continue;
        }
        if c == '\'' || c == '"' || c == '`' {
            quote = Some(c);
            continue;
        }
        if c.is_alphanumeric() || c == '_' || c == '$' {
            if token.is_empty() {
                token_line = line;
            }
            token.push(c);
        } else if !token.is_empty() {
            words.push((std::mem::take(&mut token), token_line));
        }
    }
    if !token.is_empty() {
        words.push((token, token_line));
    }
    words
        .windows(2)
        .filter_map(|pair| {
            ([
                "class",
                "trait",
                "interface",
                "enum",
                "function",
                "fn",
                "def",
                "type",
                "const",
                "let",
                "var",
            ]
            .contains(&pair[0].0.as_str())
                && pair[1].0 == symbol)
                .then_some(pair[1].1)
        })
        .collect()
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn finds_declarations_without_matching_comments_strings_or_usages() {
        let text="// function hello() {}\nconst text = 'function hello';\nfunction hello() {}\nhello();\n/* class hello {} */\nclass Thing {}\n";
        assert_eq!(declarations(text, "hello"), vec![3]);
        assert_eq!(declarations(text, "Thing"), vec![6]);
    }
    #[test]
    fn resolves_relative_imports_and_project_declarations() {
        let directory = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        fs::create_dir_all(directory.join("src")).unwrap();
        let directory = directory.canonicalize().unwrap();
        let source = directory.join("index.php");
        fs::write(&source, "<?php greet();").unwrap();
        fs::write(
            directory.join("src/Greeting.php"),
            "<?php\nfunction greet() { return 'hi'; }\n",
        )
        .unwrap();
        let roots = vec![directory.to_string_lossy().into_owned()];
        let symbol = find(&roots, &source, "greet").unwrap();
        assert_eq!(symbol.targets.len(), 1);
        assert_eq!(symbol.targets[0].line, 2);
        let file = find(&roots, &source, "./src/Greeting").unwrap();
        assert_eq!(file.targets.len(), 1);
        assert_eq!(file.targets[0].line, 1);
        assert!(find(&roots, &source, "../../etc/passwd")
            .unwrap()
            .targets
            .is_empty());
        fs::remove_dir_all(directory).unwrap();
    }
}
