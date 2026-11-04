//! One Keychain-protected key per app profile, authenticated ciphertext per credential.
//! Legacy Keychain items migrate on first use and remain intact for older app builds.
use aes_gcm::{
    aead::{Aead, Generate, Payload},
    Aes256Gcm, Key, KeyInit, Nonce,
};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use std::{path::PathBuf, sync::Mutex};
use zeroize::Zeroizing;

pub trait KeyStore: Send + Sync {
    fn read_key(&self) -> Result<Option<Vec<u8>>, String>;
    fn write_key(&self, key: &[u8]) -> Result<(), String>;
    fn read_legacy(&self, project: &str, id: &str) -> Result<String, String>;
}
pub struct CredentialVault<B> {
    path: PathBuf,
    backend: B,
    key: Mutex<Option<Zeroizing<Vec<u8>>>>,
}
impl<B: KeyStore> CredentialVault<B> {
    pub fn new(path: PathBuf, backend: B) -> Self {
        Self {
            path,
            backend,
            key: Mutex::new(None),
        }
    }
    fn access<T>(
        &self,
        project: &str,
        id: &str,
        action: impl FnOnce(&Connection, &Aes256Gcm, &[u8]) -> Result<T, String>,
    ) -> Result<T, String> {
        uuid::Uuid::parse_str(project).map_err(|_| "Invalid secret project")?;
        uuid::Uuid::parse_str(id).map_err(|_| "Invalid secret identifier")?;
        let mut cached = self
            .key
            .lock()
            .map_err(|_| "Credential vault is unavailable")?;
        let mut db = Connection::open(&self.path).map_err(|_| "Could not open credential vault")?;
        db.busy_timeout(std::time::Duration::from_secs(30))
            .map_err(|_| "Could not configure credential vault")?;
        db.execute_batch("PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS credentials (project TEXT NOT NULL, id TEXT NOT NULL, nonce BLOB NOT NULL, ciphertext BLOB NOT NULL, PRIMARY KEY(project,id));").map_err(|_| "Could not initialize credential vault")?;
        // Serialize first-key creation and writes across app processes as well as threads.
        let tx = db
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| "Credential vault is busy; retry")?;
        if cached.is_none() {
            let key = match self.backend.read_key()? {
                Some(key) => Zeroizing::new(key),
                None => {
                    let count: i64 = tx
                        .query_row("SELECT COUNT(*) FROM credentials", [], |row| row.get(0))
                        .map_err(|_| "Could not inspect credential vault")?;
                    if count != 0 {
                        return Err("The credential vault key is missing from Keychain. Restore Keychain access before retrying; encrypted passwords have been kept.".into());
                    }
                    let key = Zeroizing::new(Key::<Aes256Gcm>::generate().to_vec());
                    self.backend.write_key(&key)?;
                    let verified = self
                        .backend
                        .read_key()?
                        .map(Zeroizing::new)
                        .ok_or("Could not verify the credential vault key")?;
                    if *verified != *key {
                        return Err(
                            "The system credential store did not preserve the vault key".into()
                        );
                    }
                    key
                }
            };
            if key.len() != 32 {
                return Err("The credential vault key has an invalid format".into());
            }
            *cached = Some(key);
        }
        let cipher = Aes256Gcm::new_from_slice(cached.as_ref().unwrap())
            .map_err(|_| "Invalid credential vault key")?;
        let aad = format!("octode-vault-v1:{project}:{id}");
        let result = action(&tx, &cipher, aad.as_bytes())?;
        tx.commit()
            .map_err(|_| "Could not commit credential vault changes")?;
        Ok(result)
    }
    fn write(
        db: &Connection,
        cipher: &Aes256Gcm,
        project: &str,
        id: &str,
        value: &str,
        aad: &[u8],
    ) -> Result<(), String> {
        let nonce = Nonce::generate();
        let encrypted = cipher
            .encrypt(
                &nonce,
                Payload {
                    msg: value.as_bytes(),
                    aad,
                },
            )
            .map_err(|_| "Could not encrypt credential")?;
        db.execute("INSERT INTO credentials(project,id,nonce,ciphertext) VALUES (?1,?2,?3,?4) ON CONFLICT(project,id) DO UPDATE SET nonce=excluded.nonce,ciphertext=excluded.ciphertext", params![project,id,nonce.as_slice(),encrypted]).map_err(|_| "Could not save encrypted credential")?;
        if Self::read(db, cipher, project, id, aad)?.as_deref() != Some(value) {
            return Err("Could not verify the saved credential".into());
        }
        Ok(())
    }
    fn read(
        db: &Connection,
        cipher: &Aes256Gcm,
        project: &str,
        id: &str,
        aad: &[u8],
    ) -> Result<Option<String>, String> {
        let row: Option<(Vec<u8>, Vec<u8>)> = db
            .query_row(
                "SELECT nonce,ciphertext FROM credentials WHERE project=?1 AND id=?2",
                params![project, id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|_| "Could not read encrypted credential")?;
        row.map(|(nonce, content)| {
            let nonce =
                Nonce::try_from(nonce.as_slice()).map_err(|_| "Invalid credential nonce")?;
            let plaintext = cipher
                .decrypt(&nonce, Payload { msg: &content, aad })
                .map_err(|_| {
                    "Could not authenticate encrypted credential; the saved data has been kept"
                })?;
            String::from_utf8(plaintext).map_err(|_| "Invalid credential encoding".into())
        })
        .transpose()
    }
    pub fn set(&self, project: &str, id: &str, value: &str) -> Result<(), String> {
        self.access(project, id, |db, cipher, aad| {
            Self::write(db, cipher, project, id, value, aad)
        })
    }
    pub fn get(&self, project: &str, id: &str) -> Result<String, String> {
        self.access(project, id, |db, cipher, aad| {
            if let Some(value) = Self::read(db, cipher, project, id, aad)? {
                return Ok(value);
            }
            let legacy = Zeroizing::new(self.backend.read_legacy(project, id)?);
            Self::write(db, cipher, project, id, &legacy, aad)?;
            Ok(legacy.to_string())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        collections::HashMap,
        sync::{
            atomic::{AtomicUsize, Ordering},
            Arc,
        },
    };
    #[derive(Clone, Default)]
    struct Backend {
        key: Arc<Mutex<Option<Vec<u8>>>>,
        keys_read: Arc<AtomicUsize>,
        legacy_read: Arc<AtomicUsize>,
        legacy: Arc<Mutex<HashMap<String, String>>>,
    }
    impl KeyStore for Backend {
        fn read_key(&self) -> Result<Option<Vec<u8>>, String> {
            self.keys_read.fetch_add(1, Ordering::SeqCst);
            Ok(self.key.lock().unwrap().clone())
        }
        fn write_key(&self, key: &[u8]) -> Result<(), String> {
            *self.key.lock().unwrap() = Some(key.to_vec());
            Ok(())
        }
        fn read_legacy(&self, project: &str, id: &str) -> Result<String, String> {
            self.legacy_read.fetch_add(1, Ordering::SeqCst);
            self.legacy
                .lock()
                .unwrap()
                .get(&format!("{project}:{id}"))
                .cloned()
                .ok_or("Legacy access denied".into())
        }
    }
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            Self(std::env::temp_dir().join(format!("octode-vault-{}.sqlite", uuid::Uuid::new_v4())))
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }
    fn id() -> String {
        uuid::Uuid::new_v4().to_string()
    }
    #[test]
    fn unlocks_once_for_many_credentials_and_once_after_restart() {
        let file = Fixture::new();
        let backend = Backend::default();
        let project = id();
        let vault = CredentialVault::new(file.0.clone(), backend.clone());
        let ids: Vec<_> = (0..20).map(|_| id()).collect();
        for id in &ids {
            vault.set(&project, id, "dummy-private-value").unwrap();
        }
        assert_eq!(backend.keys_read.load(Ordering::SeqCst), 2); // create + verify key
        for id in &ids {
            assert_eq!(vault.get(&project, id).unwrap(), "dummy-private-value");
        }
        assert_eq!(backend.keys_read.load(Ordering::SeqCst), 2);
        assert_eq!(backend.legacy_read.load(Ordering::SeqCst), 0);
        let restarted = CredentialVault::new(file.0.clone(), backend.clone());
        for id in &ids {
            assert_eq!(restarted.get(&project, id).unwrap(), "dummy-private-value");
        }
        assert_eq!(backend.keys_read.load(Ordering::SeqCst), 3);
        let bytes = std::fs::read(&file.0).unwrap();
        assert!(!bytes
            .windows(b"dummy-private-value".len())
            .any(|chunk| chunk == b"dummy-private-value"));
    }
    #[test]
    fn migrates_each_legacy_item_once_and_keeps_it_available_to_older_builds() {
        let file = Fixture::new();
        let backend = Backend::default();
        let (project, secret) = (id(), id());
        backend
            .legacy
            .lock()
            .unwrap()
            .insert(format!("{project}:{secret}"), "legacy-dummy".into());
        let vault = CredentialVault::new(file.0.clone(), backend.clone());
        for _ in 0..5 {
            assert_eq!(vault.get(&project, &secret).unwrap(), "legacy-dummy");
        }
        let restarted = CredentialVault::new(file.0.clone(), backend.clone());
        assert_eq!(restarted.get(&project, &secret).unwrap(), "legacy-dummy");
        assert_eq!(backend.legacy_read.load(Ordering::SeqCst), 1);
        assert_eq!(backend.legacy.lock().unwrap().len(), 1);
        assert!(restarted.get(&id(), &secret).is_err());
    }
    #[test]
    fn corrupt_ciphertext_does_not_fall_back_or_leak_and_missing_key_is_not_recreated() {
        let file = Fixture::new();
        let backend = Backend::default();
        let (project, secret) = (id(), id());
        let vault = CredentialVault::new(file.0.clone(), backend.clone());
        vault.set(&project, &secret, "dummy-private-value").unwrap();
        let db = Connection::open(&file.0).unwrap();
        db.execute(
            "UPDATE credentials SET ciphertext=zeroblob(length(ciphertext))",
            [],
        )
        .unwrap();
        let error = vault.get(&project, &secret).unwrap_err();
        assert!(error.contains("authenticate"));
        assert!(!error.contains("dummy-private-value"));
        assert_eq!(backend.legacy_read.load(Ordering::SeqCst), 0);
        *backend.key.lock().unwrap() = None;
        let restarted = CredentialVault::new(file.0.clone(), backend.clone());
        assert!(restarted
            .get(&project, &secret)
            .unwrap_err()
            .contains("key is missing"));
        assert!(backend.key.lock().unwrap().is_none());
    }
    #[test]
    fn canceled_legacy_access_is_not_retried_and_no_empty_credential_is_written() {
        let file = Fixture::new();
        let backend = Backend::default();
        let (project, secret) = (id(), id());
        let vault = CredentialVault::new(file.0.clone(), backend.clone());
        assert!(vault.get(&project, &secret).is_err());
        assert_eq!(backend.legacy_read.load(Ordering::SeqCst), 1);
        let db = Connection::open(&file.0).unwrap();
        let count: i64 = db
            .query_row("SELECT COUNT(*) FROM credentials", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }
    #[test]
    fn authenticated_data_prevents_swapping_secrets_between_projects() {
        let file = Fixture::new();
        let backend = Backend::default();
        let (project, secret, other) = (id(), id(), id());
        let vault = CredentialVault::new(file.0.clone(), backend);
        vault.set(&project, &secret, "dummy-private-value").unwrap();
        let db = Connection::open(&file.0).unwrap();
        db.execute("UPDATE credentials SET project=?1", [&other])
            .unwrap();
        assert!(vault
            .get(&other, &secret)
            .unwrap_err()
            .contains("authenticate"));
    }
}
