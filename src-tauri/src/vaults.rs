use crate::{
    projects::Store,
    secrets::{Secrets, Vault},
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::{State, WebviewWindow};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultDocument {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub project_id: String,
    #[serde(default)]
    pub items: Vec<VaultItem>,
    #[serde(default)]
    pub revision: String,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct VaultItem {
    pub id: String,
    pub kind: String,
    pub label: String,
    pub value: String,
}
pub fn validate(doc: &VaultDocument) -> Result<(), String> {
    let mut ids = std::collections::HashSet::new();
    if uuid::Uuid::parse_str(&doc.id).is_err()
        || doc.name.trim().is_empty()
        || doc.name.chars().count() > 100
        || (!doc.project_id.is_empty() && doc.project_id != doc.id)
        || doc.items.len() > 1000
        || serde_json::to_vec(&doc.items)
            .map_err(|_| "Invalid vault")?
            .len()
            > 4 * 1024 * 1024
        || doc.items.iter().any(|item| {
            uuid::Uuid::parse_str(&item.id).is_err()
                || !ids.insert(&item.id)
                || !["section", "url", "value", "password", "note"].contains(&item.kind.as_str())
                || item.label.chars().count() > 200
        })
    {
        return Err("Invalid vault: use a name up to 100 characters, labels up to 200 characters, and at most 1,000 items / 4 MB".into());
    }
    Ok(())
}
pub fn read_all(
    db: &Connection,
    secrets: &impl Secrets,
    contents: bool,
) -> Result<Vec<VaultDocument>, String> {
    let mut stmt = db
        .prepare("SELECT id,name,project_id,revision FROM global_vaults ORDER BY rowid")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(VaultDocument {
                id: row.get(0)?,
                name: row.get(1)?,
                project_id: row.get(2)?,
                revision: row.get(3)?,
                items: vec![],
            })
        })
        .map_err(|e| e.to_string())?;
    rows.map(|row| {
        let mut doc = row.map_err(|e| e.to_string())?;
        if contents {
            doc.items = serde_json::from_str(&secrets.get(&doc.id, &doc.revision)?)
                .map_err(|_| "Invalid encrypted vault contents")?;
        }
        Ok(doc)
    })
    .collect()
}
pub fn write(db: &Connection, doc: &VaultDocument) -> Result<(), String> {
    db.execute("INSERT INTO global_vaults(id,name,project_id,revision) VALUES (?1,?2,?3,?4) ON CONFLICT(id) DO UPDATE SET name=excluded.name,project_id=excluded.project_id,revision=excluded.revision", params![doc.id,doc.name,doc.project_id,doc.revision]).map_err(|e| e.to_string())?;
    Ok(())
}
pub fn encrypt(doc: &mut VaultDocument, secrets: &impl Secrets) -> Result<(), String> {
    validate(doc)?;
    // New immutable ciphertext per save keeps a failed metadata commit from changing saved contents.
    doc.revision = uuid::Uuid::new_v4().to_string();
    let value = serde_json::to_string(&doc.items).map_err(|_| "Invalid vault contents")?;
    secrets.set(&doc.id, &doc.revision, &value)?;
    if secrets.get(&doc.id, &doc.revision)? != value {
        return Err("Could not verify saved vault".into());
    }
    Ok(())
}
fn main_window(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Use Vault from the main window".into());
    }
    Ok(())
}
#[tauri::command]
pub fn list_vaults(
    window: WebviewWindow,
    store: State<'_, Store>,
) -> Result<Vec<VaultDocument>, String> {
    main_window(&window)?;
    let db = store.0.lock().map_err(|e| e.to_string())?;
    read_all(&db, &Vault, false)
}
#[tauri::command]
pub fn load_vault(
    window: WebviewWindow,
    store: State<'_, Store>,
    id: String,
) -> Result<VaultDocument, String> {
    main_window(&window)?;
    let db = store.0.lock().map_err(|e| e.to_string())?;
    let mut doc = read_all(&db, &Vault, false)?
        .into_iter()
        .find(|doc| doc.id == id)
        .ok_or("Vault no longer exists")?;
    doc.items = serde_json::from_str(&Vault.get(&doc.id, &doc.revision)?)
        .map_err(|_| "Invalid encrypted vault contents")?;
    Ok(doc)
}
fn save(
    store: &Store,
    mut doc: VaultDocument,
    expected: &str,
    secrets: &impl Secrets,
) -> Result<VaultDocument, String> {
    validate(&doc)?;
    let mut db = store.0.lock().map_err(|e| e.to_string())?;
    let tx = db.transaction().map_err(|e| e.to_string())?;
    let previous: Option<String> = tx
        .query_row(
            "SELECT revision FROM global_vaults WHERE id=?1",
            [&doc.id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if previous.as_deref().unwrap_or("") != expected {
        return Err("Vault changed elsewhere. Your draft is kept; discard and reopen to load the saved version.".into());
    }
    encrypt(&mut doc, secrets)?;
    write(&tx, &doc)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(doc)
}
#[tauri::command]
pub fn save_vault(
    window: WebviewWindow,
    store: State<'_, Store>,
    document: VaultDocument,
    expected: String,
) -> Result<VaultDocument, String> {
    main_window(&window)?;
    save(&store, document, &expected, &Vault)
}
#[tauri::command]
pub fn delete_vault(
    window: WebviewWindow,
    store: State<'_, Store>,
    id: String,
    expected: String,
) -> Result<(), String> {
    main_window(&window)?;
    let db = store.0.lock().map_err(|e| e.to_string())?;
    if db
        .execute(
            "DELETE FROM global_vaults WHERE id=?1 AND revision=?2 AND (project_id='' OR NOT EXISTS(SELECT 1 FROM projects WHERE projects.id=global_vaults.project_id))",
            params![id, expected],
        )
        .map_err(|e| e.to_string())?
        != 1
    {
        return Err("Vault changed or belongs to a project".into());
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn encrypted_roundtrip_conflict_and_failed_save_keep_saved_contents() {
        let store = Store::open(std::path::Path::new(":memory:")).unwrap();
        let secrets = crate::secrets::tests::Memory::default();
        let doc = VaultDocument {
            id: uuid::Uuid::new_v4().to_string(),
            name: "Production".into(),
            project_id: String::new(),
            revision: String::new(),
            items: vec![VaultItem {
                id: uuid::Uuid::new_v4().to_string(),
                kind: "password".into(),
                label: "Login".into(),
                value: "test-secret".into(),
            }],
        };
        let saved = save(&store, doc.clone(), "", &secrets).unwrap();
        assert!(save(&store, doc, "", &secrets).is_err());
        let db = store.0.lock().unwrap();
        assert_eq!(read_all(&db, &secrets, true).unwrap()[0], saved);
        assert!(read_all(&db, &secrets, false).unwrap()[0].items.is_empty());
        let raw: String = db
            .query_row("SELECT name || revision FROM global_vaults", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert!(!raw.contains("test-secret"));
    }
}
