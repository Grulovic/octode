//! Bounded, cancellable search without runtime or desktop dependencies.
//! Run its tests independently with `rustc --test src-tauri/src/search_core.rs`.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

const IGNORED: &[&str] = &[
    ".git",
    "node_modules",
    "vendor",
    "dist",
    "build",
    "target",
    ".next",
    ".nuxt",
    ".idea",
    ".tools",
    "coverage",
    "storage",
];
const MAX_FILES: usize = 50_000;
const MAX_FILE_BYTES: u64 = 1024 * 1024;
const MAX_RESULTS: usize = 200;

pub enum Mode {
    Files,
    Text { match_case: bool },
}

#[derive(Debug)]
pub struct FileMatch {
    pub path: String,
    pub relative: String,
    pub root: String,
}

#[derive(Debug)]
pub struct TextMatch {
    pub path: String,
    pub relative: String,
    pub line: usize,
    pub preview: String,
}

#[derive(Default, Debug)]
pub struct Results {
    pub files: Vec<FileMatch>,
    pub matches: Vec<TextMatch>,
    pub truncated: bool,
    pub cancelled: bool,
    pub skipped: usize,
    pub warnings: Vec<String>,
}

#[cfg(test)]
pub fn search(roots: &[PathBuf], query: &str, mode: Mode, cancel: &AtomicBool) -> Results {
    search_filtered(roots, query, mode, cancel, None, None)
}
type IncludePath<'a> = dyn Fn(&Path, bool) -> bool + 'a;
pub fn search_filtered(
    roots: &[PathBuf],
    query: &str,
    mode: Mode,
    cancel: &AtomicBool,
    text_match: Option<&dyn Fn(&str) -> bool>,
    include: Option<&IncludePath<'_>>,
) -> Results {
    let mut results = Results::default();
    let query = query.trim();
    if query.is_empty() && matches!(mode, Mode::Text { .. }) {
        return results;
    }
    let normalized = query.to_lowercase();
    let mut visited = 0;
    let mut seen = std::collections::HashSet::new();
    for root in roots {
        let mut directories = vec![(root.clone(), 0_u8)];
        while let Some((directory, depth)) = directories.pop() {
            if cancel.load(Ordering::Relaxed) {
                results.cancelled = true;
                return results;
            }
            let entries = match fs::read_dir(&directory) {
                Ok(entries) => entries,
                Err(error) => {
                    results.skipped += 1;
                    if results.warnings.len() < 5 {
                        results
                            .warnings
                            .push(format!("{}: {error}", directory.display()));
                    }
                    continue;
                }
            };
            for entry in entries {
                if cancel.load(Ordering::Relaxed) {
                    results.cancelled = true;
                    return results;
                }
                let entry = match entry {
                    Ok(entry) => entry,
                    Err(_) => {
                        results.skipped += 1;
                        continue;
                    }
                };
                visited += 1;
                if visited > MAX_FILES {
                    results.truncated = true;
                    return results;
                }
                let kind = match entry.file_type() {
                    Ok(kind) => kind,
                    Err(_) => {
                        results.skipped += 1;
                        continue;
                    }
                };
                let path = entry.path();
                if include.is_some_and(|include| !include(&path, kind.is_dir())) {
                    continue;
                }
                if kind.is_dir() {
                    if IGNORED.iter().any(|name| entry.file_name() == *name) {
                        continue;
                    }
                    if depth >= 32 {
                        results.skipped += 1;
                        continue;
                    }
                    directories.push((path, depth + 1));
                    continue;
                }
                // Do not follow symlinks into folders outside the project or into cycles.
                if !kind.is_file() || !seen.insert(path.clone()) {
                    continue;
                }
                let relative = path
                    .strip_prefix(root)
                    .unwrap_or(&path)
                    .to_string_lossy()
                    .replace('\\', "/");
                match mode {
                    Mode::Files => {
                        let candidate = relative.to_lowercase();
                        if normalized
                            .split_whitespace()
                            .all(|part| candidate.contains(part))
                        {
                            results.files.push(FileMatch {
                                path: path.to_string_lossy().into_owned(),
                                relative,
                                root: root.to_string_lossy().into_owned(),
                            });
                        }
                    }
                    Mode::Text { match_case } => {
                        let Some(text) = read_text(&path) else {
                            results.skipped += 1;
                            continue;
                        };
                        for (line, content) in text.lines().enumerate() {
                            if cancel.load(Ordering::Relaxed) {
                                results.cancelled = true;
                                return results;
                            }
                            let found = if let Some(matcher) = text_match {
                                matcher(content)
                            } else if match_case {
                                content.contains(query)
                            } else {
                                content.to_lowercase().contains(&normalized)
                            };
                            if found {
                                results.matches.push(TextMatch {
                                    path: path.to_string_lossy().into_owned(),
                                    relative: relative.clone(),
                                    line: line + 1,
                                    preview: excerpt(content, query, match_case),
                                });
                                if results.matches.len() >= MAX_RESULTS {
                                    results.truncated = true;
                                    return results;
                                }
                            }
                        }
                    }
                }
                if results.files.len() >= MAX_RESULTS {
                    results.truncated = true;
                    return results;
                }
            }
        }
    }
    results.files.sort_by(|a, b| {
        a.relative
            .len()
            .cmp(&b.relative.len())
            .then_with(|| a.relative.cmp(&b.relative))
    });
    results
}

fn read_text(path: &Path) -> Option<String> {
    let file = fs::File::open(path).ok()?;
    if file.metadata().ok()?.len() > MAX_FILE_BYTES {
        return None;
    }
    let mut bytes = Vec::new();
    file.take(MAX_FILE_BYTES + 1).read_to_end(&mut bytes).ok()?;
    if bytes.len() as u64 > MAX_FILE_BYTES || bytes.contains(&0) {
        return None;
    }
    String::from_utf8(bytes).ok()
}

fn excerpt(content: &str, query: &str, match_case: bool) -> String {
    let chars: Vec<char> = content.chars().collect();
    if chars.len() <= 240 {
        return content.trim().into();
    }
    // Match on character boundaries, including Unicode case folding that changes byte lengths.
    let normalized = if match_case {
        query.into()
    } else {
        query.to_lowercase()
    };
    let position = (0..chars.len())
        .find(|index| {
            let candidate: String = chars[*index..]
                .iter()
                .take(query.chars().count() + 2)
                .collect();
            if match_case {
                candidate.starts_with(&normalized)
            } else {
                candidate.to_lowercase().starts_with(&normalized)
            }
        })
        .unwrap_or(0);
    let start = position.saturating_sub(50);
    let end = (start + 240).min(chars.len());
    format!(
        "{}{}{}",
        if start > 0 { "…" } else { "" },
        chars[start..end].iter().collect::<String>(),
        if end < chars.len() { "…" } else { "" }
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
            let path = std::env::temp_dir().join(format!(
                "octode-search-{}-{}",
                std::process::id(),
                COUNTER.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(path.join("app")).unwrap();
            fs::create_dir_all(path.join("vendor")).unwrap();
            fs::write(
                path.join("app/WelcomeController.php"),
                "<?php\n// Ćao Laravel 👋\nreturn 'laravel';\n",
            )
            .unwrap();
            fs::write(path.join("vendor/ignored.php"), "Laravel").unwrap();
            Self(path)
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn finds_files_with_multiple_case_insensitive_path_terms() {
        let fixture = Fixture::new();
        let found = search(
            std::slice::from_ref(&fixture.0),
            "APP controller",
            Mode::Files,
            &AtomicBool::new(false),
        );
        assert_eq!(found.files.len(), 1);
        assert_eq!(found.files[0].relative, "app/WelcomeController.php");
        assert!(found.files[0]
            .root
            .ends_with(fixture.0.file_name().unwrap().to_str().unwrap()));
    }
    #[test]
    fn searches_unicode_text_and_skips_generated_folders() {
        let fixture = Fixture::new();
        let found = search(
            std::slice::from_ref(&fixture.0),
            "laravel",
            Mode::Text { match_case: false },
            &AtomicBool::new(false),
        );
        assert_eq!(found.matches.len(), 2);
        assert_eq!(found.matches[0].line, 2);
        assert!(found.matches[0].preview.contains("Ćao"));
        assert!(found
            .matches
            .iter()
            .all(|item| !item.path.contains("vendor")));
    }
    #[test]
    fn supports_case_sensitive_search() {
        let fixture = Fixture::new();
        let found = search(
            std::slice::from_ref(&fixture.0),
            "Laravel",
            Mode::Text { match_case: true },
            &AtomicBool::new(false),
        );
        assert_eq!(found.matches.len(), 1);
    }
    #[test]
    fn skips_binary_and_large_files() {
        let fixture = Fixture::new();
        fs::write(fixture.0.join("binary"), b"Laravel\0binary").unwrap();
        fs::write(
            fixture.0.join("large"),
            vec![b'a'; MAX_FILE_BYTES as usize + 1],
        )
        .unwrap();
        let found = search(
            std::slice::from_ref(&fixture.0),
            "laravel",
            Mode::Text { match_case: false },
            &AtomicBool::new(false),
        );
        assert_eq!(found.matches.len(), 2);
        assert_eq!(found.skipped, 2);
    }
    #[test]
    fn cancels_before_scanning_and_bounds_results() {
        let fixture = Fixture::new();
        let cancelled = search(
            std::slice::from_ref(&fixture.0),
            "x",
            Mode::Files,
            &AtomicBool::new(true),
        );
        assert!(cancelled.cancelled);
        fs::write(
            fixture.0.join("many.txt"),
            "match\n".repeat(MAX_RESULTS + 1),
        )
        .unwrap();
        let found = search(
            std::slice::from_ref(&fixture.0),
            "match",
            Mode::Text { match_case: false },
            &AtomicBool::new(false),
        );
        assert_eq!(found.matches.len(), MAX_RESULTS);
        assert!(found.truncated);
    }
    #[test]
    fn centers_long_unicode_lines_near_the_match() {
        let content = format!("{} needle {}", "Ć".repeat(300), "👋".repeat(300));
        let preview = excerpt(&content, "needle", false);
        assert!(preview.contains("needle"));
        assert!(preview.starts_with('…'));
        assert!(preview.chars().count() <= 242);
    }
    #[cfg(unix)]
    #[test]
    fn does_not_follow_symlinks() {
        let fixture = Fixture::new();
        std::os::unix::fs::symlink(&fixture.0, fixture.0.join("loop")).unwrap();
        let found = search(
            std::slice::from_ref(&fixture.0),
            "controller",
            Mode::Files,
            &AtomicBool::new(false),
        );
        assert_eq!(found.files.len(), 1);
        assert!(!found.truncated);
    }
}
