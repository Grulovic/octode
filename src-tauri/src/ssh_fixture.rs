//! Encrypted SSH/SFTP integration over in-memory duplex streams; no listening socket needed.
use super::*;
use russh::server::{self, Auth, ChannelOpenHandle, Msg};
use russh::{Channel as SshChannel, ChannelId, Pty};
use russh_sftp::protocol::*;
use std::sync::atomic::{AtomicUsize, Ordering};
#[derive(Default)]
struct RemoteFs {
    files: Mutex<HashMap<String, Vec<u8>>>,
}
struct Sftp {
    fs: Arc<RemoteFs>,
    listed: bool,
}
fn ok(id: u32) -> Status {
    Status {
        id,
        status_code: StatusCode::Ok,
        error_message: String::new(),
        language_tag: String::new(),
    }
}
fn attributes(size: u64) -> FileAttributes {
    let mut attrs = FileAttributes {
        size: Some(size),
        ..Default::default()
    };
    attrs.set_regular(true);
    attrs
}
impl russh_sftp::server::Handler for Sftp {
    type Error = StatusCode;
    fn unimplemented(&self) -> StatusCode {
        StatusCode::OpUnsupported
    }
    async fn init(&mut self, _: u32, _: HashMap<String, String>) -> Result<Version, StatusCode> {
        Ok(Version::new())
    }
    async fn realpath(&mut self, id: u32, _: String) -> Result<Name, StatusCode> {
        Ok(Name {
            id,
            files: vec![File::dummy("/")],
        })
    }
    async fn opendir(&mut self, id: u32, _: String) -> Result<Handle, StatusCode> {
        self.listed = false;
        Ok(Handle {
            id,
            handle: "directory".into(),
        })
    }
    async fn readdir(&mut self, id: u32, _: String) -> Result<Name, StatusCode> {
        if self.listed {
            return Err(StatusCode::Eof);
        }
        self.listed = true;
        let fs = self.fs.files.lock().unwrap();
        Ok(Name {
            id,
            files: fs
                .iter()
                .map(|(name, bytes)| {
                    File::new(name.trim_start_matches('/'), attributes(bytes.len() as u64))
                })
                .collect(),
        })
    }
    async fn close(&mut self, id: u32, _: String) -> Result<Status, StatusCode> {
        Ok(ok(id))
    }
    async fn open(
        &mut self,
        id: u32,
        name: String,
        flags: OpenFlags,
        _: FileAttributes,
    ) -> Result<Handle, StatusCode> {
        let mut files = self.fs.files.lock().unwrap();
        if flags.contains(OpenFlags::CREATE) {
            files.entry(name.clone()).or_default();
        }
        if flags.contains(OpenFlags::TRUNCATE) {
            if let Some(bytes) = files.get_mut(&name) {
                bytes.clear();
            }
        }
        if !files.contains_key(&name) {
            return Err(StatusCode::NoSuchFile);
        }
        Ok(Handle { id, handle: name })
    }
    async fn read(
        &mut self,
        id: u32,
        handle: String,
        offset: u64,
        len: u32,
    ) -> Result<Data, StatusCode> {
        let files = self.fs.files.lock().unwrap();
        let bytes = files.get(&handle).ok_or(StatusCode::NoSuchFile)?;
        if offset as usize >= bytes.len() {
            return Err(StatusCode::Eof);
        }
        let end = bytes.len().min(offset as usize + len as usize);
        Ok(Data {
            id,
            data: bytes[offset as usize..end].to_vec(),
        })
    }
    async fn write(
        &mut self,
        id: u32,
        handle: String,
        offset: u64,
        data: Vec<u8>,
    ) -> Result<Status, StatusCode> {
        let mut files = self.fs.files.lock().unwrap();
        let bytes = files.get_mut(&handle).ok_or(StatusCode::NoSuchFile)?;
        let offset = offset as usize;
        if bytes.len() < offset + data.len() {
            bytes.resize(offset + data.len(), 0);
        }
        bytes[offset..offset + data.len()].copy_from_slice(&data);
        Ok(ok(id))
    }
    async fn stat(&mut self, id: u32, path: String) -> Result<Attrs, StatusCode> {
        let files = self.fs.files.lock().unwrap();
        let bytes = files.get(&path).ok_or(StatusCode::NoSuchFile)?;
        Ok(Attrs {
            id,
            attrs: attributes(bytes.len() as u64),
        })
    }
    async fn fstat(&mut self, id: u32, handle: String) -> Result<Attrs, StatusCode> {
        self.stat(id, handle).await
    }
    async fn rename(&mut self, id: u32, old: String, new: String) -> Result<Status, StatusCode> {
        let mut files = self.fs.files.lock().unwrap();
        let bytes = files.remove(&old).ok_or(StatusCode::NoSuchFile)?;
        files.insert(new, bytes);
        Ok(ok(id))
    }
    async fn remove(&mut self, id: u32, path: String) -> Result<Status, StatusCode> {
        self.fs
            .files
            .lock()
            .unwrap()
            .remove(&path)
            .ok_or(StatusCode::NoSuchFile)?;
        Ok(ok(id))
    }
}
struct Echo {
    channels: HashMap<ChannelId, SshChannel<Msg>>,
    fs: Arc<RemoteFs>,
}
impl server::Handler for Echo {
    type Error = russh::Error;
    async fn auth_password(&mut self, user: &str, password: &str) -> Result<Auth, Self::Error> {
        Ok(if user == "octode" && password == "fixture-password" {
            Auth::Accept
        } else {
            Auth::Reject {
                proceed_with_methods: None,
                partial_success: false,
            }
        })
    }
    async fn channel_open_session(
        &mut self,
        channel: SshChannel<Msg>,
        reply: ChannelOpenHandle,
        _: &mut server::Session,
    ) -> Result<(), Self::Error> {
        self.channels.insert(channel.id(), channel);
        reply.accept().await;
        Ok(())
    }
    async fn pty_request(
        &mut self,
        channel: ChannelId,
        _: &str,
        _: u32,
        _: u32,
        _: u32,
        _: u32,
        _: &[(Pty, u32)],
        session: &mut server::Session,
    ) -> Result<(), Self::Error> {
        session.channel_success(channel)?;
        Ok(())
    }
    async fn shell_request(
        &mut self,
        channel: ChannelId,
        session: &mut server::Session,
    ) -> Result<(), Self::Error> {
        session.channel_success(channel)?;
        Ok(())
    }
    async fn data(
        &mut self,
        channel: ChannelId,
        data: &[u8],
        session: &mut server::Session,
    ) -> Result<(), Self::Error> {
        session.data(channel, data.to_vec())?;
        Ok(())
    }
    async fn subsystem_request(
        &mut self,
        channel: ChannelId,
        name: &str,
        session: &mut server::Session,
    ) -> Result<(), Self::Error> {
        if name != "sftp" {
            session.channel_failure(channel)?;
            return Ok(());
        }
        session.channel_success(channel)?;
        let channel = self.channels.remove(&channel).unwrap();
        let fs = self.fs.clone();
        tokio::spawn(async move {
            russh_sftp::server::run(channel.into_stream(), Sftp { fs, listed: false }).await;
        });
        Ok(())
    }
    async fn channel_open_direct_tcpip(
        &mut self,
        channel: SshChannel<Msg>,
        _: &str,
        _: u32,
        _: &str,
        _: u32,
        reply: ChannelOpenHandle,
        _: &mut server::Session,
    ) -> Result<(), Self::Error> {
        reply.accept().await;
        tokio::spawn(async move {
            let (mut read, mut write) = tokio::io::split(channel.into_stream());
            let _ = tokio::io::copy(&mut read, &mut write).await;
        });
        Ok(())
    }
}
#[tokio::test]
async fn encrypted_ssh_auth_shell_sftp_and_forwarding_work_without_network_sockets() {
    tokio::time::timeout(Duration::from_secs(20), async {
        let key =
            russh::keys::PrivateKey::random(&mut rand::rng(), russh::keys::Algorithm::Ed25519)
                .unwrap();
        let fingerprint = key.public_key().fingerprint(HashAlg::Sha256).to_string();
        let fs = Arc::new(RemoteFs::default());
        fs.files
            .lock()
            .unwrap()
            .insert("/sample.txt".into(), b"remote sample".to_vec());
        let config = Arc::new(server::Config {
            keys: vec![key],
            auth_rejection_time: Duration::ZERO,
            auth_rejection_time_initial: Some(Duration::ZERO),
            ..Default::default()
        });
        let (client_stream, server_stream) = tokio::io::duplex(256 * 1024);
        let fixture = Echo {
            channels: HashMap::new(),
            fs: fs.clone(),
        };
        let running = tokio::spawn(async move {
            let session = server::run_stream(config, server_stream, fixture)
                .await
                .unwrap();
            let _ = session.await;
        });
        let mut handle = client::connect_stream(
            Arc::new(client::Config::default()),
            client_stream,
            Handler {
                expected: fingerprint,
                observed: Arc::new(Mutex::new(None)),
            },
        )
        .await
        .unwrap();
        assert!(!handle
            .authenticate_password("octode", "wrong")
            .await
            .unwrap()
            .success());
        assert!(handle
            .authenticate_password("octode", "fixture-password")
            .await
            .unwrap()
            .success());
        let mut shell = handle.channel_open_session().await.unwrap();
        shell
            .request_pty(true, "xterm-256color", 80, 24, 0, 0, &[])
            .await
            .unwrap();
        shell.request_shell(true).await.unwrap();
        shell.data(&b"echo fixture\n"[..]).await.unwrap();
        loop {
            if let Some(ChannelMsg::Data { data }) = shell.wait().await {
                assert_eq!(&data[..], b"echo fixture\n");
                break;
            }
        }
        shell.close().await.unwrap();
        let forwarding = handle
            .channel_open_direct_tcpip("database.internal", 5432, "127.0.0.1", 1234)
            .await
            .unwrap();
        let mut stream = forwarding.into_stream();
        stream.write_all(b"forwarded").await.unwrap();
        let mut received = [0u8; 9];
        tokio::io::AsyncReadExt::read_exact(&mut stream, &mut received)
            .await
            .unwrap();
        assert_eq!(&received, b"forwarded");
        drop(stream);
        let servers = Servers::default();
        let id = servers.insert("main", "project", handle).unwrap();
        let session = servers.get("main", &id).unwrap();
        let directory = session.list(".").await.unwrap();
        assert_eq!(directory.entries[0].name, "sample.txt");
        assert_eq!(directory.entries[0].size, 13);
        let local = std::env::temp_dir().join(format!("octode-sftp-{}", uuid::Uuid::new_v4()));
        tokio::fs::create_dir(&local).await.unwrap();
        let upload = local.join("upload");
        tokio::fs::write(&upload, vec![42u8; 180000]).await.unwrap();
        let events = Arc::new(AtomicUsize::new(0));
        let observed = events.clone();
        let progress = Channel::new(move |_| {
            observed.fetch_add(1, Ordering::SeqCst);
            Ok(())
        });
        let uploaded = session
            .transfer("/upload.bin", upload.to_str().unwrap(), true, progress)
            .await
            .unwrap();
        assert_eq!(uploaded, 180000);
        assert_eq!(fs.files.lock().unwrap()["/upload.bin"], vec![42u8; 180000]);
        assert!(events.load(Ordering::SeqCst) >= 2);
        let download = local.join("download");
        let bytes = session
            .transfer(
                "/upload.bin",
                download.to_str().unwrap(),
                false,
                Channel::new(|_| Ok(())),
            )
            .await
            .unwrap();
        assert_eq!(bytes, 180000);
        assert_eq!(tokio::fs::read(download).await.unwrap(), vec![42u8; 180000]);
        session
            .mutate("rename", "/upload.bin", "/renamed.bin")
            .await
            .unwrap();
        session.mutate("delete", "/renamed.bin", "").await.unwrap();
        assert!(!fs.files.lock().unwrap().contains_key("/renamed.bin"));
        servers.close("main", &id);
        assert!(servers.get("main", &id).is_err());
        assert!(session.cancel.is_cancelled());
        tokio::fs::remove_dir_all(local).await.unwrap();
        running.abort();
    })
    .await
    .expect("SSH/SFTP fixture timed out");
}
