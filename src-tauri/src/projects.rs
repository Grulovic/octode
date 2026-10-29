use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

pub struct Store(pub Mutex<Connection>);

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    #[serde(default = "default_color")]
    pub color: String,
    pub roots: Vec<String>,
    pub updated_at: i64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSession {
    pub version: u8,
    pub tool: String,
    pub open_files: Vec<String>,
    pub active_file: String,
    pub active_root: String,
    pub terminal_visible: bool,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct CodeDraft {
    pub path: String,
    pub text: String,
    pub saved: String,
}
fn default_color() -> String {
    "#80cbc4".into()
}
impl Store {
    pub fn open(path: &Path) -> Result<Self, String> {
        let db = Connection::open(path).map_err(|e| e.to_string())?;
        db.pragma_update(None, "synchronous", "FULL")
            .map_err(|error| error.to_string())?;
        let version: u32 = db
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .map_err(|e| e.to_string())?;
        if version > 5 {
            return Err("This metadata database was created by a newer version of Octode".into());
        }
        if (1..5).contains(&version) && path != Path::new(":memory:") {
            let backup = path.with_file_name(format!("octode-before-v5-{}.sqlite", now()));
            db.execute("VACUUM INTO ?1", [backup.to_string_lossy().as_ref()])
                .map_err(|e| e.to_string())?;
        }
        db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; BEGIN; CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, roots TEXT NOT NULL, updated_at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS workspace_state (project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE, state TEXT NOT NULL); CREATE TABLE IF NOT EXISTS tool_documents (project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, tool TEXT NOT NULL, document TEXT NOT NULL, PRIMARY KEY(project_id,tool)); CREATE TABLE IF NOT EXISTS code_drafts (project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE, document TEXT NOT NULL); CREATE TABLE IF NOT EXISTS project_colors (project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE, color TEXT NOT NULL); PRAGMA user_version=5; COMMIT;").map_err(|e| e.to_string())?;
        Ok(Self(Mutex::new(db)))
    }

    pub fn list(&self) -> Result<Vec<Project>, String> {
        let db = self.0.lock().map_err(|e| e.to_string())?;
        let mut statement = db
            .prepare("SELECT p.id, p.name, p.roots, p.updated_at, COALESCE(c.color, '#80cbc4') FROM projects p LEFT JOIN project_colors c ON p.id=c.project_id ORDER BY p.updated_at DESC")
            .map_err(|e| e.to_string())?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, String>(4)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        rows.map(|row| {
            let (id, name, roots, updated_at, color) = row.map_err(|e| e.to_string())?;
            Ok(Project {
                id,
                name,
                color,
                roots: serde_json::from_str(&roots).map_err(|e| e.to_string())?,
                updated_at,
            })
        })
        .collect()
    }

    pub fn set_color(&self, id: &str, color: String) -> Result<Project, String> {
        let color = color.to_ascii_lowercase();
        if ![
            "#80cbc4", "#68caff", "#bd9df2", "#e6a1cb", "#ff787d", "#fb9551", "#e7d175", "#98d792",
            "#51c5c5", "#b0bec5",
        ]
        .contains(&color.as_str())
        {
            return Err("Choose one of the ten project colors".into());
        }
        self.0.lock().map_err(|error| error.to_string())?.execute(
            "INSERT INTO project_colors(project_id,color) VALUES (?1,?2) ON CONFLICT(project_id) DO UPDATE SET color=excluded.color", params![id, color]
        ).map_err(|error| error.to_string())?;
        self.get(id)
    }

    pub fn get(&self, id: &str) -> Result<Project, String> {
        self.list()?
            .into_iter()
            .find(|project| project.id == id)
            .ok_or_else(|| "Project does not exist".into())
    }

    pub fn create(&self, name: String, roots: Vec<String>) -> Result<Project, String> {
        if name.trim().is_empty() || name.chars().count() > 100 {
            return Err("Use a project name between 1 and 100 characters".into());
        }
        if roots.is_empty() {
            return Err("Choose at least one project folder".into());
        }
        let mut canonical_roots = Vec::new();
        for root in roots {
            let path = Path::new(&root).canonicalize().map_err(|e| e.to_string())?;
            if !path.is_dir() {
                return Err("Project roots must be folders".into());
            }
            let path = path.to_string_lossy().into_owned();
            if !canonical_roots.contains(&path) {
                canonical_roots.push(path);
            }
        }
        let project = Project {
            id: uuid::Uuid::new_v4().to_string(),
            name: name.trim().into(),
            color: default_color(),
            roots: canonical_roots,
            updated_at: now(),
        };
        self.0
            .lock()
            .map_err(|e| e.to_string())?
            .execute(
                "INSERT INTO projects(id, name, roots, updated_at) VALUES (?1, ?2, ?3, ?4)",
                params![
                    project.id,
                    project.name,
                    serde_json::to_string(&project.roots).map_err(|e| e.to_string())?,
                    project.updated_at
                ],
            )
            .map_err(|e| e.to_string())?;
        Ok(project)
    }

    pub fn update(&self, id: &str, name: String, roots: Vec<String>) -> Result<Project, String> {
        let previous = self.get(id)?;
        if name.trim().is_empty() || name.chars().count() > 100 || roots.is_empty() {
            return Err("Use a project name and at least one folder".into());
        }
        let mut normalized = Vec::new();
        for root in roots {
            let path = Path::new(&root).canonicalize().map_err(|e| e.to_string())?;
            if !path.is_dir() {
                return Err("Project roots must be folders".into());
            }
            let path = path.to_string_lossy().into_owned();
            if !normalized.contains(&path) {
                normalized.push(path);
            }
        }
        let project = Project {
            id: id.into(),
            name: name.trim().into(),
            color: previous.color.clone(),
            roots: normalized,
            updated_at: now(),
        };
        let mut db = self.0.lock().map_err(|e| e.to_string())?;
        let transaction = db.transaction().map_err(|e| e.to_string())?;
        transaction
            .execute(
                "UPDATE projects SET name=?2,roots=?3,updated_at=?4 WHERE id=?1",
                params![
                    id,
                    project.name,
                    serde_json::to_string(&project.roots).map_err(|e| e.to_string())?,
                    project.updated_at
                ],
            )
            .map_err(|e| e.to_string())?;
        if previous.roots != project.roots {
            transaction
                .execute("DELETE FROM workspace_state WHERE project_id=?1", [id])
                .map_err(|e| e.to_string())?;
            let drafts = self_drafts_in_roots(&transaction, id, &project.roots)?;
            transaction
                .execute(
                    "UPDATE code_drafts SET document=?2 WHERE project_id=?1",
                    params![
                        id,
                        serde_json::to_string(&drafts).map_err(|e| e.to_string())?
                    ],
                )
                .map_err(|e| e.to_string())?;
        }
        transaction.commit().map_err(|e| e.to_string())?;
        Ok(project)
    }
    pub fn remove(&self, id: &str) -> Result<(), String> {
        self.get(id)?;
        self.0
            .lock()
            .map_err(|e| e.to_string())?
            .execute("DELETE FROM projects WHERE id=?1", [id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    pub fn touch(&self, id: &str) -> Result<(), String> {
        self.0
            .lock()
            .map_err(|e| e.to_string())?
            .execute(
                "UPDATE projects SET updated_at=?1 WHERE id=?2",
                params![now(), id],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn load_session(&self, id: &str) -> Result<Option<WorkspaceSession>, String> {
        self.get(id)?;
        let db = self.0.lock().map_err(|e| e.to_string())?;
        let raw: Option<String> = db
            .query_row(
                "SELECT state FROM workspace_state WHERE project_id=?1",
                [id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        raw.map(|value| serde_json::from_str(&value).map_err(|e| e.to_string()))
            .transpose()
    }

    pub fn save_session(&self, id: &str, session: &WorkspaceSession) -> Result<(), String> {
        let project = self.get(id)?;
        if session.version != 1
            || !["home", "code", "servers", "database", "api"].contains(&session.tool.as_str())
            || !project.roots.contains(&session.active_root)
            || session.open_files.len() > 100
            || session.open_files.iter().any(|path| path.len() > 4096)
        {
            return Err("Invalid workspace state".into());
        }
        let state = serde_json::to_string(session).map_err(|e| e.to_string())?;
        if state.len() > 512 * 1024 {
            return Err("Workspace state exceeds the storage limit".into());
        }
        self.0.lock().map_err(|e| e.to_string())?.execute("INSERT INTO workspace_state(project_id,state) VALUES (?1,?2) ON CONFLICT(project_id) DO UPDATE SET state=excluded.state",params![id,state]).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn authorize_path(&self, project_id: &str, path: &str) -> Result<PathBuf, String> {
        let project = self.get(project_id)?;
        crate::file_core::authorize_path(&project.roots, path)
    }

    pub fn load_drafts(&self, project: &str) -> Result<Vec<CodeDraft>, String> {
        self.get(project)?;
        let db = self.0.lock().map_err(|e| e.to_string())?;
        let raw: Option<String> = db
            .query_row(
                "SELECT document FROM code_drafts WHERE project_id=?1",
                [project],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        raw.map(|raw| serde_json::from_str(&raw).map_err(|e| e.to_string()))
            .unwrap_or(Ok(Vec::new()))
    }
    pub fn save_drafts(&self, project: &str, drafts: &[CodeDraft]) -> Result<(), String> {
        let roots = self.get(project)?.roots;
        if drafts.len() > 100 {
            return Err("Recovery is limited to 100 files".into());
        }
        for draft in drafts {
            let path = Path::new(&draft.path);
            if !roots.iter().any(|root| path.starts_with(root))
                || path
                    .components()
                    .any(|part| matches!(part, std::path::Component::ParentDir))
            {
                return Err("A recovery file is outside this project".into());
            }
            if draft.text.len() > 5 * 1024 * 1024 || draft.saved.len() > 5 * 1024 * 1024 {
                return Err("Recovery file exceeds 5 MB".into());
            }
        }
        let raw = serde_json::to_string(drafts).map_err(|e| e.to_string())?;
        if raw.len() > 20 * 1024 * 1024 {
            return Err(
                "Recovery drafts exceed the 20 MB project limit; save or close some files".into(),
            );
        }
        self.0.lock().map_err(|e|e.to_string())?.execute("INSERT INTO code_drafts(project_id,document) VALUES (?1,?2) ON CONFLICT(project_id) DO UPDATE SET document=excluded.document",params![project,raw]).map_err(|e|e.to_string())?;
        Ok(())
    }
    pub fn load_tool(
        &self,
        project: &str,
        tool: &str,
    ) -> Result<Option<serde_json::Value>, String> {
        self.get(project)?;
        validate_tool(tool)?;
        let raw: Option<String> = self
            .0
            .lock()
            .map_err(|e| e.to_string())?
            .query_row(
                "SELECT document FROM tool_documents WHERE project_id=?1 AND tool=?2",
                params![project, tool],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        raw.map(|value| serde_json::from_str(&value).map_err(|e| e.to_string()))
            .transpose()
    }
    pub fn save_tool(
        &self,
        project: &str,
        tool: &str,
        document: &serde_json::Value,
    ) -> Result<(), String> {
        self.get(project)?;
        validate_tool(tool)?;
        if document.get("version").and_then(serde_json::Value::as_u64) != Some(1) {
            return Err("Unsupported tool document version".into());
        }
        let raw = serde_json::to_string(document).map_err(|e| e.to_string())?;
        if raw.len() > 4 * 1024 * 1024 {
            return Err("Saved tool data exceeds the 4 MB limit".into());
        }
        self.0.lock().map_err(|e|e.to_string())?.execute("INSERT INTO tool_documents(project_id,tool,document) VALUES (?1,?2,?3) ON CONFLICT(project_id,tool) DO UPDATE SET document=excluded.document",params![project,tool,raw]).map_err(|e|e.to_string())?;
        Ok(())
    }
}
fn self_drafts_in_roots(
    db: &rusqlite::Transaction<'_>,
    id: &str,
    roots: &[String],
) -> Result<Vec<CodeDraft>, String> {
    let raw: Option<String> = db
        .query_row(
            "SELECT document FROM code_drafts WHERE project_id=?1",
            [id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let drafts = raw
        .map(|raw| serde_json::from_str::<Vec<CodeDraft>>(&raw).map_err(|e| e.to_string()))
        .transpose()?
        .unwrap_or_default();
    if drafts.iter().any(|draft| {
        !roots
            .iter()
            .any(|root| Path::new(&draft.path).starts_with(root))
    }) {
        return Err("Recover or discard Code drafts in the folders being removed before editing this project".into());
    }
    Ok(drafts)
}
fn validate_tool(tool: &str) -> Result<(), String> {
    if ["api", "servers", "database", "code-settings"].contains(&tool) {
        Ok(())
    } else {
        Err("Unknown project tool".into())
    }
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_colors_persist_and_validate_without_changing_sources() {
        let store = Store::open(Path::new(":memory:")).unwrap();
        let folder = std::env::temp_dir();
        let project = store
            .create(
                "Color test".into(),
                vec![folder.to_string_lossy().into_owned()],
            )
            .unwrap();
        assert_eq!(project.color, "#80cbc4");
        store.set_color(&project.id, "#68caff".into()).unwrap();
        assert_eq!(store.get(&project.id).unwrap().color, "#68caff");
        assert!(store.set_color(&project.id, "red;bad".into()).is_err());
        let updated = store
            .update(&project.id, "Renamed".into(), project.roots)
            .unwrap();
        assert_eq!(updated.color, "#68caff");
    }
    #[test]
    fn tool_documents_are_scoped_by_project_and_tool() {
        let store = Store::open(Path::new(":memory:")).unwrap();
        let roots = vec![std::env::temp_dir().to_string_lossy().into_owned()];
        let one = store.create("One".into(), roots.clone()).unwrap();
        let two = store.create("Two".into(), roots).unwrap();
        let document = serde_json::json!({"version":1,"requests":[{"name":"one"}]});
        store.save_tool(&one.id, "api", &document).unwrap();
        assert_eq!(store.load_tool(&one.id, "api").unwrap(), Some(document));
        assert!(store.load_tool(&two.id, "api").unwrap().is_none());
        assert!(store.load_tool(&one.id, "servers").unwrap().is_none());
        assert!(store
            .save_tool(&one.id, "unknown", &serde_json::json!({"version":1}))
            .is_err());
        assert!(store
            .save_tool(&one.id, "api", &serde_json::json!({"version":2}))
            .is_err());
        assert!(store
            .save_tool("missing", "api", &serde_json::json!({"version":1}))
            .is_err());
    }
    #[test]
    fn roundtrips_workspace_state_and_rejects_unknown_roots() {
        let store = Store::open(Path::new(":memory:")).unwrap();
        let project = store
            .create(
                "Test".into(),
                vec![std::env::temp_dir().to_string_lossy().into_owned()],
            )
            .unwrap();
        assert!(store.load_session(&project.id).unwrap().is_none());
        let mut session = WorkspaceSession {
            version: 1,
            tool: "code".into(),
            open_files: vec![],
            active_file: String::new(),
            active_root: project.roots[0].clone(),
            terminal_visible: false,
        };
        store.save_session(&project.id, &session).unwrap();
        assert_eq!(
            store.load_session(&project.id).unwrap().unwrap().tool,
            "code"
        );
        session.active_root = "/outside-project".into();
        assert!(store.save_session(&project.id, &session).is_err());
        assert_eq!(
            store
                .load_session(&project.id)
                .unwrap()
                .unwrap()
                .active_root,
            project.roots[0]
        );
    }

    #[test]
    fn backs_up_v1_metadata_before_migrating() {
        let directory = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("octode.sqlite");
        {
            let db = Connection::open(&path).unwrap();
            db.execute_batch("CREATE TABLE projects (id TEXT PRIMARY KEY,name TEXT NOT NULL,roots TEXT NOT NULL,updated_at INTEGER NOT NULL); INSERT INTO projects VALUES ('preserved','Existing','[]',1); PRAGMA user_version=1;").unwrap();
        }
        let store = Store::open(&path).unwrap();
        assert_eq!(store.get("preserved").unwrap().name, "Existing");
        assert_eq!(
            store
                .0
                .lock()
                .unwrap()
                .query_row("PRAGMA user_version", [], |row| row.get::<_, u32>(0))
                .unwrap(),
            5
        );
        assert!(std::fs::read_dir(&directory).unwrap().any(|entry| entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with("octode-before-v5-")));
        drop(store);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn rejects_paths_outside_project_even_with_parent_segments() {
        let directory = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir_all(directory.join("root")).unwrap();
        std::fs::write(directory.join("private.txt"), "outside").unwrap();
        let store = Store::open(Path::new(":memory:")).unwrap();
        let project = store
            .create(
                "Test".into(),
                vec![directory.join("root").to_string_lossy().into_owned()],
            )
            .unwrap();
        assert!(store
            .authorize_path(
                &project.id,
                &directory.join("root/../private.txt").to_string_lossy()
            )
            .is_err());
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn rejects_empty_projects_and_persists_valid_projects() {
        let store = Store::open(Path::new(":memory:")).unwrap();
        assert!(store.create("Test".into(), vec![]).is_err());
        assert!(store
            .create(
                " ".into(),
                vec![std::env::temp_dir().to_string_lossy().into_owned()]
            )
            .is_err());
        let project = store
            .create(
                " Test ".into(),
                vec![std::env::temp_dir().to_string_lossy().into_owned()],
            )
            .unwrap();
        assert_eq!(store.get(&project.id).unwrap().name, "Test");
    }
    #[test]
    fn recovery_is_project_scoped_and_preserves_unsaved_text() {
        let store = Store::open(Path::new(":memory:")).unwrap();
        let root = std::env::temp_dir()
            .canonicalize()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let one = store.create("One".into(), vec![root.clone()]).unwrap();
        let two = store.create("Two".into(), vec![root.clone()]).unwrap();
        let draft = CodeDraft {
            path: format!("{root}/file.php"),
            text: "local unsaved".into(),
            saved: "disk baseline".into(),
        };
        store.save_drafts(&one.id, &[draft]).unwrap();
        assert_eq!(store.load_drafts(&one.id).unwrap()[0].text, "local unsaved");
        assert!(store.load_drafts(&two.id).unwrap().is_empty());
        assert!(store
            .save_drafts(
                &one.id,
                &[CodeDraft {
                    path: "/outside/file".into(),
                    text: String::new(),
                    saved: String::new()
                }]
            )
            .is_err());
        store.save_drafts(&one.id, &[]).unwrap();
        assert!(store.load_drafts(&one.id).unwrap().is_empty());
    }
    #[test]
    fn project_metadata_edit_and_remove_never_delete_source_files() {
        let folder = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir(&folder).unwrap();
        let file = folder.join("source.php");
        std::fs::write(&file, "source").unwrap();
        let store = Store::open(Path::new(":memory:")).unwrap();
        let project = store
            .create("Original".into(), vec![folder.to_string_lossy().into()])
            .unwrap();
        let updated = store
            .update(&project.id, "Renamed".into(), project.roots.clone())
            .unwrap();
        assert_eq!(updated.id, project.id);
        assert_eq!(store.get(&project.id).unwrap().name, "Renamed");
        store
            .save_tool(&project.id, "api", &serde_json::json!({"version":1}))
            .unwrap();
        store.remove(&project.id).unwrap();
        assert!(store.get(&project.id).is_err());
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "source");
        assert_eq!(
            store
                .0
                .lock()
                .unwrap()
                .query_row("SELECT COUNT(*) FROM tool_documents", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
        std::fs::remove_dir_all(folder).unwrap();
    }
}
