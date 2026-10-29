use serde::{Deserialize, Serialize};
use std::{io::Write, path::Path};
#[derive(Deserialize, Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RestartState {
    pub project_id: Option<String>,
}
pub fn save(directory: &Path, state: &RestartState) -> Result<(), String> {
    let path = directory.join("restart-state.json");
    let temporary = directory.join("restart-state.json.tmp");
    let mut file = std::fs::File::create(&temporary).map_err(|error| error.to_string())?;
    file.write_all(&serde_json::to_vec(state).map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())?;
    std::fs::rename(temporary, path).map_err(|error| error.to_string())
}
pub fn take(directory: &Path) -> Result<Option<RestartState>, String> {
    let path = directory.join("restart-state.json");
    let bytes = match std::fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    let state = serde_json::from_slice(&bytes)
        .map_err(|error| format!("Could not read restart state: {error}"))?;
    std::fs::remove_file(path).map_err(|error| error.to_string())?;
    Ok(Some(state))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn restart_handoff_is_profile_scoped_consumed_once_and_preserves_projects_screen() {
        let directory =
            std::env::temp_dir().join(format!("octode-restart-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&directory).unwrap();
        let other = directory.join("other-profile");
        std::fs::create_dir(&other).unwrap();
        let state = RestartState {
            project_id: Some("project-id".into()),
        };
        save(&directory, &state).unwrap();
        assert_eq!(take(&other).unwrap(), None);
        assert_eq!(take(&directory).unwrap(), Some(state));
        assert_eq!(take(&directory).unwrap(), None);
        let projects = RestartState { project_id: None };
        save(&directory, &projects).unwrap();
        assert_eq!(take(&directory).unwrap(), Some(projects));
        std::fs::remove_dir_all(directory).unwrap();
    }
}
