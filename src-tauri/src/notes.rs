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
}
fn load(store: &Store) -> Result<Vec<Note>, String> {
    let db = store.0.lock().map_err(|error| error.to_string())?;
    let mut statement = db
        .prepare("SELECT id,title,text FROM global_notes ORDER BY rowid DESC")
        .map_err(|error| error.to_string())?;
    let notes = statement
        .query_map([], |row| {
            Ok(Note {
                id: row.get(0)?,
                title: row.get(1)?,
                text: row.get(2)?,
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
    tx.execute("INSERT INTO global_notes(id,title,text) VALUES (?1,?2,?3) ON CONFLICT(id) DO UPDATE SET title=excluded.title,text=excluded.text", params![note.id, note.title, note.text]).map_err(|error| error.to_string())?;
    let stored = tx
        .query_row(
            "SELECT id,title,text FROM global_notes WHERE id=?1",
            [&note.id],
            |row| {
                Ok(Note {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    text: row.get(2)?,
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
    let db = store.0.lock().map_err(|error| error.to_string())?;
    db.execute("DELETE FROM global_notes WHERE id=?1", [id])
        .map_err(|error| error.to_string())?;
    Ok(())
}
#[tauri::command]
pub fn delete_note(window: WebviewWindow, store: State<'_, Store>, id: String) -> Result<(), String> {
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
        };
        let two = Note {
            id: uuid::Uuid::new_v4().to_string(),
            title: String::new(),
            text: "other".into(),
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
