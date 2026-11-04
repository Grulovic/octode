use crate::projects::Store;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::{State, WebviewWindow};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub title: String,
    pub text: String,
    #[serde(default)]
    pub folder_id: String,
}
pub(crate) fn load(store: &Store) -> Result<Vec<Note>, String> {
    let db = store.0.lock().map_err(|error| error.to_string())?;
    let mut statement = db
        .prepare("SELECT n.id,n.title,n.text,COALESCE(l.folder_id,'') FROM global_notes n LEFT JOIN global_note_locations l ON l.note_id=n.id ORDER BY n.rowid DESC")
        .map_err(|error| error.to_string())?;
    let notes = statement
        .query_map([], |row| {
            Ok(Note {
                id: row.get(0)?,
                title: row.get(1)?,
                text: row.get(2)?,
                folder_id: row.get(3)?,
            })
        })
        .map_err(|error| error.to_string())?;
    notes
        .map(|note| note.map_err(|error| error.to_string()))
        .collect()
}
fn save(store: &Store, note: Note) -> Result<Note, String> {
    if uuid::Uuid::parse_str(&note.id).is_err()
        || note.title.chars().count() > 200
        || note.text.len() > 2 * 1024 * 1024
    {
        return Err(
            "Notes require a valid ID, a title up to 200 characters and text up to 2 MB".into(),
        );
    }
    let mut db = store.0.lock().map_err(|error| error.to_string())?;
    let tx = db.transaction().map_err(|error| error.to_string())?;
    if !note.folder_id.is_empty()
        && !tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM global_note_folders WHERE id=?1)",
                [&note.folder_id],
                |row| row.get::<_, bool>(0),
            )
            .map_err(|e| e.to_string())?
    {
        return Err("Missing note folder".into());
    }
    tx.execute("INSERT INTO global_notes(id,title,text) VALUES (?1,?2,?3) ON CONFLICT(id) DO UPDATE SET title=excluded.title,text=excluded.text", params![note.id, note.title, note.text]).map_err(|error| error.to_string())?;
    tx.execute("INSERT INTO global_note_locations(note_id,folder_id) VALUES (?1,?2) ON CONFLICT(note_id) DO UPDATE SET folder_id=excluded.folder_id", params![note.id,note.folder_id]).map_err(|e| e.to_string())?;
    let stored = tx
        .query_row(
            "SELECT n.id,n.title,n.text,COALESCE(l.folder_id,'') FROM global_notes n LEFT JOIN global_note_locations l ON l.note_id=n.id WHERE n.id=?1",
            [&note.id],
            |row| {
                Ok(Note {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    text: row.get(2)?,
                    folder_id: row.get(3)?,
                })
            },
        )
        .map_err(|error| error.to_string())?;
    if stored != note {
        return Err("Could not verify the saved note".into());
    }
    tx.commit().map_err(|error| error.to_string())?;
    Ok(stored)
}
#[tauri::command]
pub fn load_notes(window: WebviewWindow, store: State<'_, Store>) -> Result<Vec<Note>, String> {
    if window.label() != "main" {
        return Err("Open notes from the main window".into());
    }
    load(&store)
}
fn delete(store: &Store, id: &str) -> Result<(), String> {
    let mut db = store.0.lock().map_err(|error| error.to_string())?;
    let tx = db.transaction().map_err(|error| error.to_string())?;
    tx.execute("DELETE FROM global_notes WHERE id=?1", [id])
        .map_err(|error| error.to_string())?;
    tx.commit().map_err(|error| error.to_string())
}
#[tauri::command]
pub fn delete_note(
    window: WebviewWindow,
    store: State<'_, Store>,
    id: String,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Delete notes from the main window".into());
    }
    delete(&store, &id)
}
#[tauri::command]
pub fn save_note(
    window: WebviewWindow,
    store: State<'_, Store>,
    note: Note,
) -> Result<Note, String> {
    if window.label() != "main" {
        return Err("Save notes from the main window".into());
    }
    save(&store, note)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn notes_persist_independently_of_projects_and_updating_preserves_other_notes() {
        let path =
            std::env::temp_dir().join(format!("octode-notes-{}.sqlite", uuid::Uuid::new_v4()));
        let one = Note {
            id: uuid::Uuid::new_v4().to_string(),
            title: "Scratch".into(),
            text: "one\n二\n".into(),
            folder_id: String::new(),
        };
        let two = Note {
            id: uuid::Uuid::new_v4().to_string(),
            title: String::new(),
            text: "other".into(),
            folder_id: String::new(),
        };
        {
            let store = Store::open(&path).unwrap();
            assert!(load(&store).unwrap().is_empty());
            save(&store, one.clone()).unwrap();
            save(&store, two.clone()).unwrap();
            let mut edited = one.clone();
            edited.text = "updated".into();
            save(&store, edited.clone()).unwrap();
            assert_eq!(load(&store).unwrap(), vec![two.clone(), edited]);
            let invalid = Note {
                id: "bad".into(),
                ..one.clone()
            };
            assert!(save(&store, invalid).is_err());
            assert_eq!(load(&store).unwrap().len(), 2);
        }
        let store = Store::open(&path).unwrap();
        assert_eq!(load(&store).unwrap().len(), 2);
        delete(&store, &one.id).unwrap();
        assert_eq!(load(&store).unwrap(), vec![two.clone()]);
        drop(store);
        let store = Store::open(&path).unwrap();
        assert_eq!(load(&store).unwrap(), vec![two]);
        drop(store);
        std::fs::remove_file(path).unwrap();
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteFolder {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub parent_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteLocation {
    pub id: String,
    pub folder_id: String,
}

pub(crate) fn read_folders(db: &rusqlite::Connection) -> Result<Vec<NoteFolder>, String> {
    let mut stmt = db
        .prepare("SELECT id,name,parent_id FROM global_note_folders ORDER BY rowid")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(NoteFolder {
                id: row.get(0)?,
                name: row.get(1)?,
                parent_id: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.map(|row| row.map_err(|e| e.to_string())).collect()
}
pub(crate) fn validate_folders(folders: &[NoteFolder]) -> Result<(), String> {
    use std::collections::{HashMap, HashSet};
    if folders.len() > 10000 {
        return Err("Too many note folders".into());
    }
    let by_id: HashMap<_, _> = folders.iter().map(|f| (f.id.as_str(), f)).collect();
    if by_id.len() != folders.len() {
        return Err("Duplicate note folder IDs".into());
    }
    for folder in folders {
        if folder.id.is_empty()
            || folder.id.len() > 200
            || folder.name.trim().is_empty()
            || folder.name.chars().count() > 200
        {
            return Err("Invalid note folder".into());
        }
        let mut seen = HashSet::from([folder.id.as_str()]);
        let mut parent = folder.parent_id.as_str();
        while !parent.is_empty() {
            if !seen.insert(parent) {
                return Err("Note folders cannot contain a cycle".into());
            }
            parent = by_id
                .get(parent)
                .ok_or("Missing parent note folder")?
                .parent_id
                .as_str();
        }
    }
    Ok(())
}
#[tauri::command]
pub fn load_note_folders(
    window: WebviewWindow,
    store: State<'_, Store>,
) -> Result<Vec<NoteFolder>, String> {
    if window.label() != "main" {
        return Err("Open notes from the main window".into());
    }
    let db = store.0.lock().map_err(|e| e.to_string())?;
    read_folders(&db)
}
fn save_workspace(
    store: &Store,
    folders: Vec<NoteFolder>,
    locations: Vec<NoteLocation>,
    note: Option<Note>,
) -> Result<Option<Note>, String> {
    validate_folders(&folders)?;
    let valid_location = |id: &str| id.is_empty() || folders.iter().any(|f| f.id == id);
    if locations.len() > 10000 || locations.iter().any(|l| !valid_location(&l.folder_id)) {
        return Err("Invalid note folder location".into());
    }
    if let Some(ref note) = note {
        if uuid::Uuid::parse_str(&note.id).is_err()
            || note.title.chars().count() > 200
            || note.text.len() > 2 * 1024 * 1024
            || !valid_location(&note.folder_id)
        {
            return Err("Invalid note".into());
        }
    }
    let mut db = store.0.lock().map_err(|e| e.to_string())?;
    let tx = db.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM global_note_folders", [])
        .map_err(|e| e.to_string())?;
    for folder in folders {
        tx.execute(
            "INSERT INTO global_note_folders(id,name,parent_id) VALUES (?1,?2,?3)",
            params![folder.id, folder.name, folder.parent_id],
        )
        .map_err(|e| e.to_string())?;
    }
    for location in locations {
        tx.execute("INSERT INTO global_note_locations(note_id,folder_id) SELECT id,?2 FROM global_notes WHERE id=?1 ON CONFLICT(note_id) DO UPDATE SET folder_id=excluded.folder_id", params![location.id,location.folder_id]).map_err(|e| e.to_string())?;
    }
    if let Some(ref note) = note {
        tx.execute("INSERT INTO global_notes(id,title,text) VALUES (?1,?2,?3) ON CONFLICT(id) DO UPDATE SET title=excluded.title,text=excluded.text", params![note.id,note.title,note.text]).map_err(|e| e.to_string())?;
        tx.execute("INSERT INTO global_note_locations(note_id,folder_id) VALUES (?1,?2) ON CONFLICT(note_id) DO UPDATE SET folder_id=excluded.folder_id", params![note.id,note.folder_id]).map_err(|e| e.to_string())?;
    }
    if tx.query_row("SELECT COUNT(*) FROM global_note_locations WHERE folder_id != '' AND folder_id NOT IN (SELECT id FROM global_note_folders)", [], |row| row.get::<_, i64>(0)).map_err(|e| e.to_string())? != 0 { return Err("A note still references a removed folder".into()); }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(note)
}
#[tauri::command]
pub fn save_notes_workspace(
    window: WebviewWindow,
    store: State<'_, Store>,
    folders: Vec<NoteFolder>,
    locations: Vec<NoteLocation>,
    note: Option<Note>,
) -> Result<Option<Note>, String> {
    if window.label() != "main" {
        return Err("Save notes from the main window".into());
    }
    save_workspace(&store, folders, locations, note)
}

#[cfg(test)]
mod folder_tests {
    use super::*;
    #[test]
    fn saves_layout_without_saving_other_note_text_and_rejects_cycles_atomically() {
        let store = Store::open(std::path::Path::new(":memory:")).unwrap();
        let note = Note {
            id: uuid::Uuid::new_v4().to_string(),
            title: "Scratch".into(),
            text: "saved".into(),
            folder_id: String::new(),
        };
        save(&store, note.clone()).unwrap();
        let folders = vec![
            NoteFolder {
                id: "parent".into(),
                name: "Work".into(),
                parent_id: String::new(),
            },
            NoteFolder {
                id: "child".into(),
                name: "SQL".into(),
                parent_id: "parent".into(),
            },
        ];
        save_workspace(
            &store,
            folders.clone(),
            vec![NoteLocation {
                id: note.id.clone(),
                folder_id: "child".into(),
            }],
            None,
        )
        .unwrap();
        assert_eq!(load(&store).unwrap()[0].folder_id, "child");
        assert_eq!(load(&store).unwrap()[0].text, "saved");
        let mut cycle = folders.clone();
        cycle[0].parent_id = "child".into();
        assert!(save_workspace(&store, cycle, vec![], None).is_err());
        assert_eq!(read_folders(&store.0.lock().unwrap()).unwrap(), folders);
        // Removing a folder without moving its saved notes must roll back.
        assert!(save_workspace(&store, vec![], vec![], None).is_err());
        assert_eq!(read_folders(&store.0.lock().unwrap()).unwrap(), folders);
        save_workspace(
            &store,
            vec![],
            vec![NoteLocation {
                id: note.id.clone(),
                folder_id: String::new(),
            }],
            None,
        )
        .unwrap();
        assert_eq!(load(&store).unwrap(), vec![note]);
    }
}
