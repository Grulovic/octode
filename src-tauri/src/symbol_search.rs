use regex::Regex;
use serde::Serialize;
use std::{
    collections::HashSet,
    fs,
    io::Read,
    path::PathBuf,
    time::{Duration, Instant},
};

#[derive(Serialize)]
pub struct Entry {
    pub path: String,
    pub relative: String,
    pub root: String,
    pub label: String,
    pub kind: &'static str,
    pub line: usize,
}
#[derive(Serialize)]
pub struct Index {
    pub entries: Vec<Entry>,
    pub truncated: bool,
}
// A bounded, navigation-only snapshot. Never starts a language/completion service.
pub fn index(roots: &[String]) -> Index {
    let mut result = Index {
        entries: Vec::new(),
        truncated: false,
    };
    let started = Instant::now();
    let mut directories: Vec<_> = roots.iter().map(PathBuf::from).collect();
    let mut visited = HashSet::new();
    let (mut files, mut bytes, mut inspected) = (0, 0, 0);
    let pattern = declaration_pattern();
    'walk: while let Some(directory) = directories.pop() {
        if !visited.insert(directory.clone()) {
            continue;
        }
        let Ok(children) = fs::read_dir(&directory) else {
            continue;
        };
        for child in children.flatten() {
            inspected += 1;
            if files >= 5000
                || bytes >= 32 * 1024 * 1024
                || inspected > 50000
                || result.entries.len() >= 25000
                || started.elapsed() > Duration::from_secs(3)
            {
                result.truncated = true;
                break 'walk;
            }
            let Ok(kind) = child.file_type() else {
                continue;
            };
            if kind.is_symlink() {
                continue;
            }
            let path = child.path();
            let name = child.file_name().to_string_lossy().into_owned();
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
                    ".cache",
                    "__pycache__",
                    ".venv",
                ]
                .contains(&name.as_str())
                {
                    directories.push(path);
                }
                continue;
            }
            if !kind.is_file() || !visited.insert(path.clone()) {
                continue;
            }
            files += 1;
            let root = roots
                .iter()
                .find(|root| path.starts_with(root))
                .cloned()
                .unwrap_or_default();
            let relative = path
                .strip_prefix(&root)
                .unwrap_or(&path)
                .to_string_lossy()
                .into_owned();
            let path_text = path.to_string_lossy().into_owned();
            result.entries.push(Entry {
                path: path_text.clone(),
                relative: relative.clone(),
                root: root.clone(),
                label: name,
                kind: "file",
                line: 1,
            });
            let extension = path
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or_default();
            if !["php", "ts", "tsx", "js", "jsx", "mjs", "cjs", "rs", "py"].contains(&extension) {
                continue;
            }
            let Ok(metadata) = child.metadata() else {
                continue;
            };
            if metadata.len() > 1024 * 1024 {
                continue;
            }
            let remaining = (32 * 1024 * 1024u64).saturating_sub(bytes);
            let limit = remaining.min(1024 * 1024);
            let Ok(file) = fs::File::open(&path) else {
                continue;
            };
            let mut text = String::new();
            if file.take(limit + 1).read_to_string(&mut text).is_err() {
                continue;
            }
            bytes += text.len() as u64;
            if text.len() as u64 > limit || text.contains('\0') {
                continue;
            }
            for (label, kind, line) in declarations(&text, extension, &pattern) {
                if result.entries.len() >= 25000 {
                    result.truncated = true;
                    break 'walk;
                }
                result.entries.push(Entry {
                    path: path_text.clone(),
                    relative: relative.clone(),
                    root: root.clone(),
                    label,
                    kind,
                    line,
                });
            }
        }
    }
    result
}
fn declaration_pattern() -> Regex {
    Regex::new(r"(?m)(?:\b(?:(class|interface|trait|enum|struct)\s+([\p{L}_$][\p{L}\p{N}_$]*)|(?:function\s*\&?\s*|fn\s+|def\s+)([\p{L}_$][\p{L}\p{N}_$]*)\s*(?:<[^;{}\n]*>)?\s*\(|(?:const|let|var)\s+([\p{L}_$][\p{L}\p{N}_$]*)\s*=\s*(?:async\s+)?(?:\([^;{}]*\)|[\p{L}_$][\p{L}\p{N}_$]*)\s*(?::[^=;{}]+)?=>)|^[ \t]*(?:(?:public|private|protected|static|async|abstract|override|get|set)\s+)*([\p{L}_$][\p{L}\p{N}_$]*)\s*(?:<[^;{}\n]*>)?\s*\([^;{}]*\)\s*(?::[^;{}=]+)?\s*\{)").expect("static declaration pattern")
}
fn declarations(
    text: &str,
    extension: &str,
    pattern: &Regex,
) -> Vec<(String, &'static str, usize)> {
    // Mask strings/comments without shifting byte offsets or line numbers.
    let mut code = text.as_bytes().to_vec();
    let mut i = 0;
    let blank = |code: &mut [u8], index: usize| {
        if code[index] != b'\n' {
            code[index] = b' ';
        }
    };
    while i < code.len() {
        let start = i;
        if code[i] == b'/' && code.get(i + 1) == Some(&b'*') {
            i += 2;
            while i < code.len() && !(code[i] == b'*' && code.get(i + 1) == Some(&b'/')) {
                i += 1;
            }
            i = (i + 2).min(code.len());
        } else if (code[i] == b'/' && code.get(i + 1) == Some(&b'/') && extension != "py")
            || (code[i] == b'#'
                && ["py", "php"].contains(&extension)
                && code.get(i + 1) != Some(&b'['))
        {
            while i < code.len() && code[i] != b'\n' {
                i += 1;
            }
        } else if matches!(code[i], b'\'' | b'"' | b'`') {
            let quote = code[i];
            // Rust lifetimes are identifiers rather than quoted strings.
            if extension == "rs" && quote == b'\'' && code.get(i + 2) != Some(&b'\'') {
                i += 1;
                continue;
            }
            let triple = extension == "py"
                && code.get(i + 1) == Some(&quote)
                && code.get(i + 2) == Some(&quote);
            i += if triple { 3 } else { 1 };
            while i < code.len() {
                if code[i] == b'\\' {
                    i = (i + 2).min(code.len());
                    continue;
                }
                if code[i] == quote
                    && (!triple
                        || (code.get(i + 1) == Some(&quote) && code.get(i + 2) == Some(&quote)))
                {
                    i = (i + if triple { 3 } else { 1 }).min(code.len());
                    break;
                }
                i += 1;
            }
        } else {
            i += 1;
            continue;
        }
        for index in start..i {
            blank(&mut code, index);
        }
    }
    let code = String::from_utf8(code).expect("mask retains UTF-8");
    let mut results = Vec::new();
    let (mut previous, mut line) = (0, 1);
    for capture in pattern.captures_iter(&code) {
        let (name, kind) = if let Some(name) = capture.get(2) {
            (name, "class")
        } else {
            (
                capture
                    .get(3)
                    .or_else(|| capture.get(4))
                    .or_else(|| capture.get(5))
                    .unwrap(),
                "function",
            )
        };
        if [
            "extends",
            "implements",
            "if",
            "for",
            "while",
            "switch",
            "catch",
            "with",
        ]
        .contains(&name.as_str())
        {
            continue;
        }
        line += code[previous..name.start()]
            .bytes()
            .filter(|c| *c == b'\n')
            .count();
        previous = name.start();
        results.push((name.as_str().into(), kind, line));
    }
    results
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn extracts_named_declarations_and_skips_comments_strings_and_usages() {
        let text = "<?php\n// class Fake {}\n$x = 'function fake() {}';\nfinal class CustomerService {\n public function & findCustomer(\n $id\n ) {}\n}\nfunction sendInvoice() {}\nnew class extends CustomerService {};\n";
        assert_eq!(
            declarations(text, "php", &declaration_pattern()),
            vec![
                ("CustomerService".into(), "class", 4),
                ("findCustomer".into(), "function", 5),
                ("sendInvoice".into(), "function", 9)
            ]
        );
        let js = "const sendInvoice = async (id: string): Promise<void> => {};\nexport async function loadCustomers() {}\nconst message = `class Fake {}`;\nclass Service {\n async findCustomer(id: string) { return id; }\n}\nif (ready) {}\n";
        assert_eq!(
            declarations(js, "ts", &declaration_pattern()),
            vec![
                ("sendInvoice".into(), "function", 1),
                ("loadCustomers".into(), "function", 2),
                ("Service".into(), "class", 4),
                ("findCustomer".into(), "function", 5)
            ]
        );
        let py = "\"\"\"class Fake:\n def fake(): pass\"\"\"\n# def fake():\nclass Real:\n def run(self): pass\n";
        assert_eq!(
            declarations(py, "py", &declaration_pattern()),
            vec![("Real".into(), "class", 4), ("run".into(), "function", 5)]
        );
    }
    #[test]
    fn indexes_multiple_roots_without_duplicate_files_or_dependency_trees() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        fs::create_dir_all(root.join("src")).unwrap();
        fs::create_dir_all(root.join("vendor")).unwrap();
        fs::write(
            root.join("src/Customer.php"),
            "<?php\nclass Customer {}\nfunction saveCustomer() {}\n",
        )
        .unwrap();
        fs::write(root.join("vendor/Ignored.php"), "<?php class Ignored {}").unwrap();
        fs::write(root.join("readme.md"), "hello").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(root.join("src/Customer.php"), root.join("outside.php"))
            .unwrap();
        let result = index(&[
            root.to_string_lossy().into_owned(),
            root.join("src").to_string_lossy().into_owned(),
        ]);
        assert!(!result.truncated);
        assert_eq!(result.entries.len(), 4);
        assert_eq!(
            result
                .entries
                .iter()
                .filter(|entry| entry.kind == "file")
                .count(),
            2
        );
        assert!(result
            .entries
            .iter()
            .any(|entry| entry.label == "saveCustomer" && entry.line == 3));
        fs::remove_dir_all(root).unwrap();
    }
}
