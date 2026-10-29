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
            .map_err(|error| storage_error("save", error))
    }
    fn get(&self, project: &str, id: &str) -> Result<String, String> {
        Self::entry(project, id)?
            .get_password()
            .map_err(|error| storage_error("read", error))
    }
}
fn storage_error(action: &str, error: keyring::Error) -> String {
    let detail = match error {
        keyring::Error::NoEntry => "Stored credential is missing. Enter it again and Save.".into(),
        keyring::Error::NoStorageAccess(source) | keyring::Error::PlatformFailure(source) => {
            format!("System credential store: {source}. Unlock or allow access to the system credential store and retry Save.")
        }
        // Never format arbitrary credential objects or invalid secret bytes.
        keyring::Error::BadEncoding(_) => "The stored credential has an invalid encoding. Enter it again and Save.".into(),
        _ => "The system credential store rejected this operation. Your unsaved value is kept; retry Save.".into(),
    };
    format!("Could not {action} credential. {detail}")
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
                    // Read through a fresh vault lookup before replacing the draft with
                    // a stored reference. A successful write alone is not persistence.
                    let verified = vault.get(project, &id).map_err(|reason| {
                        format!("The saved credential could not be verified. {reason} Your value is still unsaved; retry Save.")
                    })?;
                    if verified != content {
                        return Err("The credential store did not preserve the saved value. Your value is still unsaved; retry Save.".into());
                    }
                    object.insert("id".into(), Value::String(id));
                    object.insert("value".into(), Value::String(String::new()));
                    object.insert("hasSecret".into(), Value::Bool(true));
                } else if object.get("hasSecret").and_then(Value::as_bool) == Some(true) {
                    let id = object.get("id").and_then(Value::as_str).unwrap_or_default();
                    vault.get(project, id).map_err(|reason| {
                        format!("A saved credential could not be verified. {reason} Re-enter the affected password or secret and Save again; other changes are still unsaved.")
                    })?;
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
    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "Uses a disposable entry in the local macOS Keychain"]
    fn native_vault_round_trip() {
        let project = uuid::Uuid::new_v4().to_string();
        let id = uuid::Uuid::new_v4().to_string();
        let result = (|| {
            Vault.set(&project, &id, "octode-disposable-test")?;
            if Vault.get(&project, &id)? != "octode-disposable-test" {
                return Err("Native credential did not round trip".to_string());
            }
            Ok::<_, String>(())
        })();
        // Delete only the random test entry created by this invocation.
        if let Ok(entry) = Vault::entry(&project, &id) {
            let _ = entry.delete_credential();
        }
        result.expect("Native credential store round trip failed");
    }
    #[test]
    fn missing_saved_credentials_are_not_silently_resaved() {
        let mut field =
            serde_json::json!({"id":"missing", "value":"", "secret":true, "hasSecret":true});
        let error = seal(&mut field, "project", &Memory::default()).unwrap_err();
        assert!(error.contains("Re-enter"));
    }
    #[test]
    fn failed_readback_does_not_clear_the_secret_draft() {
        struct Broken;
        impl Secrets for Broken {
            fn set(&self, _: &str, _: &str, _: &str) -> Result<(), String> {
                Ok(())
            }
            fn get(&self, _: &str, _: &str) -> Result<String, String> {
                Err("unavailable".into())
            }
        }
        let mut field = serde_json::json!({"id":"draft", "value":"test-only", "secret":true});
        assert!(seal(&mut field, "project", &Broken).is_err());
        assert_eq!(field["value"], "test-only");
        assert_eq!(field["id"], "draft");
        assert_ne!(field["hasSecret"], true);
    }
    #[test]
    fn incorrect_readback_does_not_report_a_saved_secret() {
        struct Wrong;
        impl Secrets for Wrong {
            fn set(&self, _: &str, _: &str, _: &str) -> Result<(), String> {
                Ok(())
            }
            fn get(&self, _: &str, _: &str) -> Result<String, String> {
                Ok("wrong".into())
            }
        }
        let mut field = serde_json::json!({"id":"draft", "value":"test-only", "secret":true});
        assert!(seal(&mut field, "project", &Wrong).is_err());
        assert_eq!(field["value"], "test-only");
        assert_ne!(field["hasSecret"], true);
    }
    #[test]
    fn credential_errors_do_not_expose_invalid_secret_bytes() {
        let message = storage_error(
            "read",
            keyring::Error::BadEncoding(b"private-secret".to_vec()),
        );
        assert!(!message.contains("private-secret"));
        assert!(message.contains("encoding"));
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
