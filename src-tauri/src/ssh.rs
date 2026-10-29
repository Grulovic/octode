use crate::{
    secrets::{resolve, SecretValue, Vault},
    terminal::Output,
};
use russh::{
    client,
    keys::{HashAlg, PrivateKeyWithHashAlg, PublicKeyOrCertificate},
    ChannelMsg,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::ipc::Channel;
use tokio::{
    io::AsyncWriteExt,
    sync::{mpsc, Semaphore},
};
use tokio_util::sync::CancellationToken;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerConnection {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: String,
    pub password: SecretValue,
    pub key_path: String,
    pub passphrase: SecretValue,
    pub fingerprint: String,
}
#[derive(Deserialize)]
pub struct ServerDocument {
    #[allow(dead_code)]
    pub connections: Vec<ServerConnection>,
}
pub struct Handler {
    expected: String,
    observed: Arc<Mutex<Option<String>>>,
}
impl client::Handler for Handler {
    type Error = russh::Error;
    async fn check_server_key(
        &mut self,
        key: &PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        let fp = key.public_key().fingerprint(HashAlg::Sha256).to_string();
        *self.observed.lock().unwrap() = Some(fp.clone());
        Ok(!self.expected.is_empty() && self.expected == fp)
    }
}
async fn handshake(
    connection: &ServerConnection,
    expected: String,
    observed: Arc<Mutex<Option<String>>>,
) -> Result<client::Handle<Handler>, String> {
    if connection.host.trim().is_empty() || connection.port == 0 {
        return Err("Enter the server host and port".into());
    }
    let config = Arc::new(client::Config {
        inactivity_timeout: Some(Duration::from_secs(3600)),
        ..Default::default()
    });
    tokio::time::timeout(
        Duration::from_secs(20),
        client::connect(
            config,
            (connection.host.as_str(), connection.port),
            Handler { expected, observed },
        ),
    )
    .await
    .map_err(|_| "SSH connection timed out")?
    .map_err(|_| "SSH handshake failed; check the host and trusted fingerprint".into())
}
pub async fn fingerprint(connection: ServerConnection) -> Result<String, String> {
    let observed = Arc::new(Mutex::new(None));
    let result = handshake(&connection, String::new(), observed.clone()).await;
    let value = observed
        .lock()
        .map_err(|_| "Host-key check failed")?
        .clone();
    value.ok_or_else(|| {
        result
            .err()
            .unwrap_or("The server did not provide a host key".into())
    })
}
pub async fn authenticate(
    connection: &ServerConnection,
    project: &str,
) -> Result<client::Handle<Handler>, String> {
    if connection.fingerprint.is_empty() {
        return Err("Check and trust the server fingerprint before connecting".into());
    }
    let mut handle = handshake(
        connection,
        connection.fingerprint.clone(),
        Arc::new(Mutex::new(None)),
    )
    .await?;
    let authenticated = match connection.auth.as_str() {
        "password" => handle
            .authenticate_password(
                &connection.username,
                resolve(&connection.password, project, &Vault)?,
            )
            .await
            .map_err(|_| "SSH authentication failed")?
            .success(),
        "key" => {
            let pass = resolve(&connection.passphrase, project, &Vault)?;
            let key = russh::keys::load_secret_key(
                &connection.key_path,
                if pass.is_empty() {
                    None
                } else {
                    Some(pass.as_str())
                },
            )
            .map_err(|_| "Could not read the private key; check the file and passphrase")?;
            let hash = handle
                .best_supported_rsa_hash()
                .await
                .map_err(|_| "Could not negotiate a key algorithm")?
                .flatten();
            handle
                .authenticate_publickey(
                    &connection.username,
                    PrivateKeyWithHashAlg::new(Arc::new(key), hash),
                )
                .await
                .map_err(|_| "SSH key authentication failed")?
                .success()
        }
        "agent" => agent_auth(&mut handle, &connection.username).await?,
        _ => return Err("Unknown SSH authentication method".into()),
    };
    if !authenticated {
        return Err("The SSH server rejected the credentials".into());
    }
    Ok(handle)
}
#[cfg(unix)]
async fn agent_auth(handle: &mut client::Handle<Handler>, username: &str) -> Result<bool, String> {
    let mut agent = russh::keys::agent::client::AgentClient::connect_env()
        .await
        .map_err(|_| "SSH agent unavailable; start an agent or select a private key")?;
    let identities = agent
        .request_identities()
        .await
        .map_err(|_| "Could not read SSH agent identities")?;
    let hash = handle
        .best_supported_rsa_hash()
        .await
        .map_err(|_| "Could not negotiate a key algorithm")?
        .flatten();
    for identity in identities.into_iter().take(10) {
        if handle
            .authenticate_publickey_with(
                username,
                identity.public_key().into_owned(),
                hash,
                &mut agent,
            )
            .await
            .map_err(|_| "SSH agent authentication failed")?
            .success()
        {
            return Ok(true);
        }
    }
    Ok(false)
}
#[cfg(not(unix))]
async fn agent_auth(_: &mut client::Handle<Handler>, _: &str) -> Result<bool, String> {
    Err(
        "SSH agent authentication is not available on this platform yet; choose a private key"
            .into(),
    )
}

enum Input {
    Data(String),
    Resize(u32, u32),
}
pub struct Session {
    pub owner: String,
    pub project: String,
    pub handle: Arc<client::Handle<Handler>>,
    pub cancel: CancellationToken,
    input: Mutex<Option<(String, mpsc::Sender<Input>)>>,
    flow: Arc<Semaphore>,
}
#[derive(Default)]
pub struct Servers(Mutex<HashMap<String, Arc<Session>>>);
impl Servers {
    pub fn insert(
        &self,
        owner: &str,
        project: &str,
        handle: client::Handle<Handler>,
    ) -> Result<String, String> {
        let id = uuid::Uuid::new_v4().to_string();
        self.0.lock().map_err(|e| e.to_string())?.insert(
            id.clone(),
            Arc::new(Session {
                owner: owner.into(),
                project: project.into(),
                handle: Arc::new(handle),
                cancel: CancellationToken::new(),
                input: Mutex::new(None),
                flow: Arc::new(Semaphore::new(256 * 1024)),
            }),
        );
        Ok(id)
    }
    pub fn get(&self, owner: &str, id: &str) -> Result<Arc<Session>, String> {
        self.0
            .lock()
            .map_err(|e| e.to_string())?
            .get(id)
            .filter(|session| {
                session.owner == owner
                    && !session.cancel.is_cancelled()
                    && !session.handle.is_closed()
            })
            .cloned()
            .ok_or("SSH session is closed".into())
    }
    pub fn close(&self, owner: &str, id: &str) {
        if let Ok(mut sessions) = self.0.lock() {
            if sessions.get(id).is_some_and(|s| s.owner == owner) {
                if let Some(session) = sessions.remove(id) {
                    session.cancel.cancel();
                    let handle = session.handle.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = handle
                            .disconnect(russh::Disconnect::ByApplication, "Closing connection", "")
                            .await;
                    });
                }
            }
        }
    }
    pub fn close_window(&self, owner: &str) {
        let ids = self
            .0
            .lock()
            .map(|sessions| {
                sessions
                    .iter()
                    .filter(|(_, s)| s.owner == owner)
                    .map(|(id, _)| id.clone())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        for id in ids {
            self.close(owner, &id);
        }
    }
    pub async fn shell(
        &self,
        owner: &str,
        id: &str,
        shell_key: String,
        cols: u32,
        rows: u32,
        output: Channel<Output>,
    ) -> Result<(), String> {
        let session = self.get(owner, id)?;
        let (tx, mut rx) = mpsc::channel::<Input>(64);
        {
            let mut input = session.input.lock().map_err(|e| e.to_string())?;
            *input = Some((shell_key.clone(), tx));
        }
        let started = async {
            let channel = session
                .handle
                .channel_open_session()
                .await
                .map_err(|_| "Could not open the SSH terminal")?;
            channel
                .request_pty(
                    true,
                    "xterm-256color",
                    cols.clamp(1, 500),
                    rows.clamp(1, 300),
                    0,
                    0,
                    &[],
                )
                .await
                .map_err(|_| "The server rejected the terminal")?;
            channel
                .request_shell(true)
                .await
                .map_err(|_| "The server rejected the shell")?;
            Ok::<_, String>(channel)
        }
        .await;
        let mut channel = match started {
            Ok(channel) => channel,
            Err(error) => {
                let mut input = session.input.lock().map_err(|e| e.to_string())?;
                if input.as_ref().is_some_and(|(key, _)| key == &shell_key) {
                    *input = None;
                }
                return Err(error);
            }
        };
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::select! {
                    _=session.cancel.cancelled()=>{let _=channel.close().await;break;},
                    input=rx.recv()=>{match input{Some(Input::Data(data))=>{if channel.data(data.as_bytes()).await.is_err(){break;}},Some(Input::Resize(cols,rows))=>{let _=channel.window_change(cols,rows,0,0).await;},None=>{let _=channel.close().await;break;}}},
                    message=channel.wait()=>{match message{Some(ChannelMsg::Data{data})|Some(ChannelMsg::ExtendedData{data,..})=>{
                        for chunk in data.chunks(32768){let permit=tokio::select!{_ =session.cancel.cancelled()=>break,permit=session.flow.acquire_many(chunk.len() as u32)=>permit};let Ok(permit)=permit else{break};permit.forget();if output.send(Output::Data(chunk.to_vec())).is_err(){session.cancel.cancel();break;}}
                    },Some(ChannelMsg::ExitStatus{exit_status})=>{let _=output.send(Output::Exit(format!("Shell exited ({exit_status})")));break;},Some(ChannelMsg::Close)|None=>break,_=>{}}}
                }
            }
            if let Ok(mut input) = session.input.lock() {
                if input.as_ref().is_some_and(|(key, _)| key == &shell_key) {
                    *input = None;
                }
            }
            let _ = output.send(Output::Exit("SSH terminal closed".into()));
        });
        Ok(())
    }
    pub async fn write(&self, owner: &str, id: &str, data: String) -> Result<(), String> {
        if data.len() > 65536 {
            return Err("Terminal input is too large".into());
        }
        let s = self.get(owner, id)?;
        let sender = s
            .input
            .lock()
            .map_err(|e| e.to_string())?
            .clone()
            .ok_or("Terminal is closed")?;
        sender
            .1
            .send(Input::Data(data))
            .await
            .map_err(|_| "Terminal is closed".into())
    }
    pub async fn resize(&self, owner: &str, id: &str, cols: u32, rows: u32) -> Result<(), String> {
        let s = self.get(owner, id)?;
        let sender = s.input.lock().map_err(|e| e.to_string())?.clone();
        if let Some(sender) = sender {
            sender
                .1
                .send(Input::Resize(cols.clamp(1, 500), rows.clamp(1, 300)))
                .await
                .map_err(|_| "Terminal is closed")?;
        }
        Ok(())
    }
    pub fn shell_close(&self, owner: &str, id: &str, key: &str) {
        if let Ok(s) = self.get(owner, id) {
            if let Ok(mut input) = s.input.lock() {
                if input.as_ref().is_some_and(|(current, _)| current == key) {
                    *input = None;
                }
            }
        }
    }
    pub fn ack(&self, owner: &str, id: &str, bytes: usize) -> Result<(), String> {
        let s = self.get(owner, id)?;
        if bytes > 256 * 1024 || s.flow.available_permits() + bytes > 256 * 1024 {
            return Err("Invalid SSH output acknowledgement".into());
        }
        s.flow.add_permits(bytes);
        Ok(())
    }
}
impl Session {
    async fn sftp(&self) -> Result<russh_sftp::client::SftpSession, String> {
        let channel = self
            .handle
            .channel_open_session()
            .await
            .map_err(|_| "Could not open SFTP")?;
        channel
            .request_subsystem(true, "sftp")
            .await
            .map_err(|_| "The server does not support SFTP")?;
        russh_sftp::client::SftpSession::new(channel.into_stream())
            .await
            .map_err(|_| "Could not start SFTP".into())
    }
    pub async fn list(&self, path: &str) -> Result<Directory, String> {
        let sftp = self.sftp().await?;
        let path = sftp
            .canonicalize(path)
            .await
            .map_err(|_| "Remote folder is unavailable")?;
        let entries = sftp
            .read_dir(&path)
            .await
            .map_err(|_| "Could not list remote files")?
            .take(10000)
            .map(|entry| {
                let metadata = entry.metadata();
                RemoteEntry {
                    name: entry.file_name(),
                    path: entry.path(),
                    directory: entry.file_type().is_dir(),
                    size: metadata.size.unwrap_or(0),
                    modified: metadata.mtime,
                }
            })
            .collect();
        Ok(Directory { path, entries })
    }
    pub async fn transfer(
        &self,
        remote: &str,
        local: &str,
        upload: bool,
        progress: Channel<crate::transfer::Progress>,
    ) -> Result<u64, String> {
        let sftp = self.sftp().await?;
        if upload {
            let mut source = tokio::fs::File::open(local)
                .await
                .map_err(|_| "Local file is unavailable")?;
            let mut destination = sftp
                .create(remote)
                .await
                .map_err(|_| "Remote destination is unavailable")?;
            let total = source.metadata().await.ok().map(|metadata| metadata.len());
            let bytes = crate::transfer::copy(&mut source, &mut destination, total, |event| {
                progress
                    .send(event)
                    .map_err(|_| "Transfer view closed; upload may be incomplete".into())
            })
            .await?;
            destination
                .shutdown()
                .await
                .map_err(|_| "Could not finish the upload")?;
            Ok(bytes)
        } else {
            // Download to a sibling temporary file; rename only after a complete transfer.
            let target = std::path::Path::new(local);
            let temp = target.with_file_name(format!(".octode-download-{}", uuid::Uuid::new_v4()));
            let _cleanup = DownloadCleanup(temp.clone());
            let result = async {
                let mut source = sftp
                    .open(remote)
                    .await
                    .map_err(|_| "Remote file is unavailable")?;
                let mut destination = tokio::fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&temp)
                    .await
                    .map_err(|_| "Local destination is unavailable")?;
                let total = sftp
                    .metadata(remote)
                    .await
                    .ok()
                    .and_then(|metadata| metadata.size);
                let bytes = crate::transfer::copy(&mut source, &mut destination, total, |event| {
                    progress
                        .send(event)
                        .map_err(|_| "Transfer view closed".into())
                })
                .await?;
                destination
                    .flush()
                    .await
                    .map_err(|_| "Could not finish the download")?;
                drop(destination);
                tokio::fs::rename(&temp, target)
                    .await
                    .map_err(|_| "Could not move the downloaded file into place")?;
                Ok(bytes)
            }
            .await;
            if result.is_err() {
                let _ = tokio::fs::remove_file(&temp).await;
            }
            result
        }
    }
    pub async fn mutate(&self, action: &str, path: &str, destination: &str) -> Result<(), String> {
        let sftp = self.sftp().await?;
        match action {
            "mkdir" => sftp.create_dir(path).await,
            "rename" => sftp.rename(path, destination).await,
            "delete" => sftp.remove_file(path).await,
            "rmdir" => sftp.remove_dir(path).await,
            _ => return Err("Unknown file action".into()),
        }
        .map_err(|_| "Remote file action failed".into())
    }
    pub async fn tunnel(self: &Arc<Self>, host: String, port: u16) -> Result<Tunnel, String> {
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .map_err(|_| "Could not bind the SSH tunnel")?;
        let local_port = listener
            .local_addr()
            .map_err(|_| "Could not read the tunnel port")?
            .port();
        let cancel = self.cancel.child_token();
        let task_cancel = cancel.clone();
        let session = self.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::select! {_=task_cancel.cancelled()=>break,accepted=listener.accept()=>{let Ok((mut socket,address))=accepted else{break};let session=session.clone();let host=host.clone();let cancel=task_cancel.clone();tauri::async_runtime::spawn(async move{tokio::select!{_=cancel.cancelled()=>{},_=async{if let Ok(channel)=session.handle.channel_open_direct_tcpip(host,port.into(),address.ip().to_string(),address.port().into()).await{let mut stream=channel.into_stream();let _=tokio::io::copy_bidirectional(&mut socket,&mut stream).await;}}=>{}}});}}
            }
        });
        Ok(Tunnel {
            port: local_port,
            cancel,
        })
    }
}
pub struct Tunnel {
    pub port: u16,
    cancel: CancellationToken,
}
impl Drop for Tunnel {
    fn drop(&mut self) {
        self.cancel.cancel();
    }
}
#[derive(Serialize)]
pub struct Directory {
    path: String,
    entries: Vec<RemoteEntry>,
}
#[derive(Serialize)]
pub struct RemoteEntry {
    name: String,
    path: String,
    directory: bool,
    size: u64,
    modified: Option<u32>,
}

struct DownloadCleanup(std::path::PathBuf);
impl Drop for DownloadCleanup {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn host_key_requires_explicit_exact_fingerprint() {
        let key = russh::keys::PublicKey::from_openssh(
            "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJdD7y3aLq454yWBdwLWbieU1ebz9/cu7/QEXn9OIeZJ",
        )
        .unwrap();
        let expected = key.fingerprint(HashAlg::Sha256).to_string();
        let observed = Arc::new(Mutex::new(None));
        let key = PublicKeyOrCertificate::PublicKey {
            key,
            hash_alg: None,
        };
        let mut handler = Handler {
            expected: String::new(),
            observed: observed.clone(),
        };
        assert!(!client::Handler::check_server_key(&mut handler, &key)
            .await
            .unwrap());
        assert_eq!(*observed.lock().unwrap(), Some(expected.clone()));
        handler.expected = "SHA256:changed".into();
        assert!(!client::Handler::check_server_key(&mut handler, &key)
            .await
            .unwrap());
        handler.expected = expected;
        assert!(client::Handler::check_server_key(&mut handler, &key)
            .await
            .unwrap());
    }
}

#[cfg(test)]
#[path = "ssh_fixture.rs"]
mod fixture;
