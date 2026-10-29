use crate::{
    http_client,
    operations::Operations,
    projects::Store,
    secrets::{self, Vault},
};
use tauri::{State, WebviewWindow};

#[tauri::command]
pub fn load_tool_document(
    window: WebviewWindow,
    store: State<'_, Store>,
    project_id: String,
    tool: String,
) -> Result<Option<serde_json::Value>, String> {
    crate::require_project(&window, &project_id)?;
    store.load_tool(&project_id, &tool)
}
#[tauri::command]
pub async fn save_tool_document(
    window: WebviewWindow,
    store: State<'_, Store>,
    project_id: String,
    tool: String,
    mut document: serde_json::Value,
) -> Result<serde_json::Value, String> {
    crate::require_project(&window, &project_id)?;
    store.get(&project_id)?;
    // Parse before saving: credentials must use the structured secret fields.
    match tool.as_str() {
        "api" => {
            let _: ApiDocument =
                serde_json::from_value(document.clone()).map_err(|_| "Invalid API document")?;
        }
        "servers" => {
            let _: crate::ssh::ServerDocument =
                serde_json::from_value(document.clone()).map_err(|_| "Invalid server document")?;
        }
        "database" => {
            let _: crate::database::DatabaseDocument = serde_json::from_value(document.clone())
                .map_err(|_| "Invalid database document")?;
        }
        _ => return Err("Unknown tool".into()),
    }
    let secret_project = project_id.clone();
    document = tauri::async_runtime::spawn_blocking(move || {
        secrets::seal(&mut document, &secret_project, &Vault)?;
        Ok::<_, String>(document)
    })
    .await
    .map_err(|_| "Credential save task failed")??;
    store.save_tool(&project_id, &tool, &document)?;
    if store.load_tool(&project_id, &tool)?.as_ref() != Some(&document) {
        return Err(
            "Saved settings could not be verified. Keep this project open and retry.".into(),
        );
    }
    Ok(document)
}
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApiDocument {
    #[allow(dead_code)]
    requests: Vec<http_client::ApiRequest>,
    #[allow(dead_code)]
    environments: Vec<ApiEnvironment>,
}
#[derive(serde::Deserialize)]
struct ApiEnvironment {
    #[allow(dead_code)]
    variables: Vec<http_client::ValueRow>,
    #[serde(default)]
    #[allow(dead_code)]
    headers: Vec<http_client::ValueRow>,
}
#[tauri::command]
pub async fn api_send(
    window: WebviewWindow,
    store: State<'_, Store>,
    operations: State<'_, Operations>,
    project_id: String,
    operation_id: String,
    request: http_client::ApiRequest,
    environment: Vec<http_client::ValueRow>,
) -> Result<http_client::ApiResponse, String> {
    crate::require_project(&window, &project_id)?;
    store.get(&project_id)?;
    let token = operations.begin(window.label(), &operation_id)?;
    let result = tokio::select! {_ = token.cancelled()=>Err("Request cancelled".into()), result=http_client::send(request,environment,&project_id,&Vault)=>result};
    operations.finish(window.label(), &operation_id);
    result
}
#[tauri::command]
pub fn cancel_operation(
    window: WebviewWindow,
    operations: State<'_, Operations>,
    operation_id: String,
) {
    operations.cancel(window.label(), &operation_id);
}
