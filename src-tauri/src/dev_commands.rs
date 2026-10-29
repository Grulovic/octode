use crate::{
    file_core, file_ops,
    git_tools::{self, GitLocks},
    navigation,
    projects::Store,
};
use serde::{Deserialize, Serialize};
use std::{path::PathBuf, sync::Arc};
use tauri::{State, WebviewWindow};
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileAction {
    action: String,
    path: String,
    #[serde(default)]
    name: String,
    expected: Option<String>,
    destination: Option<String>,
}
#[tauri::command]
pub async fn file_action(
    window: WebviewWindow,
    store: State<'_, Store>,
    project_id: String,
    request: FileAction,
) -> Result<String, String> {
    crate::require_project(&window, &project_id)?;
    let roots = store.get(&project_id)?.roots;
    tauri::async_runtime::spawn_blocking(move || match request.action.as_str() {
        "create-file" => file_ops::create(&roots, &request.path, &request.name, false),
        "create-folder" => file_ops::create(&roots, &request.path, &request.name, true),
        "copy" | "move" | "duplicate" => {
            let parent = if request.action == "duplicate" {
                std::path::Path::new(&request.path)
                    .parent()
                    .ok_or("No parent folder")?
                    .to_string_lossy()
                    .into_owned()
            } else {
                request.destination.ok_or("Choose a destination folder")?
            };
            file_ops::transfer(
                &roots,
                &request.path,
                &parent,
                request.action == "move",
                request.action == "duplicate",
                request.expected.as_deref(),
            )
        }
        "reveal" => file_ops::reveal(&roots, &request.path),
        "rename" => file_ops::rename(&roots, &request.path, &request.name),
        "delete" => {
            file_ops::delete(&roots, &request.path, request.expected.as_deref())?;
            Ok(request.path)
        }
        _ => Err("Unknown file operation".into()),
    })
    .await
    .map_err(|e| e.to_string())?
}
#[derive(Deserialize)]
pub struct InspectionRequest {
    path: String,
    stamp: String,
}
#[derive(Serialize)]
pub struct Inspection {
    path: String,
    stamp: String,
    content: Option<String>,
    error: Option<String>,
}
#[tauri::command]
pub async fn inspect_files(
    window: WebviewWindow,
    store: State<'_, Store>,
    project_id: String,
    files: Vec<InspectionRequest>,
) -> Result<Vec<Inspection>, String> {
    crate::require_project(&window, &project_id)?;
    let roots = store.get(&project_id)?.roots;
    if files.len() > 100 {
        return Err("At most 100 open files can be watched".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut budget = 16u64 * 1024 * 1024;
        files
            .into_iter()
            .map(|request| {
                let mut inspected = || {
                    let path = file_core::authorize_path(&roots, &request.path)?;
                    let metadata = std::fs::metadata(&path).map_err(|e| e.to_string())?;
                    let changed = metadata
                        .modified()
                        .map_err(|e| e.to_string())?
                        .duration_since(std::time::UNIX_EPOCH)
                        .map_err(|e| e.to_string())?
                        .as_nanos();
                    #[cfg(unix)]
                    let identity = {
                        use std::os::unix::fs::MetadataExt;
                        format!(
                            "{}:{}:{}",
                            metadata.ino(),
                            metadata.ctime(),
                            metadata.ctime_nsec()
                        )
                    };
                    #[cfg(not(unix))]
                    let identity = String::new();
                    let stamp = format!("{changed}:{}:{identity}", metadata.len());
                    if request.stamp != stamp && metadata.len() > budget {
                        return Ok((request.stamp.clone(), None));
                    }
                    let content = if request.stamp == stamp {
                        None
                    } else {
                        budget = budget.saturating_sub(metadata.len());
                        Some(file_core::read(&path)?)
                    };
                    Ok::<_, String>((stamp, content))
                };
                match inspected() {
                    Ok((stamp, content)) => Inspection {
                        path: request.path,
                        stamp,
                        content,
                        error: None,
                    },
                    Err(error) => Inspection {
                        path: request.path,
                        stamp: "unavailable".into(),
                        content: None,
                        error: Some(error),
                    },
                }
            })
            .collect()
    })
    .await
    .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn navigation_targets(
    window: WebviewWindow,
    store: State<'_, Store>,
    project_id: String,
    path: String,
    query: String,
) -> Result<navigation::Targets, String> {
    crate::require_project(&window, &project_id)?;
    let source = store.authorize_path(&project_id, &path)?;
    let roots = store.get(&project_id)?.roots;
    tauri::async_runtime::spawn_blocking(move || navigation::find(&roots, &source, &query))
        .await
        .map_err(|e| e.to_string())?
}
fn repo(
    window: &WebviewWindow,
    store: &Store,
    project_id: &str,
    path: &str,
) -> Result<PathBuf, String> {
    crate::require_project(window, project_id)?;
    let project = store.get(project_id)?;
    if !project.roots.contains(&path.to_owned()) {
        return Err("Choose a registered project root".into());
    }
    store.authorize_path(project_id, path)
}
#[tauri::command]
pub async fn git_branch_name(
    window: WebviewWindow,
    store: State<'_, Store>,
    project_id: String,
    root: String,
) -> Result<String, String> {
    let root = repo(&window, &store, &project_id, &root)?;
    tauri::async_runtime::spawn_blocking(move || git_tools::current_branch(&root))
        .await
        .map_err(|error| error.to_string())?
}
#[tauri::command]
pub async fn git_snapshot(
    window: WebviewWindow,
    store: State<'_, Store>,
    locks: State<'_, Arc<GitLocks>>,
    project_id: String,
    root: String,
) -> Result<git_tools::Snapshot, String> {
    let root = repo(&window, &store, &project_id, &root)?;
    let lock = locks.repository(&root)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock.lock().map_err(|e| e.to_string())?;
        let root = git_tools::root(&root)?;
        git_tools::snapshot(&root)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn git_diff(
    window: WebviewWindow,
    store: State<'_, Store>,
    locks: State<'_, Arc<GitLocks>>,
    project_id: String,
    root: String,
    path: String,
    staged: bool,
) -> Result<String, String> {
    let root = repo(&window, &store, &project_id, &root)?;
    let lock = locks.repository(&root)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock.lock().map_err(|e| e.to_string())?;
        let root = git_tools::root(&root)?;
        git_tools::diff(&root, &path, staged)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn git_action(
    window: WebviewWindow,
    store: State<'_, Store>,
    locks: State<'_, Arc<GitLocks>>,
    project_id: String,
    root: String,
    request: git_tools::Action,
) -> Result<String, String> {
    let root = repo(&window, &store, &project_id, &root)?;
    let lock = locks.repository(&root)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock.lock().map_err(|e| e.to_string())?;
        let root = git_tools::root(&root)?;
        git_tools::action(&root, request)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn git_conflict(
    window: WebviewWindow,
    store: State<'_, Store>,
    locks: State<'_, Arc<GitLocks>>,
    project_id: String,
    root: String,
    path: String,
) -> Result<git_tools::Conflict, String> {
    let root = repo(&window, &store, &project_id, &root)?;
    let lock = locks.repository(&root)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock.lock().map_err(|e| e.to_string())?;
        let root = git_tools::root(&root)?;
        git_tools::conflict(&root, &path)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_hunks(
    window: WebviewWindow,
    store: State<'_, Store>,
    locks: State<'_, Arc<GitLocks>>,
    project_id: String,
    root: String,
    path: String,
    staged: bool,
) -> Result<git_tools::Hunks, String> {
    let root = repo(&window, &store, &project_id, &root)?;
    let lock = locks.repository(&root)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock.lock().map_err(|e| e.to_string())?;
        git_tools::hunks(&git_tools::root(&root)?, &path, staged)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn git_apply_hunks(
    window: WebviewWindow,
    store: State<'_, Store>,
    locks: State<'_, Arc<GitLocks>>,
    project_id: String,
    root: String,
    request: git_tools::HunkRequest,
) -> Result<(), String> {
    let root = repo(&window, &store, &project_id, &root)?;
    let lock = locks.repository(&root)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock.lock().map_err(|e| e.to_string())?;
        git_tools::apply_hunks(&git_tools::root(&root)?, request)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn git_show_commit(
    window: WebviewWindow,
    store: State<'_, Store>,
    locks: State<'_, Arc<GitLocks>>,
    project_id: String,
    root: String,
    hash: String,
) -> Result<String, String> {
    let root = repo(&window, &store, &project_id, &root)?;
    let lock = locks.repository(&root)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock.lock().map_err(|e| e.to_string())?;
        git_tools::show_commit(&git_tools::root(&root)?, &hash)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn load_code_drafts(
    window: WebviewWindow,
    store: State<'_, Store>,
    project_id: String,
) -> Result<Vec<crate::projects::CodeDraft>, String> {
    crate::require_project(&window, &project_id)?;
    store.load_drafts(&project_id)
}
#[tauri::command]
pub async fn save_code_drafts(
    window: WebviewWindow,
    store: State<'_, Store>,
    project_id: String,
    drafts: Vec<crate::projects::CodeDraft>,
) -> Result<(), String> {
    crate::require_project(&window, &project_id)?;
    store.save_drafts(&project_id, &drafts)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplacePreview {
    query: String,
    replacement: String,
    match_case: bool,
    options: crate::search_options::Options,
}
#[tauri::command]
pub async fn preview_replacements(
    window: WebviewWindow,
    store: State<'_, Store>,
    project_id: String,
    request: ReplacePreview,
) -> Result<Vec<crate::search_options::Replacement>, String> {
    crate::require_project(&window, &project_id)?;
    let roots = store
        .get(&project_id)?
        .roots
        .iter()
        .map(PathBuf::from)
        .collect::<Vec<_>>();
    tauri::async_runtime::spawn_blocking(move || {
        crate::search_options::preview(
            &roots,
            &request.query,
            &request.replacement,
            request.match_case,
            request.options,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn apply_replacements(
    window: WebviewWindow,
    store: State<'_, Store>,
    project_id: String,
    changes: Vec<crate::search_options::ApplyReplacement>,
) -> Result<Vec<crate::search_options::Applied>, String> {
    crate::require_project(&window, &project_id)?;
    if changes.len() > 200
        || changes
            .iter()
            .map(|item| item.before.len() + item.after.len())
            .sum::<usize>()
            > 20 * 1024 * 1024
    {
        return Err("Replacement batch is too large".into());
    }
    let roots = store.get(&project_id)?.roots;
    tauri::async_runtime::spawn_blocking(move || {
        changes
            .into_iter()
            .map(|change| {
                let result = file_core::authorize_path(&roots, &change.path)
                    .and_then(|path| file_core::save(&path, &change.after, &change.before));
                crate::search_options::Applied {
                    path: change.path,
                    error: result.err(),
                }
            })
            .collect()
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_project(
    window: WebviewWindow,
    store: State<'_, Store>,
    project_id: String,
    name: String,
    roots: Vec<String>,
    color: Option<String>,
) -> Result<crate::projects::Project, String> {
    crate::require_project(&window, &project_id)?;
    let project = store.update(&project_id, name, roots)?;
    store.set_color(&project_id, color.unwrap_or(project.color))
}
#[tauri::command]
pub fn remove_project(
    window: WebviewWindow,
    store: State<'_, Store>,
    project_id: String,
) -> Result<(), String> {
    crate::require_project(&window, &project_id)?;
    store.remove(&project_id)
}

#[tauri::command]
pub fn load_format_options(
    window: WebviewWindow,
    store: State<'_, Store>,
    project_id: String,
    root: String,
) -> Result<Option<crate::formatting::FormatOptions>, String> {
    crate::require_project(&window, &project_id)?;
    let options = store.load_tool(&project_id, "code-settings")?;
    options
        .and_then(|value| {
            value
                .get("roots")
                .and_then(|roots| roots.get(&root))
                .cloned()
        })
        .map(|value| {
            serde_json::from_value(value).map_err(|_| "Invalid saved formatter settings".into())
        })
        .transpose()
}
#[tauri::command]
pub fn save_format_options(
    window: WebviewWindow,
    store: State<'_, Store>,
    project_id: String,
    root: String,
    options: crate::formatting::FormatOptions,
) -> Result<(), String> {
    repo(&window, &store, &project_id, &root)?;
    let mut document = store
        .load_tool(&project_id, "code-settings")?
        .unwrap_or(serde_json::json!({"version":1,"roots":{}}));
    document["roots"][root] = serde_json::to_value(options).map_err(|e| e.to_string())?;
    store.save_tool(&project_id, "code-settings", &document)
}
#[tauri::command]
pub async fn format_php_file(
    window: WebviewWindow,
    store: State<'_, Store>,
    project_id: String,
    root: String,
    path: String,
    expected: String,
    options: crate::formatting::FormatOptions,
) -> Result<String, String> {
    let root = repo(&window, &store, &project_id, &root)?;
    let path = store.authorize_path(&project_id, &path)?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::formatting::format_file(&root, &path, &expected, &options)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn search_everywhere_index(
    window: WebviewWindow,
    store: State<'_, Store>,
    project_id: String,
) -> Result<crate::symbol_search::Index, String> {
    crate::require_project(&window, &project_id)?;
    let roots = store.get(&project_id)?.roots;
    tauri::async_runtime::spawn_blocking(move || crate::symbol_search::index(&roots))
        .await
        .map_err(|error| error.to_string())
}
