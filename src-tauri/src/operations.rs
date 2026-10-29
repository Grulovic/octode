use std::{collections::HashMap, sync::Mutex};
use tokio_util::sync::CancellationToken;
#[derive(Default)]
pub struct Operations(Mutex<HashMap<String, CancellationToken>>);
impl Operations {
    pub fn begin(&self, owner: &str, id: &str) -> Result<CancellationToken, String> {
        uuid::Uuid::parse_str(id).map_err(|_| "Invalid operation identifier")?;
        let mut jobs = self.0.lock().map_err(|e| e.to_string())?;
        let key = format!("{owner}:{id}");
        if jobs.contains_key(&key) {
            return Err("This operation is already running".into());
        }
        let token = CancellationToken::new();
        jobs.insert(key, token.clone());
        Ok(token)
    }
    pub fn cancel(&self, owner: &str, id: &str) {
        if let Ok(jobs) = self.0.lock() {
            if let Some(token) = jobs.get(&format!("{owner}:{id}")) {
                token.cancel();
            }
        }
    }
    pub fn finish(&self, owner: &str, id: &str) {
        if let Ok(mut jobs) = self.0.lock() {
            jobs.remove(&format!("{owner}:{id}"));
        }
    }
    pub fn close_window(&self, owner: &str) {
        if let Ok(mut jobs) = self.0.lock() {
            jobs.retain(|key, token| {
                if key.starts_with(&format!("{owner}:")) {
                    token.cancel();
                    false
                } else {
                    true
                }
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cancellation_is_owned_and_window_close_cleans_all_jobs() {
        let operations = Operations::default();
        let id = uuid::Uuid::new_v4().to_string();
        let token = operations.begin("main", &id).unwrap();
        assert!(operations.begin("main", &id).is_err());
        operations.cancel("other", &id);
        assert!(!token.is_cancelled());
        operations.cancel("main", &id);
        assert!(token.is_cancelled());
        operations.finish("main", &id);
        let second = operations.begin("main", &id).unwrap();
        operations.close_window("main");
        assert!(second.is_cancelled());
        assert!(operations.begin("main", &id).is_ok());
    }
}
