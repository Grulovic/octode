use crate::file_core;
use serde::Serialize;
use std::path::Path;

#[derive(Serialize)]
pub struct FileEntry {
    name: String,
    path: String,
    directory: bool,
}

pub fn list(path: &Path) -> Result<Vec<FileEntry>, String> {
    file_core::list(path).map(|entries| {
        entries
            .into_iter()
            .map(|entry| FileEntry {
                name: entry.name,
                path: entry.path,
                directory: entry.directory,
            })
            .collect()
    })
}
pub use file_core::{read, save};
