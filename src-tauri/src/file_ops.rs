use crate::file_core;
use std::{
    fs,
    path::{Component, Path, PathBuf},
};

pub fn relative_target(roots: &[String], parent: &str, name: &str) -> Result<PathBuf, String> {
    let relative = Path::new(name);
    if name.trim().is_empty()
        || name.len() > 1024
        || relative
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
        || name
            .split(['/', '\\'])
            .any(|part| part.eq_ignore_ascii_case(".git") || part.is_empty())
    {
        return Err("Use a relative name without parent segments or .git".into());
    }
    let parent = file_core::authorize_path(roots, parent)?;
    if !parent.is_dir() {
        return Err("Choose a parent folder".into());
    }
    let target = parent.join(relative);
    // Existing parents must resolve inside the project; do not follow symlink targets.
    let mut cursor = target.parent().ok_or("Invalid file name")?;
    while !cursor.exists() {
        cursor = cursor.parent().ok_or("Parent folder is unavailable")?;
    }
    let existing = file_core::authorize_path(roots, &cursor.to_string_lossy())?;
    if existing.components().any(|part| {
        part.as_os_str()
            .to_string_lossy()
            .eq_ignore_ascii_case(".git")
    }) {
        return Err("Git internals cannot be edited here".into());
    }
    if target.components().any(|part| {
        part.as_os_str()
            .to_string_lossy()
            .eq_ignore_ascii_case(".git")
    }) {
        return Err("Git internals cannot be edited here".into());
    }
    Ok(target)
}
pub fn create(
    roots: &[String],
    parent: &str,
    name: &str,
    directory: bool,
) -> Result<String, String> {
    let target = relative_target(roots, parent, name)?;
    if directory {
        fs::create_dir(&target).map_err(|e| e.to_string())?;
    } else {
        fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target)
            .map_err(|e| e.to_string())?;
    }
    Ok(target.to_string_lossy().into())
}
fn mutable_path(roots: &[String], path: &str) -> Result<PathBuf, String> {
    let raw = Path::new(path);
    if fs::symlink_metadata(raw)
        .map_err(|e| e.to_string())?
        .file_type()
        .is_symlink()
    {
        return Err("Symlinks cannot be renamed or deleted here".into());
    }
    let source = file_core::authorize_path(roots, path)?;
    if roots.iter().any(|root| Path::new(root) == source)
        || source.components().any(|part| {
            part.as_os_str()
                .to_string_lossy()
                .eq_ignore_ascii_case(".git")
        })
    {
        return Err("Project roots and Git internals cannot be changed here".into());
    }
    Ok(source)
}
pub fn rename(roots: &[String], path: &str, destination: &str) -> Result<String, String> {
    let source = mutable_path(roots, path)?;
    let target = relative_target(
        roots,
        &source.parent().ok_or("No parent folder")?.to_string_lossy(),
        destination,
    )?;
    if target.exists() || fs::symlink_metadata(&target).is_ok() {
        return Err("The destination already exists".into());
    }
    // Files use an exclusive hard-link then unlink, avoiding accidental replacement.
    if source.is_file() {
        fs::hard_link(&source, &target).map_err(|e| e.to_string())?;
        if let Err(error) = fs::remove_file(&source) {
            let _ = fs::remove_file(&target);
            return Err(error.to_string());
        }
    } else {
        fs::rename(&source, &target).map_err(|e| e.to_string())?;
    }
    Ok(target.to_string_lossy().into())
}
pub fn delete(roots: &[String], path: &str, expected: Option<&str>) -> Result<(), String> {
    let source = mutable_path(roots, path)?;
    if source.is_dir() {
        fs::remove_dir(source)
            .map_err(|_| "Only empty folders can be deleted; remove their files first".into())
    } else {
        if let Some(expected) = expected {
            if file_core::read(&source)? != expected {
                return Err("The file changed on disk; review it before deleting".into());
            }
        }
        fs::remove_file(source).map_err(|e| e.to_string())
    }
}

fn copy_name(source: &Path, attempt: usize) -> String {
    let name = source.file_name().unwrap().to_string_lossy();
    let split = name.rfind('.').filter(|index| *index > 0);
    let (stem, extension) = split.map_or((name.as_ref(), ""), |index| name.split_at(index));
    let suffix = if attempt == 1 {
        " copy".into()
    } else {
        format!(" copy {attempt}")
    };
    format!("{stem}{suffix}{extension}")
}

pub fn transfer(
    roots: &[String],
    path: &str,
    parent: &str,
    moving: bool,
    duplicate: bool,
    expected: Option<&str>,
) -> Result<String, String> {
    let source = mutable_path(roots, path)?;
    if !source.is_file() {
        return Err("Choose a regular file to copy or move".into());
    }
    if let Some(expected) = expected {
        if file_core::read(&source)? != expected {
            return Err(
                "The source file changed on disk; review it before copying or moving".into(),
            );
        }
    }
    let name = source.file_name().ok_or("No file name")?.to_string_lossy();
    let original_target = relative_target(roots, parent, &name)?;
    if moving {
        if original_target == source {
            return Ok(path.into());
        }
        // Exclusive creation prevents replacing another file, including a symlink.
        fs::hard_link(&source, &original_target).map_err(|error| {
            format!("Could not move file without replacing the destination: {error}")
        })?;
        if let Err(error) = fs::remove_file(&source) {
            let _ = fs::remove_file(&original_target);
            return Err(error.to_string());
        }
        return Ok(original_target.to_string_lossy().into());
    }
    for attempt in if duplicate { 1 } else { 0 }..10_000 {
        let name = if attempt == 0 {
            name.to_string()
        } else {
            copy_name(&source, attempt)
        };
        let target = relative_target(roots, parent, &name)?;
        let mut output = match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target)
        {
            Ok(output) => output,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.to_string()),
        };
        let result = (|| -> std::io::Result<()> {
            let mut input = fs::File::open(&source)?;
            std::io::copy(&mut input, &mut output)?;
            output.sync_all()?;
            fs::set_permissions(&target, fs::metadata(&source)?.permissions())?;
            Ok(())
        })();
        if let Err(error) = result {
            drop(output);
            let _ = fs::remove_file(&target);
            return Err(error.to_string());
        }
        return Ok(target.to_string_lossy().into());
    }
    Err("Could not find an unused copy name".into())
}

pub fn reveal(roots: &[String], path: &str) -> Result<String, String> {
    let source = file_core::authorize_path(roots, path)?;
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = std::process::Command::new("open");
        command.arg("-R").arg(&source);
        command
    };
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = std::process::Command::new("explorer.exe");
        command.arg(format!("/select,{}", source.display()));
        command
    };
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let mut command = {
        let mut command = std::process::Command::new("xdg-open");
        command.arg(if source.is_dir() {
            source.as_path()
        } else {
            source.parent().ok_or("No parent folder")?
        });
        command
    };
    command.spawn().map_err(|error| error.to_string())?;
    Ok(source.to_string_lossy().into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exclusive_file_operations_stay_inside_roots() {
        let dir = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        fs::create_dir(&dir).unwrap();
        let roots = vec![dir.canonicalize().unwrap().to_string_lossy().into_owned()];
        assert!(create(&roots, &roots[0], "../outside", false).is_err());
        assert!(create(&roots, &roots[0], ".git/config", false).is_err());
        let one = create(&roots, &roots[0], "one.php", false).unwrap();
        assert!(create(&roots, &roots[0], "one.php", false).is_err());
        fs::write(&one, "hello").unwrap();
        let two = create(&roots, &roots[0], "two.php", false).unwrap();
        assert!(rename(&roots, &one, "two.php").is_err());
        assert!(delete(&roots, &one, Some("old")).is_err());
        let moved = rename(&roots, &one, "moved.php").unwrap();
        assert_eq!(fs::read_to_string(&moved).unwrap(), "hello");
        delete(&roots, &moved, Some("hello")).unwrap();
        delete(&roots, &two, None).unwrap();
        assert!(delete(&roots, &roots[0], None).is_err());
        fs::remove_dir(dir).unwrap();
    }
    #[test]
    fn copies_binary_files_and_uses_unique_names_without_replacement() {
        let dir = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        fs::create_dir(&dir).unwrap();
        let roots = vec![dir.canonicalize().unwrap().to_string_lossy().into_owned()];
        let source = create(&roots, &roots[0], "image.bin", false).unwrap();
        let bytes = [0, 255, 128, 10, 42];
        fs::write(&source, bytes).unwrap();
        let first = transfer(&roots, &source, &roots[0], false, false, None).unwrap();
        let second = transfer(&roots, &source, &roots[0], false, true, None).unwrap();
        assert!(first.ends_with("image copy.bin"));
        assert!(second.ends_with("image copy 2.bin"));
        assert_eq!(fs::read(&source).unwrap(), bytes);
        assert_eq!(fs::read(&first).unwrap(), bytes);
        assert_eq!(fs::read(&second).unwrap(), bytes);
        assert_eq!(copy_name(Path::new(".env"), 1), ".env copy");
        assert_eq!(
            copy_name(Path::new("archive.tar.gz"), 2),
            "archive.tar copy 2.gz"
        );
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn moves_files_exclusively_and_checks_disk_versions() {
        let dir = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        fs::create_dir(&dir).unwrap();
        let roots = vec![dir.canonicalize().unwrap().to_string_lossy().into_owned()];
        let source = create(&roots, &roots[0], "one.php", false).unwrap();
        fs::write(&source, "latest").unwrap();
        let destination = create(&roots, &roots[0], "destination", true).unwrap();
        assert!(transfer(&roots, &source, &destination, true, false, Some("old")).is_err());
        assert!(Path::new(&source).exists());
        let existing = create(&roots, &destination, "one.php", false).unwrap();
        fs::write(&existing, "keep me").unwrap();
        assert!(transfer(&roots, &source, &destination, true, false, Some("latest")).is_err());
        assert_eq!(fs::read_to_string(&existing).unwrap(), "keep me");
        fs::remove_file(&existing).unwrap();
        let moved = transfer(&roots, &source, &destination, true, false, Some("latest")).unwrap();
        assert!(!Path::new(&source).exists());
        assert_eq!(fs::read_to_string(moved).unwrap(), "latest");
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn transfers_reject_roots_git_internals_and_outside_destinations() {
        let dir = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        fs::create_dir(&dir).unwrap();
        let roots = vec![dir.canonicalize().unwrap().to_string_lossy().into_owned()];
        let source = create(&roots, &roots[0], "one.php", false).unwrap();
        fs::create_dir(dir.join(".git")).unwrap();
        assert!(transfer(
            &roots,
            &source,
            &dir.join(".git").to_string_lossy(),
            false,
            false,
            None
        )
        .is_err());
        assert!(transfer(
            &roots,
            &source,
            &std::env::temp_dir().to_string_lossy(),
            false,
            false,
            None
        )
        .is_err());
        assert!(transfer(&roots, &roots[0], &roots[0], true, false, None).is_err());
        assert!(reveal(&roots, &std::env::temp_dir().to_string_lossy()).is_err());
        #[cfg(unix)]
        {
            let link = dir.join("link.php");
            std::os::unix::fs::symlink(&source, &link).unwrap();
            assert!(transfer(
                &roots,
                &link.to_string_lossy(),
                &roots[0],
                false,
                true,
                None
            )
            .is_err());
        }
        fs::remove_dir_all(dir).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn rejects_symlink_parent_escape() {
        let dir = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        fs::create_dir(&dir).unwrap();
        std::os::unix::fs::symlink(std::env::temp_dir(), dir.join("escape")).unwrap();
        let roots = vec![dir.canonicalize().unwrap().to_string_lossy().into_owned()];
        assert!(create(&roots, &roots[0], "escape/octode-outside", false).is_err());
        fs::remove_dir_all(dir).unwrap();
    }
}
