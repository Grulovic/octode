use std::{fs, io::Write, path::Path};
use tauri::WebviewWindow;
#[tauri::command]
pub async fn read_import_file(window: WebviewWindow, path: String) -> Result<String, String> {
    if window.label() != "main" {
        return Err("Use the main window".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let path = Path::new(&path);
        let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
        if !metadata.is_file() || metadata.len() > 4 * 1024 * 1024 {
            return Err("Choose a text import file no larger than 4 MB".into());
        }
        fs::read_to_string(path).map_err(|_| "The import file is not UTF-8 text".into())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn save_export_file(
    window: WebviewWindow,
    path: String,
    content: String,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Use the main window".into());
    }
    if content.len() > 20 * 1024 * 1024 {
        return Err("Export exceeds the 20 MB limit".into());
    }
    tauri::async_runtime::spawn_blocking(move || save(Path::new(&path), &content))
        .await
        .map_err(|e| e.to_string())?
}
fn save(path: &Path, content: &str) -> Result<(), String> {
    let parent = path.parent().ok_or("Choose an export destination")?;
    if fs::symlink_metadata(path)
        .is_ok_and(|metadata| metadata.file_type().is_symlink() || metadata.is_dir())
    {
        return Err("Choose a regular destination file, not a symlink or directory".into());
    }
    let temp = parent.join(format!(".octode-export-{}", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temp)
            .map_err(|e| e.to_string())?;
        file.write_all(content.as_bytes())
            .map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        fs::rename(&temp, path).map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temp);
    }
    result
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exports_complete_text_and_replaces_only_selected_file() {
        let dir = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        fs::create_dir(&dir).unwrap();
        let file = dir.join("result.csv");
        save(&file, "a,b\n1,Ćao\n").unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "a,b\n1,Ćao\n");
        save(&file, "updated").unwrap();
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
        assert!(save(&dir, "bad").is_err());
        fs::remove_dir_all(dir).unwrap();
    }
}
