use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    Emitter,
};

// Replace native Close Window accelerators: preventing the WebView key event alone
// cannot stop macOS menu shortcuts from closing the only app window.
pub fn install(app: &tauri::App) -> tauri::Result<()> {
    let menu = Menu::default(app.handle())?;
    let close_window_text = PredefinedMenuItem::close_window(app, None)?.text()?;
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
        }
    });
    Ok(())
}
