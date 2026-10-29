use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::mpsc,
    time::{Duration, Instant},
};
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatOptions {
    pub service: String,
    pub container_root: String,
    pub formatter: String,
}
fn validate(options: &FormatOptions) -> Result<(), String> {
    if options.service.is_empty()
        || options.service.len() > 100
        || !options
            .service
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "_.-".contains(c))
        || options.service.starts_with('-')
    {
        return Err("Enter a valid Compose service name".into());
    }
    if !options.container_root.starts_with('/')
        || options.container_root.contains('\0')
        || options.container_root.len() > 1024
    {
        return Err("Enter an absolute container project directory".into());
    }
    if options.formatter.is_empty()
        || options.formatter.starts_with('-')
        || options.formatter.contains('\0')
        || options.formatter.len() > 1024
    {
        return Err("Enter the formatter executable path, such as ./vendor/bin/pint".into());
    }
    Ok(())
}
fn docker(root: &Path, args: &[String]) -> Result<String, String> {
    let mut child = Command::new("docker")
        .arg("compose")
        .args(args)
        .current_dir(root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| {
            "Docker is unavailable on PATH. Install Docker and start your project services first."
        })?;
    let collect = |reader: Box<dyn Read + Send>| {
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            let mut bytes = Vec::new();
            let _ = reader.take(1024 * 1024).read_to_end(&mut bytes);
            let _ = tx.send(bytes);
        });
        rx
    };
    let out = collect(Box::new(
        child.stdout.take().ok_or("Formatter output unavailable")?,
    ));
    let err = collect(Box::new(
        child
            .stderr
            .take()
            .ok_or("Formatter error output unavailable")?,
    ));
    let started = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break status;
        }
        if started.elapsed() > Duration::from_secs(60) {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Formatting timed out; the original file was not replaced".into());
        }
        std::thread::sleep(Duration::from_millis(20));
    };
    let stdout = out.recv_timeout(Duration::from_secs(2)).unwrap_or_default();
    let stderr = err.recv_timeout(Duration::from_secs(2)).unwrap_or_default();
    if !status.success() {
        return Err(format!(
            "Compose formatter failed: {}",
            String::from_utf8_lossy(&stderr)
                .chars()
                .take(1500)
                .collect::<String>()
        ));
    }
    Ok(String::from_utf8_lossy(&stdout).into())
}
struct Temporary(PathBuf);
impl Drop for Temporary {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}
pub fn format_file(
    root: &Path,
    path: &Path,
    expected: &str,
    options: &FormatOptions,
) -> Result<String, String> {
    format_with(root, path, expected, options, docker)
}
fn format_with<F>(
    root: &Path,
    path: &Path,
    expected: &str,
    options: &FormatOptions,
    mut run: F,
) -> Result<String, String>
where
    F: FnMut(&Path, &[String]) -> Result<String, String>,
{
    validate(options)?;
    if !path.starts_with(root)
        || path.extension().and_then(|extension| extension.to_str()) != Some("php")
    {
        return Err("Choose a PHP file in the selected project folder".into());
    }
    if crate::file_core::read(path)? != expected {
        return Err("The file changed on disk; compare or reload before formatting".into());
    }
    let running = run(
        root,
        &[
            "ps".into(),
            "--status".into(),
            "running".into(),
            "--services".into(),
        ],
    )?;
    if !running.lines().any(|line| line.trim() == options.service) {
        return Err("The selected Compose service is not running. Start it yourself, then retry formatting.".into());
    }
    let temporary = path.with_file_name(format!(".octode-format-{}.php", uuid::Uuid::new_v4()));
    let _cleanup = Temporary(temporary.clone());
    let mut file = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary)
        .map_err(|e| e.to_string())?;
    std::io::Write::write_all(&mut file, expected.as_bytes()).map_err(|e| e.to_string())?;
    drop(file);
    let relative = temporary
        .strip_prefix(root)
        .map_err(|_| "Temporary formatting path is outside the selected root")?
        .to_string_lossy()
        .replace('\\', "/");
    run(
        root,
        &[
            "exec".into(),
            "-T".into(),
            "--workdir".into(),
            options.container_root.clone(),
            options.service.clone(),
            options.formatter.clone(),
            relative,
        ],
    )?;
    let formatted = crate::file_core::read(&temporary)?;
    crate::file_core::save(path, &formatted, expected)?;
    Ok(formatted)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn formats_a_temporary_copy_and_checks_external_changes_before_replacing() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        fs::create_dir(&root).unwrap();
        let file = root.join("file.php");
        fs::write(&file, "unformatted").unwrap();
        let options = FormatOptions {
            service: "laravel.test".into(),
            container_root: "/var/www/html".into(),
            formatter: "./vendor/bin/pint".into(),
        };
        let result = format_with(&root, &file, "unformatted", &options, |root, args| {
            if args[0] == "ps" {
                return Ok("laravel.test\n".into());
            }
            assert_eq!(args[5], "./vendor/bin/pint");
            fs::write(root.join(args.last().unwrap()), "formatted").unwrap();
            Ok(String::new())
        })
        .unwrap();
        assert_eq!(result, "formatted");
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        let result = format_with(&root, &file, "formatted", &options, |root, args| {
            if args[0] == "ps" {
                return Ok("laravel.test\n".into());
            }
            fs::write(&file, "external edit").unwrap();
            fs::write(root.join(args.last().unwrap()), "formatter output").unwrap();
            Ok(String::new())
        });
        assert!(result.is_err());
        assert_eq!(fs::read_to_string(file).unwrap(), "external edit");
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn refuses_stopped_services_without_starting_containers() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        fs::create_dir(&root).unwrap();
        let file = root.join("file.php");
        fs::write(&file, "original").unwrap();
        let options = FormatOptions {
            service: "php".into(),
            container_root: "/app".into(),
            formatter: "./vendor/bin/pint".into(),
        };
        assert!(format_with(&root, &file, "original", &options, |_, args| {
            assert_eq!(args[0], "ps");
            Ok(String::new())
        })
        .is_err());
        assert_eq!(fs::read_to_string(file).unwrap(), "original");
        fs::remove_dir_all(root).unwrap();
    }
}
