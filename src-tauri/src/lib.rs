mod exports;
mod formatting;
mod restart_state;
mod tab_menu;
use exports::{read_import_file, save_export_file};
mod dev_commands;
mod file_ops;
mod git_tools;
mod navigation;
mod search_options;
mod symbol_search;
mod transfer;
use dev_commands::*;
mod database;
mod http_client;
mod operations;
mod secrets;
mod service_commands;
mod ssh;
mod tool_commands;
use service_commands::*;
use tool_commands::*;
mod file_core;
mod files;
mod projects;
mod search_core;
mod terminal;
mod terminal_core;

use projects::{Project, Store, WorkspaceSession};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use tauri::{ipc::Channel, Manager, State, WebviewWindow};
use terminal::{Output, Terminals};

#[derive(Default)]
struct SearchJobs(Mutex<HashMap<String, Arc<AtomicBool>>>);
impl SearchJobs {
    fn begin(&self, owner: &str, kind: &str) -> Result<Arc<AtomicBool>, String> {
        let token = Arc::new(AtomicBool::new(false));
        if let Some(previous) = self
            .0
            .lock()
            .map_err(|e| e.to_string())?
            .insert(format!("{owner}:{kind}"), token.clone())
        {
            previous.store(true, Ordering::Relaxed);
        }
        Ok(token)
    }
    fn cancel(&self, owner: &str, kind: &str) -> Result<(), String> {
        if let Some(token) = self
            .0
            .lock()
            .map_err(|e| e.to_string())?
            .remove(&format!("{owner}:{kind}"))
        {
            token.store(true, Ordering::Relaxed);
        }
        Ok(())
    }
}

#[derive(Serialize)]
struct SearchFile {
    path: String,
    relative: String,
    root: String,
}
#[derive(Serialize)]
struct TextMatch {
    path: String,
    relative: String,
    line: usize,
    preview: String,
}
#[derive(Serialize)]
struct SearchResults {
    files: Vec<SearchFile>,
    matches: Vec<TextMatch>,
    truncated: bool,
    cancelled: bool,
    skipped: usize,
    warnings: Vec<String>,
}

#[tauri::command]
#[allow(clippy::too_many_arguments)] // Tauri-injected window/store/jobs plus the existing search IPC contract.
async fn search_workspace(
    window: WebviewWindow,
    store: State<'_, Store>,
    jobs: State<'_, SearchJobs>,
    project_id: String,
    query: String,
    kind: String,
    match_case: bool,
    options: Option<search_options::Options>,
) -> Result<SearchResults, String> {
    require_project(&window, &project_id)?;
    if query.chars().count() > 256 {
        return Err("Search is limited to 256 characters".into());
    }
    let mode = match kind.as_str() {
        "files" => search_core::Mode::Files,
        "text" => search_core::Mode::Text { match_case },
        _ => return Err("Unknown search mode".into()),
    };
    let roots = store
        .get(&project_id)?
        .roots
        .iter()
        .map(|root| store.authorize_path(&project_id, root))
        .collect::<Result<Vec<_>, _>>()?;
    let token = jobs.begin(window.label(), &kind)?;
    tauri::async_runtime::spawn_blocking(move || {
        let result = search_options::search(&roots, &query, mode, &token, options)?;
        Ok::<_, String>(SearchResults {
            files: result
                .files
                .into_iter()
                .map(|item| SearchFile {
                    path: item.path,
                    relative: item.relative,
                    root: item.root,
                })
                .collect(),
            matches: result
                .matches
                .into_iter()
                .map(|item| TextMatch {
                    path: item.path,
                    relative: item.relative,
                    line: item.line,
                    preview: item.preview,
                })
                .collect(),
            truncated: result.truncated,
            cancelled: result.cancelled,
            skipped: result.skipped,
            warnings: result.warnings,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn cancel_search(
    window: WebviewWindow,
    jobs: State<'_, SearchJobs>,
    kind: String,
) -> Result<(), String> {
    jobs.cancel(window.label(), &kind)
}

#[tauri::command]
fn load_workspace_state(
    window: WebviewWindow,
    store: State<'_, Store>,
    project_id: String,
) -> Result<Option<WorkspaceSession>, String> {
    require_project(&window, &project_id)?;
    store.load_session(&project_id)
}

#[tauri::command]
fn save_workspace_state(
    window: WebviewWindow,
    store: State<'_, Store>,
    project_id: String,
    session: WorkspaceSession,
) -> Result<(), String> {
    require_project(&window, &project_id)?;
    store.save_session(&project_id, &session)
}

fn require_project(window: &WebviewWindow, project_id: &str) -> Result<(), String> {
    if window.label() != "main" || uuid::Uuid::parse_str(project_id).is_err() {
        return Err(
            "Project operations require the main workspace window and a valid project".into(),
        );
    }
    Ok(())
}

#[tauri::command]
fn list_projects(store: State<'_, Store>) -> Result<Vec<Project>, String> {
    store.list()
}

#[tauri::command]
fn create_project(
    window: WebviewWindow,
    store: State<'_, Store>,
    name: String,
    roots: Vec<String>,
    color: Option<String>,
) -> Result<Project, String> {
    if window.label() != "main" {
        return Err("Create projects from the welcome window".into());
    }
    let project = store.create(name, roots)?;
    store.set_color(&project.id, color.unwrap_or_else(|| "#80cbc4".into()))
}

#[tauri::command]
fn activate_project(
    window: WebviewWindow,
    store: State<'_, Store>,
    project_id: String,
) -> Result<(), String> {
    require_project(&window, &project_id)?;
    store.get(&project_id)?;
    store.touch(&project_id)
}

fn project_path(
    window: &WebviewWindow,
    store: &Store,
    project_id: &str,
    path: &str,
) -> Result<PathBuf, String> {
    require_project(window, project_id)?;
    store.authorize_path(project_id, path)
}

#[tauri::command]
async fn list_directory(
    window: WebviewWindow,
    store: State<'_, Store>,
    project_id: String,
    path: String,
) -> Result<Vec<files::FileEntry>, String> {
    let path = project_path(&window, &store, &project_id, &path)?;
    tauri::async_runtime::spawn_blocking(move || files::list(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn read_file(
    window: WebviewWindow,
    store: State<'_, Store>,
    project_id: String,
    path: String,
) -> Result<String, String> {
    let path = project_path(&window, &store, &project_id, &path)?;
    tauri::async_runtime::spawn_blocking(move || files::read(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn save_file(
    window: WebviewWindow,
    store: State<'_, Store>,
    project_id: String,
    path: String,
    content: String,
    expected: String,
) -> Result<(), String> {
    let path = project_path(&window, &store, &project_id, &path)?;
    tauri::async_runtime::spawn_blocking(move || files::save(&path, &content, &expected))
        .await
        .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
struct GitStatus {
    branch: String,
    files: Vec<String>,
}

#[tauri::command]
async fn git_status(
    window: WebviewWindow,
    store: State<'_, Store>,
    project_id: String,
    root: String,
) -> Result<GitStatus, String> {
    let root = project_path(&window, &store, &project_id, &root)?;
    tauri::async_runtime::spawn_blocking(move || {
        let output = std::process::Command::new("git")
            .arg("-C")
            .arg(&root)
            .args([
                "status",
                "--porcelain=v1",
                "--branch",
                "--untracked-files=normal",
            ])
            .output()
            .map_err(|_| {
                "Git was not found. Install Git to enable repository status.".to_string()
            })?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).into_owned());
        }
        let text = String::from_utf8_lossy(&output.stdout);
        let mut lines = text.lines();
        let branch = lines
            .next()
            .unwrap_or("## unknown")
            .trim_start_matches("## ")
            .to_string();
        Ok(GitStatus {
            branch,
            files: lines.map(String::from).collect(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalStartRequest {
    project_id: String,
    root: String,
    rows: u16,
    cols: u16,
}

#[tauri::command]
async fn terminal_create(
    window: WebviewWindow,
    store: State<'_, Store>,
    terminals: State<'_, Arc<Terminals>>,
    request: TerminalStartRequest,
    output: Channel<Output>,
) -> Result<String, String> {
    let root = project_path(&window, &store, &request.project_id, &request.root)?;
    let terminals = terminals.inner().clone();
    let owner = window.label().to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        terminals.create(&owner, &root, request.rows, request.cols, output)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn terminal_write(
    window: WebviewWindow,
    terminals: State<'_, Arc<Terminals>>,
    id: String,
    data: String,
) -> Result<(), String> {
    terminals.write(window.label(), &id, &data)
}
#[tauri::command]
fn terminal_resize(
    window: WebviewWindow,
    terminals: State<'_, Arc<Terminals>>,
    id: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    terminals.resize(window.label(), &id, rows, cols)
}
#[tauri::command]
fn terminal_ack(
    window: WebviewWindow,
    terminals: State<'_, Arc<Terminals>>,
    id: String,
    bytes: usize,
) -> Result<(), String> {
    terminals.ack(window.label(), &id, bytes)
}
#[tauri::command]
fn terminal_close(
    window: WebviewWindow,
    terminals: State<'_, Arc<Terminals>>,
    id: String,
) -> Result<(), String> {
    terminals.close(window.label(), &id)
}

#[tauri::command]
fn restart_app(
    window: WebviewWindow,
    app: tauri::AppHandle,
    project_id: Option<String>,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Restart Octode from the main workspace window".into());
    }
    if let Some(id) = &project_id {
        require_project(&window, id)?;
        app.state::<Store>().get(id)?;
    }
    restart_state::save(
        &app.path()
            .app_data_dir()
            .map_err(|error| error.to_string())?,
        &restart_state::RestartState { project_id },
    )?;
    // The frontend has completed its Code/settings/layout save checks.
    // Release shells, connections and operations before relaunching this bundle.
    window
        .state::<Arc<Terminals>>()
        .close_window(window.label());
    window.state::<ssh::Servers>().close_window(window.label());
    window
        .state::<database::Databases>()
        .close_window(window.label());
    window
        .state::<operations::Operations>()
        .close_window(window.label());
    app.request_restart();
    Ok(())
}

#[tauri::command]
fn take_restart_state(
    window: WebviewWindow,
    app: tauri::AppHandle,
) -> Result<Option<restart_state::RestartState>, String> {
    if window.label() != "main" {
        return Err("Restore restart state from the main window".into());
    }
    restart_state::take(
        &app.path()
            .app_data_dir()
            .map_err(|error| error.to_string())?,
    )
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Arc::new(Terminals::default()))
        .manage(SearchJobs::default())
        .manage(Arc::new(git_tools::GitLocks::default()))
        .manage(operations::Operations::default())
        .manage(ssh::Servers::default())
        .manage(database::Databases::default())
        .setup(|app| {
            tab_menu::install(app)?;
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            app.manage(
                Store::open(&data_dir.join("octode.sqlite")).map_err(std::io::Error::other)?,
            );
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                window
                    .state::<Arc<Terminals>>()
                    .close_window(window.label());
                window.state::<ssh::Servers>().close_window(window.label());
                window
                    .state::<database::Databases>()
                    .close_window(window.label());
                window
                    .state::<operations::Operations>()
                    .close_window(window.label());
                let _ = window.state::<SearchJobs>().cancel(window.label(), "files");
                let _ = window.state::<SearchJobs>().cancel(window.label(), "text");
            }
        })
        .invoke_handler(tauri::generate_handler![
            load_tool_document,
            save_tool_document,
            api_send,
            cancel_operation,
            ssh_fingerprint,
            ssh_connect,
            ssh_key_directory,
            ssh_connected,
            ssh_close,
            ssh_shell,
            ssh_shell_close,
            ssh_write,
            ssh_resize,
            ssh_ack,
            sftp_list,
            sftp_transfer,
            sftp_mutate,
            database_connect,
            database_close,
            database_tables,
            database_metadata,
            database_row_plan,
            database_apply_rows,
            database_query,
            database_browse,
            close_project_services,
            file_action,
            inspect_files,
            navigation_targets,
            search_everywhere_index,
            git_snapshot,
            git_branch_name,
            git_diff,
            git_action,
            load_format_options,
            save_format_options,
            format_php_file,
            update_project,
            remove_project,
            read_import_file,
            save_export_file,
            preview_replacements,
            apply_replacements,
            load_code_drafts,
            save_code_drafts,
            git_conflict,
            git_hunks,
            git_apply_hunks,
            git_show_commit,
            search_workspace,
            cancel_search,
            load_workspace_state,
            save_workspace_state,
            list_projects,
            create_project,
            activate_project,
            list_directory,
            read_file,
            save_file,
            git_status,
            terminal_create,
            terminal_write,
            terminal_resize,
            terminal_ack,
            terminal_close,
            restart_app,
            take_restart_state
        ])
        .build(tauri::generate_context!())
        .expect("Could not start Octode")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
                // Restart was explicitly requested after the frontend save checks.
                if code == Some(tauri::RESTART_EXIT_CODE) {
                    return;
                }
                if let Some(window) = app.get_webview_window("main") {
                    api.prevent_exit();
                    let _ = window.close();
                }
            }
        });
}
