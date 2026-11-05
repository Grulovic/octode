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
    #[serde(default)]
    note_folders: Vec<crate::notes::NoteFolder>,
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
#[derive(Clone, Copy, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ImportMode {
    #[default]
    Merge,
    Replace,
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
                    "SELECT n.id,n.title,n.text,COALESCE(l.folder_id,'') FROM {table} n LEFT JOIN global_note_locations l ON l.note_id=n.id LEFT JOIN global_note_order o ON o.note_id=n.id ORDER BY COALESCE(o.position,-1),n.rowid DESC"
                ))
                .map_err(|e| e.to_string())?;
            let rows = statement
                .query_map([], |row| {
                    Ok(crate::notes::Note {
                        id: row.get(0)?,
                        title: row.get(1)?,
                        text: row.get(2)?,
                        folder_id: row.get(3)?,
                    })
                })
                .map_err(|e| e.to_string())?;
            rows.map(|row| row.map_err(|e| e.to_string())).collect()
        };
        Ok(AppData {
            notes: read_notes("global_notes")?,
            note_folders: crate::notes::read_folders(&tx)?,
            format: "octode-app-data".into(),
            version: 1,
            projects: out,
        })
    }
    #[cfg(test)]
    fn import_app(
        &self,
        data: AppData,
        vault: &impl Secrets,
    ) -> Result<BTreeMap<String, String>, String> {
        self.import_app_mode(data, vault, ImportMode::Merge)
    }
    fn import_app_mode(
        &self,
        mut data: AppData,
        vault: &impl Secrets,
        mode: ImportMode,
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
        crate::notes::validate_folders(&data.note_folders)?;
        if data.notes.iter().any(|note| {
            !note.folder_id.is_empty()
                && !data
                    .note_folders
                    .iter()
                    .any(|folder| folder.id == note.folder_id)
        }) {
            return Err("Missing note folder in app data".into());
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
        // Replacement is atomic: validation and credential verification have already succeeded.
        if mode == ImportMode::Replace {
            tx.execute("DELETE FROM projects", [])
                .map_err(|e| e.to_string())?;
            tx.execute("DELETE FROM global_note_folders", [])
                .map_err(|e| e.to_string())?;
            tx.execute("DELETE FROM global_notes", [])
                .map_err(|e| e.to_string())?;
        }
        let folder_ids: BTreeMap<_, _> = data
            .note_folders
            .iter()
            .map(|folder| (folder.id.clone(), uuid::Uuid::new_v4().to_string()))
            .collect();
        for folder in data.note_folders {
            tx.execute(
                "INSERT INTO global_note_folders(id,name,parent_id) VALUES (?1,?2,?3)",
                params![
                    folder_ids[&folder.id],
                    folder.name,
                    folder_ids
                        .get(&folder.parent_id)
                        .cloned()
                        .unwrap_or_default()
                ],
            )
            .map_err(|e| e.to_string())?;
        }
        // New IDs keep imported credentials isolated from previous references.
        // Put imported copies before existing notes without changing their order.
        let first_position = tx
            .query_row(
                "SELECT MIN(COALESCE(o.position,-1)) FROM global_notes n LEFT JOIN global_note_order o ON o.note_id=n.id",
                [],
                |row| row.get::<_, Option<i64>>(0),
            )
            .map_err(|e| e.to_string())?
            .unwrap_or(0)
            - data.notes.len() as i64;
        for (position, note) in data.notes.into_iter().enumerate() {
            let id = uuid::Uuid::new_v4().to_string();
            tx.execute(
                "INSERT INTO global_notes(id,title,text) VALUES (?1,?2,?3)",
                params![id, note.title, note.text],
            )
            .map_err(|e| e.to_string())?;
            tx.execute(
                "INSERT INTO global_note_order(note_id,position) VALUES (?1,?2)",
                params![id, first_position + position as i64],
            )
            .map_err(|e| e.to_string())?;
            tx.execute(
                "INSERT INTO global_note_locations(note_id,folder_id) VALUES (?1,?2)",
                params![
                    id,
                    folder_ids.get(&note.folder_id).cloned().unwrap_or_default()
                ],
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
    mode: Option<ImportMode>,
) -> Result<BTreeMap<String, String>, String> {
    if window.label() != "main" {
        return Err("Use the main window".into());
    }
    if serde_json::to_vec(&data).map_err(|e| e.to_string())?.len() > 20 * 1024 * 1024 {
        return Err("App data exceeds 20 MB".into());
    }
    store.import_app_mode(data, &Vault, mode.unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn replacement_validates_first_and_replaces_all_metadata_atomically() {
        let vault = crate::secrets::tests::Memory::default();
        let target = Store::open(std::path::Path::new(":memory:")).unwrap();
        let old = target
            .create("Existing".into(), vec!["/tmp".into()])
            .unwrap();
        target
            .save_tool(&old.id, "code-settings", &serde_json::json!({"version":1}))
            .unwrap();
        target
            .0
            .lock()
            .unwrap()
            .execute(
                "INSERT INTO global_notes VALUES ('old','Old','keep until success')",
                [],
            )
            .unwrap();
        let invalid = AppData {
            format: "wrong".into(),
            version: 1,
            projects: vec![],
            notes: vec![],
            note_folders: vec![],
        };
        assert!(target
            .import_app_mode(invalid, &vault, ImportMode::Replace)
            .is_err());
        assert_eq!(target.list().unwrap().len(), 1);
        assert_eq!(crate::notes::load(&target).unwrap()[0].id, "old");
        let source = Store::open(std::path::Path::new(":memory:")).unwrap();
        source
            .create("Restored".into(), vec!["/tmp".into()])
            .unwrap();
        source
            .0
            .lock()
            .unwrap()
            .execute(
                "INSERT INTO global_notes VALUES ('new','New','restored')",
                [],
            )
            .unwrap();
        target
            .import_app_mode(
                source.export_app(&vault, true).unwrap(),
                &vault,
                ImportMode::Replace,
            )
            .unwrap();
        assert_eq!(target.list().unwrap().len(), 1);
        assert_eq!(target.list().unwrap()[0].name, "Restored");
        assert!(target.get(&old.id).is_err());
        let db = target.0.lock().unwrap();
        let old_tools: i64 = db
            .query_row(
                "SELECT COUNT(*) FROM tool_documents WHERE project_id=?1",
                [&old.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(old_tools, 0);
        drop(db);
        assert_eq!(crate::notes::load(&target).unwrap().len(), 1);
        assert_eq!(crate::notes::load(&target).unwrap()[0].text, "restored");
    }
    #[test]
    fn replacement_rolls_back_deletes_if_an_insert_fails() {
        let vault = crate::secrets::tests::Memory::default();
        let target = Store::open(std::path::Path::new(":memory:")).unwrap();
        let old = target
            .create("Existing".into(), vec!["/tmp".into()])
            .unwrap();
        target.0.lock().unwrap().execute_batch("CREATE TRIGGER fail_restore BEFORE INSERT ON projects WHEN NEW.name='Restored' BEGIN SELECT RAISE(ABORT,'fixture failure'); END;").unwrap();
        let source = Store::open(std::path::Path::new(":memory:")).unwrap();
        source
            .create("Restored".into(), vec!["/tmp".into()])
            .unwrap();
        assert!(target
            .import_app_mode(
                source.export_app(&vault, false).unwrap(),
                &vault,
                ImportMode::Replace
            )
            .is_err());
        assert_eq!(target.list().unwrap()[0].id, old.id);
    }
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
            note_folders: vec![],
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
    fn note_order_survives_export_and_merge_import() {
        let vault = crate::secrets::tests::Memory::default();
        let source = Store::open(std::path::Path::new(":memory:")).unwrap();
        source.0.lock().unwrap().execute_batch("INSERT INTO global_notes VALUES ('one','One','first'),('two','Two','second'); INSERT INTO global_note_order VALUES ('one',0),('two',1);").unwrap();
        let backup = source.export_app(&vault, true).unwrap();
        assert_eq!(
            backup
                .notes
                .iter()
                .map(|note| note.title.as_str())
                .collect::<Vec<_>>(),
            vec!["One", "Two"]
        );
        let target = Store::open(std::path::Path::new(":memory:")).unwrap();
        target.0.lock().unwrap().execute_batch("INSERT INTO global_notes VALUES ('old','Old','existing'); INSERT INTO global_note_order VALUES ('old',0);").unwrap();
        target.import_app(backup, &vault).unwrap();
        assert_eq!(
            crate::notes::load(&target)
                .unwrap()
                .iter()
                .map(|note| note.title.as_str())
                .collect::<Vec<_>>(),
            vec!["One", "Two", "Old"]
        );
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
        source.0.lock().unwrap().execute_batch("INSERT INTO global_note_folders VALUES ('work','Work',''),('sql','SQL','work'); INSERT INTO global_note_locations VALUES ('note','sql');").unwrap();
        let backup = source.export_app(&vault, true).unwrap();
        assert_eq!(backup.notes[0].text, "select 1;");
        assert_eq!(backup.note_folders.len(), 2);
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
        {
            let db = target.0.lock().unwrap();
            let folders = crate::notes::read_folders(&db).unwrap();
            assert_eq!(folders.len(), 2);
            let sql = folders.iter().find(|folder| folder.name == "SQL").unwrap();
            let work = folders.iter().find(|folder| folder.name == "Work").unwrap();
            assert_ne!(sql.id, "sql");
            assert_eq!(sql.parent_id, work.id);
            assert_eq!(
                notes
                    .iter()
                    .find(|note| note.title == "scratch.sql")
                    .unwrap()
                    .folder_id,
                sql.id
            );
        }
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
