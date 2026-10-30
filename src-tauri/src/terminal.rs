use crate::terminal_core::{OrderedInput, OutputFlow, OUTPUT_CAPACITY};
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::Read;
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;

#[derive(Clone, Serialize)]
#[serde(tag = "event", content = "data", rename_all = "lowercase")]
pub enum Output {
    Data(Vec<u8>),
    Exit(String),
}

struct Session {
    owner: String,
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: OrderedInput,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    flow: OutputFlow,
}

#[derive(Default)]
pub struct Terminals(Mutex<HashMap<String, Arc<Session>>>);

// A projectless terminal may start only at the resolved user home directory.
pub fn home_root(home: &Path, requested: &str) -> Result<std::path::PathBuf, String> {
    let home = home.canonicalize().map_err(|error| error.to_string())?;
    let requested = Path::new(requested)
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if requested != home || !home.is_dir() {
        return Err("A terminal without a project must start in your home folder".into());
    }
    Ok(home)
}

impl Terminals {
    pub fn create(
        &self,
        owner: &str,
        root: &Path,
        rows: u16,
        cols: u16,
        output: Channel<Output>,
    ) -> Result<String, String> {
        let pair = native_pty_system()
            .openpty(size(rows, cols))
            .map_err(|e| e.to_string())?;
        let shell =
            std::env::var(if cfg!(windows) { "COMSPEC" } else { "SHELL" }).unwrap_or_else(|_| {
                if cfg!(windows) {
                    "cmd.exe".into()
                } else {
                    "/bin/sh".into()
                }
            });
        let mut command = CommandBuilder::new(shell);
        if !cfg!(windows) {
            command.arg("-l");
        }
        command.cwd(root);
        command.env("TERM", "xterm-256color");
        // Prepare fallible I/O resources before starting the child process.
        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = OrderedInput::new(pair.master.take_writer().map_err(|e| e.to_string())?, 32)?;
        let mut child = pair
            .slave
            .spawn_command(command)
            .map_err(|e| e.to_string())?;
        drop(pair.slave);
        let session = Arc::new(Session {
            owner: owner.into(),
            master: Mutex::new(pair.master),
            writer,
            killer: Mutex::new(child.clone_killer()),
            flow: OutputFlow::new(OUTPUT_CAPACITY),
        });
        let id = uuid::Uuid::new_v4().to_string();
        match self.0.lock() {
            Ok(mut sessions) => {
                sessions.insert(id.clone(), session.clone());
            }
            Err(error) => {
                session.flow.close();
                session.writer.close();
                let _ = child.kill();
                let _ = child.wait();
                return Err(error.to_string());
            }
        }
        let reader_thread = std::thread::Builder::new()
            .name("octode-terminal-output".into())
            .spawn(move || {
                let mut buffer = [0_u8; 8192];
                loop {
                    if session.flow.is_closed() {
                        break;
                    }
                    let count = match reader.read(&mut buffer) {
                        Ok(0) => break,
                        Err(_) => {
                            if let Ok(mut killer) = session.killer.lock() {
                                let _ = killer.kill();
                            }
                            break;
                        }
                        Ok(count) => count,
                    };
                    if !session.flow.reserve(count) {
                        break;
                    }
                    if output.send(Output::Data(buffer[..count].to_vec())).is_err() {
                        if let Ok(mut killer) = session.killer.lock() {
                            let _ = killer.kill();
                        }
                        break;
                    }
                }
                let status = child
                    .wait()
                    .map(|status| status.to_string())
                    .unwrap_or_else(|e| e.to_string());
                session.flow.close();
                session.writer.close();
                let _ = output.send(Output::Exit(status));
            });
        if let Err(error) = reader_thread {
            let _ = self.close(owner, &id);
            return Err(error.to_string());
        }
        Ok(id)
    }

    fn session(&self, owner: &str, id: &str) -> Result<Arc<Session>, String> {
        let sessions = self.0.lock().map_err(|e| e.to_string())?;
        let session = sessions.get(id).ok_or("Terminal session has ended")?;
        if session.owner != owner {
            return Err("Terminal belongs to another window".into());
        }
        Ok(session.clone())
    }

    pub fn write(&self, owner: &str, id: &str, data: &str) -> Result<(), String> {
        let session = self.session(owner, id)?;
        if session.flow.is_closed() {
            return Err("Terminal session has ended".into());
        }
        session.writer.send(data.as_bytes())
    }

    pub fn resize(&self, owner: &str, id: &str, rows: u16, cols: u16) -> Result<(), String> {
        let session = self.session(owner, id)?;
        let result = session
            .master
            .lock()
            .map_err(|e| e.to_string())?
            .resize(size(rows, cols))
            .map_err(|e| e.to_string());
        result
    }

    pub fn ack(&self, owner: &str, id: &str, bytes: usize) -> Result<(), String> {
        let session = self.session(owner, id)?;
        session.flow.acknowledge(bytes);
        Ok(())
    }

    pub fn close(&self, owner: &str, id: &str) -> Result<(), String> {
        let session = self.session(owner, id)?;
        self.0.lock().map_err(|e| e.to_string())?.remove(id);
        let exited = session.flow.is_closed();
        session.flow.close();
        session.writer.close();
        if exited {
            return Ok(());
        }
        let result = session
            .killer
            .lock()
            .map_err(|e| e.to_string())?
            .kill()
            .map_err(|e| e.to_string());
        result
    }

    pub fn close_window(&self, owner: &str) {
        let ids: Vec<String> = self
            .0
            .lock()
            .map(|sessions| {
                sessions
                    .iter()
                    .filter(|(_, session)| session.owner == owner)
                    .map(|(id, _)| id.clone())
                    .collect()
            })
            .unwrap_or_default();
        for id in ids {
            let _ = self.close(owner, &id);
        }
    }
}

fn size(rows: u16, cols: u16) -> PtySize {
    PtySize {
        rows: rows.max(1),
        cols: cols.max(1),
        pixel_width: 0,
        pixel_height: 0,
    }
}

#[cfg(test)]
mod home_tests {
    use super::*;
    #[test]
    fn projectless_terminal_only_starts_in_the_home_directory() {
        let root =
            std::env::temp_dir().join(format!("octode-home-terminal-{}", uuid::Uuid::new_v4()));
        let home = root.join("home");
        let other = root.join("other");
        std::fs::create_dir_all(&home).unwrap();
        std::fs::create_dir_all(&other).unwrap();
        assert_eq!(
            home_root(&home, home.to_str().unwrap()).unwrap(),
            home.canonicalize().unwrap()
        );
        assert!(home_root(&home, other.to_str().unwrap()).is_err());
        assert!(home_root(&home, home.join("missing").to_str().unwrap()).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
