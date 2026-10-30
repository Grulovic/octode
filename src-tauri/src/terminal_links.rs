use tauri::WebviewWindow;
fn web_url(value: &str) -> Result<String, String> {
    if value.len() > 8192 || value.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err("Choose an HTTP or HTTPS link".into());
    }
    let url = reqwest::Url::parse(value).map_err(|_| "Invalid web link")?;
    if !["http", "https"].contains(&url.scheme()) || url.host_str().is_none() {
        return Err("Only HTTP and HTTPS links can open from the terminal".into());
    }
    Ok(url.into())
}
#[tauri::command]
pub async fn open_terminal_url(window: WebviewWindow, url: String) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Open links from the main window".into());
    }
    let url = web_url(&url)?;
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "macos")]
        let mut command = {
            let mut command = std::process::Command::new("open");
            command.arg("--").arg(&url);
            command
        };
        #[cfg(target_os = "windows")]
        let mut command = {
            let mut command = std::process::Command::new("rundll32.exe");
            command.arg("url.dll,FileProtocolHandler").arg(&url);
            command
        };
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        let mut command = {
            let mut command = std::process::Command::new("xdg-open");
            command.arg(&url);
            command
        };
        let status = command
            .status()
            .map_err(|error| format!("Could not open browser: {error}"))?;
        if status.success() {
            Ok(())
        } else {
            Err("The browser could not open this link".into())
        }
    })
    .await
    .map_err(|error| error.to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_web_links_including_local_servers_but_rejects_other_protocols() {
        assert_eq!(
            web_url("http://localhost:5173/path?q=hello&x=1").unwrap(),
            "http://localhost:5173/path?q=hello&x=1"
        );
        assert!(web_url("https://example.com/path").is_ok());
        for url in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "mailto:test@example.com",
            "https://example.com/\n",
            "--help",
            "",
        ] {
            assert!(web_url(url).is_err(), "{url}");
        }
    }
}
