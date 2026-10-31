use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    Emitter,
};

// Replace native Close Window accelerators: preventing the WebView key event alone
// cannot stop macOS menu shortcuts from closing the only app window.
pub fn install(app: &tauri::App) -> tauri::Result<()> {
    let menu = Menu::default(app.handle())?;
    let close_window_text = PredefinedMenuItem::close_window(app, None)?.text()?;
    let select_all_text = PredefinedMenuItem::select_all(app, None)?.text()?;
    let select_all = MenuItem::with_id(
        app,
        "octode.select-all",
        "Select All",
        true,
        Some("CmdOrCtrl+A"),
    )?;
    let close_tab = MenuItem::with_id(
        app,
        "octode.close-tab",
        "Close Tab",
        true,
        Some("CmdOrCtrl+W"),
    )?;
    let mut added = false;
    for item in menu.items()? {
        if let Some(submenu) = item.as_submenu() {
            for (position, child) in submenu.items()?.into_iter().enumerate().rev() {
                if let Some(predefined) = child.as_predefined_menuitem() {
                    if !close_window_text.is_empty() && predefined.text()? == close_window_text {
                        submenu.remove_at(position)?;
                    } else if !select_all_text.is_empty() && predefined.text()? == select_all_text {
                        // WKWebView's selectAll: only selects Monaco's hidden
                        // textarea. Route the native command to the focused control.
                        submenu.remove_at(position)?;
                        submenu.insert(&select_all, position)?;
                    }
                }
            }
            if submenu.text()? == "File" {
                submenu.insert(&close_tab, 0)?;
                added = true;
            }
        }
    }
    if !added {
        menu.insert(&Submenu::with_items(app, "File", true, &[&close_tab])?, 0)?;
    }
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        if event.id().as_ref() == "octode.close-tab" {
            let _ = app.emit_to("main", "octode-close-tab", ());
        } else if event.id().as_ref() == "octode.select-all" {
            let _ = app.emit_to("main", "octode-select-all", ());
        }
    });
    Ok(())
}
