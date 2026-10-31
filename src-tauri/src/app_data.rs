use crate::{
    projects::{CodeDraft, Project, Store, WorkspaceSession},
    secrets::{self, Secrets, Vault},
};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashSet};
use tauri::{State, WebviewWindow};

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectData {
    project: Project,
    session: Option<WorkspaceSession>,
    drafts: Vec<CodeDraft>,
    tools: BTreeMap<String, Value>,
}
#[derive(Serialize, Deserialize)]
pub struct AppData {
    format: String,
    version: u8,
    projects: Vec<ProjectData>,
    #[serde(default)]
    notes: Vec<crate::notes::Note>,
}
#[cfg(test)]
fn reveal(value: &mut Value, project: &str, vault: &impl Secrets) -> Result<(), String> {
    export_credentials(value, project, vault, true, &mut BTreeMap::new())
}
fn export_credentials(
    value: &mut Value,
    project: &str,
    vault: &impl Secrets,
    include: bool,
    cache: &mut BTreeMap<(String, String), String>,
) -> Result<(), String> {
    match value {
        Value::Array(items) => {
            for item in items {
                export_credentials(item, project, vault, include, cache)?;
            }
        }
        Value::Object(object) => {
            if object.get("hasSecret").and_then(Value::as_bool) == Some(true) {
                let id = object
                    .get("id")
                    .and_then(Value::as_str)
                    .ok_or("Invalid credential reference")?;
                let content = if include {
                    let key = (project.to_owned(), id.to_owned());
                    if let Some(content) = cache.get(&key) {
                        content.clone()
                    } else {
                        let content = vault.get(project, id)?;
                        cache.insert(key, content.clone());
                        content
                    }
                } else {
                    String::new()
                };
                object.insert("value".into(), Value::String(content));
                object.insert("hasSecret".into(), Value::Bool(false));
            }
            for child in object.values_mut() {
                export_credentials(child, project, vault, include, cache)?;
            }
        }
        _ => {}
    }
    Ok(())
}
impl Store {
    fn export_app(
        &self,
        vault: &impl Secrets,
        include_credentials: bool,
    ) -> Result<AppData, String> {
        let mut cache = BTreeMap::new();
        let projects = self.list()?;
        let mut db = self.0.lock().map_err(|e| e.to_string())?;
        let tx = db.transaction().map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for project in projects {
            let session: Option<String> = tx
                .query_row(
                    "SELECT state FROM workspace_state WHERE project_id=?1",
                    [&project.id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|e| e.to_string())?;
            let drafts: Option<String> = tx
                .query_row(
                    "SELECT document FROM code_drafts WHERE project_id=?1",
                    [&project.id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|e| e.to_string())?;
            let mut tools = BTreeMap::new();
            let mut stmt = tx
                .prepare("SELECT tool, document FROM tool_documents WHERE project_id=?1")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([&project.id], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(|e| e.to_string())?;
            for row in rows {
                let (tool, raw) = row.map_err(|e| e.to_string())?;
                let mut document: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
                export_credentials(
                    &mut document,
                    &project.id,
                    vault,
                    include_credentials,
                    &mut cache,
                )?;
                tools.insert(tool, document);
            }
            out.push(ProjectData {
                project,
                session: session
                    .map(|raw| serde_json::from_str(&raw))
                    .transpose()
                    .map_err(|e| e.to_string())?,
                drafts: drafts
                    .map(|raw| serde_json::from_str(&raw))
                    .transpose()
                    .map_err(|e| e.to_string())?
                    .unwrap_or_default(),
                tools,
            });
        }
        let read_notes = |table: &str| -> Result<Vec<crate::notes::Note>, String> {
            let mut statement = tx
                .prepare(&format!(
                    "SELECT id,title,text FROM {table} ORDER BY rowid DESC"
                ))
                .map_err(|e| e.to_string())?;
            let rows = statement
                .query_map([], |row| {
                    Ok(crate::notes::Note {
                        id: row.get(0)?,
                        title: row.get(1)?,
                        text: row.get(2)?,
                    })
                })
                .map_err(|e| e.to_string())?;
            rows.map(|row| row.map_err(|e| e.to_string())).collect()
        };
        Ok(AppData {
            notes: read_notes("global_notes")?,
            format: "octode-app-data".into(),
            version: 1,
            projects: out,
        })
    }
    fn import_app(
        &self,
        mut data: AppData,
        vault: &impl Secrets,
    ) -> Result<BTreeMap<String, String>, String> {
        if data.format != "octode-app-data" || data.version != 1 || data.projects.len() > 1000 {
            return Err("Unsupported Octode app data".into());
        }
        if data.notes.len() > 10000
            || data
                .notes
                .iter()
                .any(|note| note.title.chars().count() > 200 || note.text.len() > 2 * 1024 * 1024)
        {
            return Err("Invalid notes in app data".into());
        }
        let mut ids = BTreeMap::new();
        let mut seen = HashSet::new();
        // Validate everything before committing any projects. Missing roots can be relinked later.
        for item in &mut data.projects {
            let project = &mut item.project;
            if uuid::Uuid::parse_str(&project.id).is_err()
                || !seen.insert(project.id.clone())
                || project.name.trim().is_empty()
                || project.name.chars().count() > 100
                || project.roots.is_empty()
                || project.roots.len() > 100
                || project.roots.iter().any(|root| {
                    !std::path::Path::new(root).is_absolute()
                        || std::path::Path::new(root)
                            .components()
                            .any(|part| matches!(part, std::path::Component::ParentDir))
                })
            {
                return Err("Invalid project in app data".into());
            }
            let old = project.id.clone();
            project.id = uuid::Uuid::new_v4().to_string();
            ids.insert(old, project.id.clone());
            if let Some(session) = &item.session {
                if session.version != 1
                    || !["home", "code", "servers", "database", "api"]
                        .contains(&session.tool.as_str())
                    || !project.roots.contains(&session.active_root)
                    || session.open_files.len() > 100
                {
                    return Err("Invalid workspace state in app data".into());
                }
            }
            if item.drafts.len() > 100
                || item.drafts.iter().any(|draft| {
                    !project
                        .roots
                        .iter()
                        .any(|root| std::path::Path::new(&draft.path).starts_with(root))
                        || std::path::Path::new(&draft.path)
                            .components()
                            .any(|part| matches!(part, std::path::Component::ParentDir))
                })
            {
                return Err("Invalid recovery drafts in app data".into());
            }
            for (tool, document) in &mut item.tools {
                if document.get("version").and_then(Value::as_u64) != Some(1)
                    || serde_json::to_vec(document)
                        .map_err(|e| e.to_string())?
                        .len()
                        > 4 * 1024 * 1024
                {
                    return Err("Invalid tool document in app data".into());
                }
                match tool.as_str() {
                    "api" => {
                        serde_json::from_value::<crate::tool_commands::ApiDocument>(
                            document.clone(),
                        )
                        .map_err(|_| "Invalid API document")?;
                    }
                    "servers" => {
                        serde_json::from_value::<crate::ssh::ServerDocument>(document.clone())
                            .map_err(|_| "Invalid server document")?;
                    }
                    "database" => {
                        serde_json::from_value::<crate::database::DatabaseDocument>(
                            document.clone(),
                        )
                        .map_err(|_| "Invalid database document")?;
                    }
                    "code-settings" => {}
                    _ => return Err("Unknown tool in app data".into()),
                }
                secrets::seal(document, &project.id, vault)?;
            }
        }
        let mut db = self.0.lock().map_err(|e| e.to_string())?;
        let tx = db.transaction().map_err(|e| e.to_string())?;
        // Import copies with new IDs; existing live notes/drafts are never overwritten.
        for note in data.notes.into_iter().rev() {
            tx.execute(
                "INSERT INTO global_notes(id,title,text) VALUES (?1,?2,?3)",
                params![uuid::Uuid::new_v4().to_string(), note.title, note.text],
            )
            .map_err(|e| e.to_string())?;
        }
        for item in data.projects {
            let p = item.project;
            tx.execute(
                "INSERT INTO projects(id,name,roots,updated_at) VALUES (?1,?2,?3,?4)",
                params![
                    p.id,
                    p.name,
                    serde_json::to_string(&p.roots).map_err(|e| e.to_string())?,
                    p.updated_at
                ],
            )
            .map_err(|e| e.to_string())?;
            tx.execute(
                "INSERT INTO project_colors(project_id,color) VALUES (?1,?2)",
                params![p.id, p.color],
            )
            .map_err(|e| e.to_string())?;
            if let Some(session) = item.session {
                tx.execute(
                    "INSERT INTO workspace_state(project_id,state) VALUES (?1,?2)",
                    params![
                        p.id,
                        serde_json::to_string(&session).map_err(|e| e.to_string())?
                    ],
                )
                .map_err(|e| e.to_string())?;
            }
            tx.execute(
                "INSERT INTO code_drafts(project_id,document) VALUES (?1,?2)",
                params![
                    p.id,
                    serde_json::to_string(&item.drafts).map_err(|e| e.to_string())?
                ],
            )
            .map_err(|e| e.to_string())?;
            for (tool, document) in item.tools {
                tx.execute(
                    "INSERT INTO tool_documents(project_id,tool,document) VALUES (?1,?2,?3)",
                    params![p.id, tool, document.to_string()],
                )
                .map_err(|e| e.to_string())?;
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(ids)
    }
}
#[tauri::command]
pub async fn export_app_data(
    window: WebviewWindow,
    store: State<'_, Store>,
    include_credentials: Option<bool>,
) -> Result<AppData, String> {
    if window.label() != "main" {
        return Err("Use the main window".into());
    }
    store.export_app(&Vault, include_credentials.unwrap_or(false))
}
#[tauri::command]
pub async fn import_app_data(
    window: WebviewWindow,
    store: State<'_, Store>,
    data: AppData,
) -> Result<BTreeMap<String, String>, String> {
    if window.label() != "main" {
        return Err("Use the main window".into());
    }
    if serde_json::to_vec(&data).map_err(|e| e.to_string())?.len() > 20 * 1024 * 1024 {
        return Err("App data exceeds 20 MB".into());
    }
    store.import_app(data, &Vault)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn restores_all_project_data_with_new_ids_and_portable_secrets() {
        let vault = crate::secrets::tests::Memory::default();
        let source = Store::open(std::path::Path::new(":memory:")).unwrap();
        let project = source
            .create(
                "Example".into(),
                vec![std::env::temp_dir().to_string_lossy().into_owned()],
            )
            .unwrap();
        source.set_color(&project.id, "#68caff".into()).unwrap();
        let mut document = serde_json::json!({"version":1,"folders":[],"requests":[],"environments":[{"id":"env","name":"Dev","variables":[],"headers":[{"id":"header","name":"Authorization","value":"Bearer portable","enabled":true}]}]});
        secrets::seal(&mut document, &project.id, &vault).unwrap();
        source.save_tool(&project.id, "api", &document).unwrap();
        let session = WorkspaceSession {
            version: 1,
            tool: "api".into(),
            open_files: vec![],
            active_file: String::new(),
            active_root: project.roots[0].clone(),
            terminal_visible: true,
        };
        source.save_session(&project.id, &session).unwrap();
        let draft_path = std::path::Path::new(&project.roots[0])
            .join("recovery.txt")
            .to_string_lossy()
            .into_owned();
        source
            .save_drafts(
                &project.id,
                &[CodeDraft {
                    path: draft_path,
                    text: "unsaved".into(),
                    saved: "original".into(),
                }],
            )
            .unwrap();
        source
            .save_tool(
                &project.id,
                "code-settings",
                &serde_json::json!({"version":1,"formatter":"pint"}),
            )
            .unwrap();
        let backup = source.export_app(&vault, true).unwrap();
        assert!(serde_json::to_string(&backup)
            .unwrap()
            .contains("Bearer portable"));
        let ids = source.import_app(backup, &vault).unwrap();
        assert_eq!(source.list().unwrap().len(), 2);
        let restored = &ids[&project.id];
        assert_ne!(restored, &project.id);
        assert_eq!(source.get(restored).unwrap().color, "#68caff");
        assert_eq!(source.load_session(restored).unwrap().unwrap().tool, "api");
        assert!(
            source
                .load_session(restored)
                .unwrap()
                .unwrap()
                .terminal_visible
        );
        assert_eq!(source.load_drafts(restored).unwrap()[0].text, "unsaved");
        assert_eq!(
            source
                .load_tool(restored, "code-settings")
                .unwrap()
                .unwrap()["formatter"],
            "pint"
        );
        let mut restored_doc = source.load_tool(restored, "api").unwrap().unwrap();
        assert!(!restored_doc.to_string().contains("Bearer portable"));
        reveal(&mut restored_doc, restored, &vault).unwrap();
        assert!(restored_doc.to_string().contains("Bearer portable"));
    }
    #[test]
    fn credential_free_exports_never_read_keychain_and_can_be_restored() {
        struct NoReads;
        impl Secrets for NoReads {
            fn set(&self, _: &str, _: &str, _: &str) -> Result<(), String> {
                panic!("unexpected write")
            }
            fn get(&self, _: &str, _: &str) -> Result<String, String> {
                panic!("unexpected Keychain read")
            }
        }
        let store = Store::open(std::path::Path::new(":memory:")).unwrap();
        let project = store
            .create(
                "Fixture".into(),
                vec![std::env::temp_dir().to_string_lossy().into_owned()],
            )
            .unwrap();
        let mut document = serde_json::json!({"version":1,"connections":[],"queries":[],"credential":{"id":"draft","value":"private","secret":true}});
        secrets::seal(
            &mut document,
            &project.id,
            &crate::secrets::tests::Memory::default(),
        )
        .unwrap();
        store.save_tool(&project.id, "database", &document).unwrap();
        let backup = store.export_app(&NoReads, false).unwrap();
        let field = &backup.projects[0].tools["database"]["credential"];
        assert_eq!(field["value"], "");
        assert_eq!(field["hasSecret"], false);
        store.import_app(backup, &NoReads).unwrap();
    }
    #[test]
    fn export_reads_each_reference_once_and_stops_on_denial() {
        struct Counting(std::sync::atomic::AtomicUsize);
        impl Secrets for Counting {
            fn set(&self, _: &str, _: &str, _: &str) -> Result<(), String> {
                unreachable!()
            }
            fn get(&self, _: &str, id: &str) -> Result<String, String> {
                self.0.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                if id == "denied" {
                    Err("Access denied".into())
                } else {
                    Ok("fixture".into())
                }
            }
        }
        let vault = Counting(std::sync::atomic::AtomicUsize::new(0));
        let mut doc =
            serde_json::json!([{"id":"same","hasSecret":true},{"id":"same","hasSecret":true}]);
        reveal(&mut doc, "project", &vault).unwrap();
        assert_eq!(vault.0.load(std::sync::atomic::Ordering::SeqCst), 1);
        let mut doc =
            serde_json::json!([{"id":"denied","hasSecret":true},{"id":"other","hasSecret":true}]);
        assert!(reveal(&mut doc, "project", &vault).is_err());
        assert_eq!(vault.0.load(std::sync::atomic::Ordering::SeqCst), 2);
    }
    #[test]
    fn rejects_bad_import_without_creating_projects() {
        let store = Store::open(std::path::Path::new(":memory:")).unwrap();
        let data = AppData {
            notes: vec![],
            format: "wrong".into(),
            version: 1,
            projects: vec![],
        };
        assert!(store
            .import_app(data, &crate::secrets::tests::Memory::default())
            .is_err());
        assert!(store.list().unwrap().is_empty());
    }
    #[test]
    fn notes_round_trip_as_copies_and_legacy_backups_remain_valid() {
        let vault = crate::secrets::tests::Memory::default();
        let source = Store::open(std::path::Path::new(":memory:")).unwrap();
        {
            let db = source.0.lock().unwrap();
            db.execute(
                "INSERT INTO global_notes VALUES ('note','scratch.sql','select 1;')",
                [],
            )
            .unwrap();
        }
        let backup = source.export_app(&vault, true).unwrap();
        assert_eq!(backup.notes[0].text, "select 1;");
        let target = Store::open(std::path::Path::new(":memory:")).unwrap();
        {
            target
                .0
                .lock()
                .unwrap()
                .execute(
                    "INSERT INTO global_notes VALUES ('existing','Existing','keep')",
                    [],
                )
                .unwrap();
        }
        target.import_app(backup, &vault).unwrap();
        let notes = crate::notes::load(&target).unwrap();
        assert_eq!(notes.len(), 2);
        assert!(notes
            .iter()
            .any(|note| note.id != "note" && note.text == "select 1;"));
        let legacy: AppData = serde_json::from_value(
            serde_json::json!({"format":"octode-app-data","version":1,"projects":[]}),
        )
        .unwrap();
        target.import_app(legacy, &vault).unwrap();
        assert_eq!(crate::notes::load(&target).unwrap().len(), 2);
        let invalid: AppData = serde_json::from_value(serde_json::json!({"format":"octode-app-data","version":1,"projects":[],"notes":[{"id":"x","title":"x","text":"x".repeat(2*1024*1024+1)}]})).unwrap();
        assert!(target.import_app(invalid, &vault).is_err());
        assert_eq!(crate::notes::load(&target).unwrap().len(), 2);
    }
}
