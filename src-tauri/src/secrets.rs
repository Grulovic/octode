use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretValue {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub value: String,
    #[serde(default)]
    pub secret: bool,
    #[serde(default)]
    pub has_secret: bool,
}

pub trait Secrets: Send + Sync {
    fn set(&self, project: &str, id: &str, value: &str) -> Result<(), String>;
    fn get(&self, project: &str, id: &str) -> Result<String, String>;
}
pub struct Vault;
impl Vault {
    fn entry(project: &str, id: &str) -> Result<keyring::Entry, String> {
        uuid::Uuid::parse_str(project).map_err(|_| "Invalid secret project")?;
        uuid::Uuid::parse_str(id).map_err(|_| "Invalid secret identifier")?;
        keyring::Entry::new("dev.octode.desktop", &format!("{project}:{id}"))
            .map_err(|_| "The system credential store is unavailable".into())
    }
}
impl Secrets for Vault {
    fn set(&self, project: &str, id: &str, value: &str) -> Result<(), String> {
        Self::entry(project, id)?
            .set_password(value)
            .map_err(|_| "Could not save this secret to the system credential store".into())
    }
    fn get(&self, project: &str, id: &str) -> Result<String, String> {
        Self::entry(project, id)?
            .get_password()
            .map_err(|_| "Stored credential is unavailable; enter it again and Save".into())
    }
}
pub fn resolve(value: &SecretValue, project: &str, vault: &impl Secrets) -> Result<String, String> {
    if !value.value.is_empty() {
        Ok(value.value.clone())
    } else if value.has_secret {
        vault.get(project, &value.id)
    } else {
        Ok(String::new())
    }
}

pub fn seal(value: &mut Value, project: &str, vault: &impl Secrets) -> Result<(), String> {
    match value {
        Value::Array(items) => {
            for item in items {
                seal(item, project, vault)?;
            }
        }
        Value::Object(object) => {
            let sensitive = object
                .get("name")
                .and_then(Value::as_str)
                .is_some_and(|name| {
                    [
                        "authorization",
                        "proxy-authorization",
                        "cookie",
                        "x-api-key",
                        "api-key",
                    ]
                    .contains(&name.to_ascii_lowercase().as_str())
                });
            if sensitive {
                object.insert("secret".into(), Value::Bool(true));
            }
            if object.get("secret").and_then(Value::as_bool) == Some(true) {
                let content = object
                    .get("value")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned();
                if !content.is_empty() {
                    let id = uuid::Uuid::new_v4().to_string();
                    vault.set(project, &id, &content)?;
                    object.insert("id".into(), Value::String(id));
                    object.insert("value".into(), Value::String(String::new()));
                    object.insert("hasSecret".into(), Value::Bool(true));
                }
            }
            for (name, child) in object.iter_mut() {
                if ["password", "passphrase", "credential"].contains(&name.as_str()) {
                    if let Value::Object(field) = child {
                        field.insert("secret".into(), Value::Bool(true));
                    }
                }
                seal(child, project, vault)?;
            }
        }
        _ => {}
    }
    Ok(())
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use std::{collections::HashMap, sync::Mutex};
    #[derive(Default)]
    pub struct Memory(pub Mutex<HashMap<String, String>>);
    impl Secrets for Memory {
        fn set(&self, p: &str, id: &str, v: &str) -> Result<(), String> {
            self.0.lock().unwrap().insert(format!("{p}:{id}"), v.into());
            Ok(())
        }
        fn get(&self, p: &str, id: &str) -> Result<String, String> {
            self.0
                .lock()
                .unwrap()
                .get(&format!("{p}:{id}"))
                .cloned()
                .ok_or("missing".into())
        }
    }
    #[test]
    fn database_password_survives_save_reload_and_saving_other_settings() {
        let vault = Memory::default();
        let mut document = serde_json::json!({"connections": [{"password": {"id": "draft", "value": "test-password", "secret": true, "hasSecret": false}}]});
        seal(&mut document, "project", &vault).unwrap();
        assert_eq!(document["connections"][0]["password"]["value"], "");
        let persisted = document.to_string();
        assert!(!persisted.contains("test-password"));
        let mut reloaded: Value = serde_json::from_str(&persisted).unwrap();
        reloaded["connections"][0]["database"] = Value::String("another_database".into());
        seal(&mut reloaded, "project", &vault).unwrap();
        let saved: SecretValue =
            serde_json::from_value(reloaded["connections"][0]["password"].clone()).unwrap();
        assert!(saved.has_secret);
        assert_eq!(resolve(&saved, "project", &vault).unwrap(), "test-password");
    }
    #[test]
    fn secrets_leave_metadata_and_remain_project_scoped() {
        let vault = Memory::default();
        let mut value = serde_json::json!({"headers":[{"id":"field","name":"Authorization","value":"Bearer private"}]});
        seal(&mut value, "one", &vault).unwrap();
        assert!(!value.to_string().contains("private"));
        assert_eq!(
            vault
                .get("one", value["headers"][0]["id"].as_str().unwrap())
                .unwrap(),
            "Bearer private"
        );
        assert!(vault.get("other", "field").is_err());
    }
}
