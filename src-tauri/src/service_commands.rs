use crate::{
    database::{DatabaseConnection, Databases, DbResult},
    operations::Operations,
    projects::Store,
    ssh::{self, ServerConnection, Servers},
    terminal::Output,
};
use tauri::Manager;
use tauri::{ipc::Channel, State, WebviewWindow};
fn authorize(window: &WebviewWindow, store: &Store, project: &str) -> Result<(), String> {
    crate::require_project(window, project)?;
    store.get(project)?;
    Ok(())
}
#[tauri::command]
pub async fn ssh_fingerprint(
    window: WebviewWindow,
    store: State<'_, Store>,
    project_id: String,
    connection: ServerConnection,
) -> Result<String, String> {
    authorize(&window, &store, &project_id)?;
    ssh::fingerprint(connection).await
}
#[tauri::command]
pub async fn ssh_connect(
    window: WebviewWindow,
    store: State<'_, Store>,
    servers: State<'_, Servers>,
    project_id: String,
    connection: ServerConnection,
) -> Result<String, String> {
    authorize(&window, &store, &project_id)?;
    let handle = tokio::time::timeout(
        std::time::Duration::from_secs(45),
        ssh::authenticate(&connection, &project_id),
    )
    .await
    .map_err(|_| "SSH authentication timed out")??;
    servers.insert(window.label(), &project_id, handle)
}
#[tauri::command]
pub fn ssh_close(window: WebviewWindow, servers: State<'_, Servers>, id: String) {
    servers.close(window.label(), &id);
}
#[tauri::command]
pub async fn ssh_shell(
    window: WebviewWindow,
    servers: State<'_, Servers>,
    id: String,
    shell_key: String,
    cols: u32,
    rows: u32,
    output: Channel<Output>,
) -> Result<(), String> {
    servers
        .shell(window.label(), &id, shell_key, cols, rows, output)
        .await
}
#[tauri::command]
pub async fn ssh_write(
    window: WebviewWindow,
    servers: State<'_, Servers>,
    id: String,
    data: String,
) -> Result<(), String> {
    servers.write(window.label(), &id, data).await
}
#[tauri::command]
pub async fn ssh_resize(
    window: WebviewWindow,
    servers: State<'_, Servers>,
    id: String,
    cols: u32,
    rows: u32,
) -> Result<(), String> {
    servers.resize(window.label(), &id, cols, rows).await
}
#[tauri::command]
pub fn ssh_ack(
    window: WebviewWindow,
    servers: State<'_, Servers>,
    id: String,
    bytes: usize,
) -> Result<(), String> {
    servers.ack(window.label(), &id, bytes)
}
#[tauri::command]
pub async fn sftp_list(
    window: WebviewWindow,
    servers: State<'_, Servers>,
    id: String,
    path: String,
) -> Result<ssh::Directory, String> {
    let session = servers.get(window.label(), &id)?;
    tokio::time::timeout(std::time::Duration::from_secs(30), session.list(&path))
        .await
        .map_err(|_| "SFTP listing timed out")?
}
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Transfer {
    operation_id: String,
    remote: String,
    local: String,
    upload: bool,
}
#[tauri::command]
pub async fn sftp_transfer(
    window: WebviewWindow,
    servers: State<'_, Servers>,
    operations: State<'_, Operations>,
    id: String,
    request: Transfer,
    progress: Channel<crate::transfer::Progress>,
) -> Result<u64, String> {
    let Transfer {
        operation_id,
        remote,
        local,
        upload,
    } = request;
    let session = servers.get(window.label(), &id)?;
    let token = operations.begin(window.label(), &operation_id)?;
    let result = tokio::select! {_=token.cancelled()=>Err("Transfer cancelled; an uploaded file may be incomplete".into()),_=session.cancel.cancelled()=>Err("SSH connection closed".into()),result=session.transfer(&remote,&local,upload,progress)=>result};
    operations.finish(window.label(), &operation_id);
    result
}
#[tauri::command]
pub async fn sftp_mutate(
    window: WebviewWindow,
    servers: State<'_, Servers>,
    id: String,
    action: String,
    path: String,
    destination: String,
) -> Result<(), String> {
    let session = servers.get(window.label(), &id)?;
    tokio::time::timeout(
        std::time::Duration::from_secs(30),
        session.mutate(&action, &path, &destination),
    )
    .await
    .map_err(|_| "SFTP action timed out; refresh before retrying")?
}
#[tauri::command]
pub async fn database_connect(
    window: WebviewWindow,
    store: State<'_, Store>,
    servers: State<'_, Servers>,
    databases: State<'_, Databases>,
    project_id: String,
    connection: DatabaseConnection,
    ssh_session: Option<String>,
) -> Result<String, String> {
    authorize(&window, &store, &project_id)?;
    let ssh = match ssh_session {
        Some(id) => {
            let session = servers.get(window.label(), &id)?;
            if session.project != project_id {
                return Err("The SSH connection belongs to another project".into());
            }
            Some(session)
        }
        None => None,
    };
    if !connection.ssh_id.is_empty() && ssh.is_none() {
        return Err("Connect the selected SSH server first".into());
    }
    databases
        .connect(window.label(), &project_id, connection, ssh)
        .await
}
#[tauri::command]
pub fn database_close(window: WebviewWindow, databases: State<'_, Databases>, id: String) {
    databases.close(window.label(), &id);
}
#[tauri::command]
pub async fn database_tables(
    window: WebviewWindow,
    databases: State<'_, Databases>,
    id: String,
) -> Result<DbResult, String> {
    databases.get(window.label(), &id)?.tables().await
}
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Query {
    pub sql: String,
    pub operation_id: String,
}
#[tauri::command]
pub async fn database_query(
    window: WebviewWindow,
    databases: State<'_, Databases>,
    operations: State<'_, Operations>,
    id: String,
    request: Query,
) -> Result<DbResult, String> {
    let session = databases.get(window.label(), &id)?;
    let token = operations.begin(window.label(), &request.operation_id)?;
    let result = tokio::select! {_=token.cancelled()=>Err("Query connection dropped. Verify the server outcome before retrying a write.".into()),result=session.query(&request.sql,1000)=>result};
    operations.finish(window.label(), &request.operation_id);
    result
}
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Browse {
    schema: String,
    table: String,
    filter: String,
    sort: String,
    descending: bool,
    page: u32,
}
#[tauri::command]
pub async fn database_browse(
    window: WebviewWindow,
    databases: State<'_, Databases>,
    id: String,
    request: Browse,
) -> Result<DbResult, String> {
    databases
        .get(window.label(), &id)?
        .browse(
            &request.schema,
            &request.table,
            &request.filter,
            &request.sort,
            request.descending,
            request.page,
        )
        .await
}
#[tauri::command]
pub fn close_project_services(
    window: WebviewWindow,
    databases: State<'_, Databases>,
    servers: State<'_, Servers>,
    operations: State<'_, Operations>,
) {
    databases.close_window(window.label());
    servers.close_window(window.label());
    operations.close_window(window.label());
}

#[tauri::command]
pub fn ssh_shell_close(
    window: WebviewWindow,
    servers: State<'_, Servers>,
    id: String,
    shell_key: String,
) {
    servers.shell_close(window.label(), &id, &shell_key);
}

#[tauri::command]
pub fn ssh_connected(window: WebviewWindow, servers: State<'_, Servers>, id: String) -> bool {
    servers.get(window.label(), &id).is_ok()
}

#[tauri::command]
pub async fn database_metadata(
    window: WebviewWindow,
    databases: State<'_, Databases>,
    id: String,
    schema: String,
    table: String,
) -> Result<crate::database::TableMetadata, String> {
    databases
        .get(window.label(), &id)?
        .metadata(&schema, &table)
        .await
}
#[derive(serde::Deserialize)]
pub struct RowRequest {
    schema: String,
    table: String,
    changes: Vec<crate::database::RowChange>,
}
#[tauri::command]
pub async fn database_row_plan(
    window: WebviewWindow,
    databases: State<'_, Databases>,
    id: String,
    request: RowRequest,
) -> Result<crate::database::RowPlan, String> {
    databases
        .get(window.label(), &id)?
        .row_plan(&request.schema, &request.table, &request.changes)
        .await
}
#[derive(serde::Deserialize)]
pub struct ApplyRows {
    schema: String,
    table: String,
    changes: Vec<crate::database::RowChange>,
    reviewed: crate::database::RowPlan,
}
#[tauri::command]
pub async fn database_apply_rows(
    window: WebviewWindow,
    databases: State<'_, Databases>,
    id: String,
    request: ApplyRows,
) -> Result<u64, String> {
    databases
        .get(window.label(), &id)?
        .apply_rows(
            &request.schema,
            &request.table,
            &request.changes,
            &request.reviewed,
        )
        .await
}

#[tauri::command]
pub fn ssh_key_directory(app: tauri::AppHandle) -> Result<String, String> {
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    let ssh = home.join(".ssh");
    Ok(if ssh.is_dir() { ssh } else { home }
        .to_string_lossy()
        .into_owned())
}
