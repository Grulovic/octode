//! Filesystem operations used by the desktop adapter, testable without Tauri.
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_FILE_BYTES: u64 = 5 * 1024 * 1024;
static TEMPORARY_ID: AtomicU64 = AtomicU64::new(0);

#[derive(Debug)]
pub struct Entry {
    pub name: String,
    pub path: String,
    pub directory: bool,
}

pub fn authorize_path(roots: &[String], path: &str) -> Result<PathBuf, String> {
    let canonical = Path::new(path)
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if !roots
        .iter()
        .any(|root| canonical.starts_with(Path::new(root)))
    {
        return Err("This path is outside the project's folders".into());
    }
    Ok(canonical)
}

pub fn list(path: &Path) -> Result<Vec<Entry>, String> {
    let mut entries = Vec::new();
    for entry in fs::read_dir(path).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        if entry.file_name() == ".git" {
            continue;
        }
        entries.push(Entry {
            name: entry.file_name().to_string_lossy().into_owned(),
            path: entry.path().to_string_lossy().into_owned(),
            directory: entry.path().is_dir(),
        });
    }
    entries.sort_by(|a, b| {
        b.directory
            .cmp(&a.directory)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

pub fn read(path: &Path) -> Result<String, String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err("Choose a regular text file".into());
    }
    if metadata.len() > MAX_FILE_BYTES {
        return Err("This file exceeds the first-release 5 MB editor limit".into());
    }
    let mut bytes = Vec::new();
    File::open(path)
        .map_err(|error| error.to_string())?
        .take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err("This file exceeds the first-release 5 MB editor limit".into());
    }
    if bytes.contains(&0) {
        return Err("Binary files cannot be edited as text".into());
    }
    String::from_utf8(bytes).map_err(|_| "This file is not UTF-8 text".into())
}

pub fn save(path: &Path, content: &str, expected: &str) -> Result<(), String> {
    if content.len() as u64 > MAX_FILE_BYTES {
        return Err("This file exceeds the first-release 5 MB editor limit".into());
    }
    if read(path)? != expected {
        return Err("This file changed on disk. Your edits are still open; compare or reload before saving.".into());
    }
    let permissions = fs::metadata(path)
        .map_err(|error| error.to_string())?
        .permissions();
    if permissions.readonly() {
        return Err("This file is read-only".into());
    }
    let parent = path.parent().ok_or("File has no parent folder")?;
    let (temporary, mut file) = create_temporary(parent)?;
    let result = (|| {
        file.write_all(content.as_bytes())
            .map_err(|error| error.to_string())?;
        file.set_permissions(permissions)
            .map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        drop(file);
        if read(path)? != expected {
            return Err(
                "The file changed while saving. Your edits have been preserved in the editor."
                    .into(),
            );
        }
        fs::rename(&temporary, path).map_err(|error| error.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn create_temporary(parent: &Path) -> Result<(PathBuf, File), String> {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    for _ in 0..8 {
        let path = parent.join(format!(
            ".octode-{}-{timestamp}-{}.tmp",
            std::process::id(),
            TEMPORARY_ID.fetch_add(1, Ordering::Relaxed)
        ));
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(file) => return Ok((path, file)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.to_string()),
        }
    }
    Err("Could not create a temporary save file".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let timestamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "octode-files-{}-{timestamp}-{}",
                std::process::id(),
                TEMPORARY_ID.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
        fn file(&self, name: &str, content: &[u8]) -> PathBuf {
            let path = self.0.join(name);
            fs::write(&path, content).unwrap();
            path
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn saves_unicode_and_crlf_without_leaving_temporary_files() {
        let fixture = Fixture::new();
        let path = fixture.file("file.php", b"original");
        save(&path, "Ćao 👋\r\nsecond line\r\n", "original").unwrap();
        assert_eq!(read(&path).unwrap(), "Ćao 👋\r\nsecond line\r\n");
        assert_eq!(fs::read_dir(&fixture.0).unwrap().count(), 1);
    }
    #[test]
    fn rejects_external_changes_without_overwriting() {
        let fixture = Fixture::new();
        let path = fixture.file("file.php", b"external edit");
        assert!(save(&path, "my edit", "original").is_err());
        assert_eq!(read(&path).unwrap(), "external edit");
        assert_eq!(fs::read_dir(&fixture.0).unwrap().count(), 1);
    }
    #[test]
    fn refuses_binary_invalid_encoding_directories_and_large_files() {
        let fixture = Fixture::new();
        assert!(read(&fixture.file("binary", b"text\0binary")).is_err());
        assert!(read(&fixture.file("encoding", &[0xff, 0xfe])).is_err());
        assert!(read(&fixture.0).is_err());
        let large = fixture.file("large", &[]);
        File::create(&large)
            .unwrap()
            .set_len(MAX_FILE_BYTES + 1)
            .unwrap();
        assert!(read(&large).is_err());
        let small = fixture.file("small", b"safe");
        assert!(save(&small, &"a".repeat(MAX_FILE_BYTES as usize + 1), "safe").is_err());
        assert_eq!(read(&small).unwrap(), "safe");
    }
    #[test]
    fn authorizes_components_instead_of_path_prefixes() {
        let fixture = Fixture::new();
        fs::create_dir(fixture.0.join("root")).unwrap();
        fs::create_dir(fixture.0.join("root-sibling")).unwrap();
        let inside = fixture.file("root/inside", b"inside");
        let outside = fixture.file("root-sibling/outside", b"outside");
        let roots = vec![fixture
            .0
            .join("root")
            .canonicalize()
            .unwrap()
            .to_string_lossy()
            .into_owned()];
        assert_eq!(
            authorize_path(&roots, &inside.to_string_lossy()).unwrap(),
            inside.canonicalize().unwrap()
        );
        assert!(authorize_path(&roots, &outside.to_string_lossy()).is_err());
        assert!(authorize_path(
            &roots,
            &fixture
                .0
                .join("root/../root-sibling/outside")
                .to_string_lossy()
        )
        .is_err());
    }
    #[test]
    fn lists_directories_first_and_hides_git_internals() {
        let fixture = Fixture::new();
        fs::create_dir(fixture.0.join("z-folder")).unwrap();
        fs::create_dir(fixture.0.join(".git")).unwrap();
        fixture.file("A.php", b"a");
        fixture.file("b.php", b"b");
        let entries = list(&fixture.0).unwrap();
        assert_eq!(entries.len(), 3);
        assert!(entries[0].directory);
        assert_eq!(entries[1].name, "A.php");
        assert!(entries[2].path.ends_with("b.php"));
    }
    #[cfg(unix)]
    #[test]
    fn rejects_symlink_escape_and_preserves_file_permissions() {
        use std::os::unix::fs::{symlink, PermissionsExt};
        let fixture = Fixture::new();
        fs::create_dir(fixture.0.join("root")).unwrap();
        let outside = fixture.file("secret", b"private");
        symlink(&outside, fixture.0.join("root/link")).unwrap();
        let root = fixture.0.join("root").canonicalize().unwrap();
        assert!(authorize_path(
            &[root.to_string_lossy().into_owned()],
            &root.join("link").to_string_lossy()
        )
        .is_err());
        let path = fixture.file("script", b"old");
        fs::set_permissions(&path, fs::Permissions::from_mode(0o750)).unwrap();
        save(&path, "new", "old").unwrap();
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o750
        );
        fs::set_permissions(&path, fs::Permissions::from_mode(0o440)).unwrap();
        assert!(save(&path, "overwrite", "new").is_err());
        assert_eq!(read(&path).unwrap(), "new");
        fs::set_permissions(path, fs::Permissions::from_mode(0o640)).unwrap();
    }
}
