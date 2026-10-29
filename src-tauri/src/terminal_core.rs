//! Terminal flow control and ordered input, independent of the PTY/UI adapters.
use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, SyncSender, TrySendError};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

pub const MAX_INPUT_BYTES: usize = 64 * 1024;
pub const OUTPUT_CAPACITY: usize = 256 * 1024;

struct FlowState {
    pending: usize,
    closed: bool,
}
pub struct OutputFlow {
    state: Mutex<FlowState>,
    changed: Condvar,
    capacity: usize,
}

impl OutputFlow {
    pub fn new(capacity: usize) -> Self {
        Self {
            state: Mutex::new(FlowState {
                pending: 0,
                closed: false,
            }),
            changed: Condvar::new(),
            capacity,
        }
    }
    pub fn reserve(&self, bytes: usize) -> bool {
        if bytes > self.capacity {
            return false;
        }
        let Ok(mut state) = self.state.lock() else {
            return false;
        };
        while !state.closed && state.pending > self.capacity - bytes {
            state = match self.changed.wait(state) {
                Ok(state) => state,
                Err(_) => return false,
            };
        }
        if state.closed {
            return false;
        }
        state.pending += bytes;
        true
    }
    pub fn acknowledge(&self, bytes: usize) {
        if let Ok(mut state) = self.state.lock() {
            state.pending = state.pending.saturating_sub(bytes);
            self.changed.notify_all();
        }
    }
    pub fn close(&self) {
        if let Ok(mut state) = self.state.lock() {
            state.closed = true;
            self.changed.notify_all();
        }
    }
    pub fn is_closed(&self) -> bool {
        self.state.lock().map(|state| state.closed).unwrap_or(true)
    }
}

pub struct OrderedInput {
    sender: SyncSender<Vec<u8>>,
    stopped: Arc<AtomicBool>,
    error: Arc<Mutex<Option<String>>>,
}

impl OrderedInput {
    pub fn new<W: Write + Send + 'static>(mut writer: W, capacity: usize) -> Result<Self, String> {
        let (sender, receiver) = mpsc::sync_channel::<Vec<u8>>(capacity.max(1));
        let stopped = Arc::new(AtomicBool::new(false));
        let thread_stopped = stopped.clone();
        let error = Arc::new(Mutex::new(None));
        let thread_error = error.clone();
        std::thread::Builder::new()
            .name("octode-terminal-input".into())
            .spawn(move || {
                while !thread_stopped.load(Ordering::Acquire) {
                    match receiver.recv_timeout(Duration::from_millis(100)) {
                        Ok(data) => {
                            if thread_stopped.load(Ordering::Acquire) {
                                break;
                            }
                            if let Err(failure) =
                                writer.write_all(&data).and_then(|_| writer.flush())
                            {
                                if let Ok(mut error) = thread_error.lock() {
                                    *error = Some(failure.to_string());
                                }
                                break;
                            }
                        }
                        Err(mpsc::RecvTimeoutError::Timeout) => continue,
                        Err(mpsc::RecvTimeoutError::Disconnected) => break,
                    }
                }
                thread_stopped.store(true, Ordering::Release);
            })
            .map_err(|error| error.to_string())?;
        Ok(Self {
            sender,
            stopped,
            error,
        })
    }
    pub fn send(&self, data: &[u8]) -> Result<(), String> {
        if let Some(error) = self
            .error
            .lock()
            .map_err(|error| error.to_string())?
            .as_ref()
        {
            return Err(format!("Terminal input failed: {error}"));
        }
        if self.stopped.load(Ordering::Acquire) {
            return Err("Terminal session has ended".into());
        }
        if data.len() > MAX_INPUT_BYTES {
            return Err("Terminal input is limited to 64 KB per chunk".into());
        }
        self.sender
            .try_send(data.to_vec())
            .map_err(|error| match error {
                TrySendError::Full(_) => {
                    "The terminal is not accepting input fast enough. Some input was not sent."
                        .into()
                }
                TrySendError::Disconnected(_) => "Terminal session has ended".into(),
            })
    }
    pub fn close(&self) {
        self.stopped.store(true, Ordering::Release);
    }
}
impl Drop for OrderedInput {
    fn drop(&mut self) {
        self.close();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pauses_output_until_the_frontend_acknowledges_bytes() {
        let flow = Arc::new(OutputFlow::new(64));
        assert!(flow.reserve(64));
        let (attempt_tx, attempt_rx) = mpsc::channel();
        let (done_tx, done_rx) = mpsc::channel();
        let worker_flow = flow.clone();
        let worker = std::thread::spawn(move || {
            attempt_tx.send(()).unwrap();
            done_tx.send(worker_flow.reserve(1)).unwrap();
        });
        attempt_rx.recv_timeout(Duration::from_secs(1)).unwrap();
        assert!(done_rx.try_recv().is_err());
        flow.acknowledge(1);
        assert!(done_rx.recv_timeout(Duration::from_secs(1)).unwrap());
        worker.join().unwrap();
    }
    #[test]
    fn closing_output_releases_a_waiting_producer() {
        let flow = Arc::new(OutputFlow::new(1));
        assert!(flow.reserve(1));
        let worker_flow = flow.clone();
        let (done_tx, done_rx) = mpsc::channel();
        let worker = std::thread::spawn(move || done_tx.send(worker_flow.reserve(1)).unwrap());
        flow.close();
        assert!(!done_rx.recv_timeout(Duration::from_secs(1)).unwrap());
        worker.join().unwrap();
        assert!(flow.is_closed());
    }
    #[test]
    fn bounds_reservations_and_tolerates_late_acknowledgments() {
        let flow = OutputFlow::new(8);
        assert!(!flow.reserve(9));
        flow.acknowledge(usize::MAX);
        assert!(flow.reserve(8));
        flow.close();
        flow.acknowledge(8);
        assert!(!flow.reserve(1));
        assert_eq!(OUTPUT_CAPACITY, 256 * 1024);
    }
    struct MemoryWriter {
        bytes: Arc<Mutex<Vec<u8>>>,
        written: mpsc::Sender<()>,
    }
    impl Write for MemoryWriter {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.bytes.lock().unwrap().extend_from_slice(bytes);
            self.written.send(()).unwrap();
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    #[test]
    fn preserves_input_order_and_rejects_input_after_close() {
        let bytes = Arc::new(Mutex::new(Vec::new()));
        let (tx, rx) = mpsc::channel();
        let input = OrderedInput::new(
            MemoryWriter {
                bytes: bytes.clone(),
                written: tx,
            },
            64,
        )
        .unwrap();
        for index in 0..32 {
            input.send(&[index]).unwrap();
        }
        for _ in 0..32 {
            rx.recv_timeout(Duration::from_secs(1)).unwrap();
        }
        assert_eq!(*bytes.lock().unwrap(), (0..32).collect::<Vec<_>>());
        assert!(input.send(&vec![b'a'; MAX_INPUT_BYTES + 1]).is_err());
        input.close();
        assert!(input.send(b"after close").is_err());
    }
    struct PausedWriter {
        started: mpsc::Sender<()>,
        release: mpsc::Receiver<()>,
    }
    impl Write for PausedWriter {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            let _ = self.started.send(());
            self.release
                .recv()
                .map_err(|_| std::io::Error::new(std::io::ErrorKind::BrokenPipe, "released"))?;
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    #[test]
    fn a_blocked_shell_does_not_block_the_command_caller() {
        let (start_tx, start_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let input = OrderedInput::new(
            PausedWriter {
                started: start_tx,
                release: release_rx,
            },
            1,
        )
        .unwrap();
        input.send(b"first").unwrap();
        start_rx.recv_timeout(Duration::from_secs(1)).unwrap();
        input.send(b"queued").unwrap();
        assert!(input
            .send(b"queue is full")
            .unwrap_err()
            .contains("not accepting input"));
        input.close();
        release_tx.send(()).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn sends_ordered_commands_to_a_real_shell() {
        use std::process::{Command, Stdio};
        let mut child = Command::new("/bin/sh")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let input = OrderedInput::new(child.stdin.take().unwrap(), 8).unwrap();
        for part in [
            "printf '%s' ",
            "'first'\n",
            "printf '%s' 'second'\n",
            "exit\n",
        ] {
            input.send(part.as_bytes()).unwrap();
        }
        let (done_tx, done_rx) = mpsc::channel();
        let mut stdout = child.stdout.take().unwrap();
        let reader = std::thread::spawn(move || {
            let mut output = String::new();
            std::io::Read::read_to_string(&mut stdout, &mut output).unwrap();
            let _ = done_tx.send(output);
        });
        let output = done_rx.recv_timeout(Duration::from_secs(3));
        if output.is_err() {
            let _ = child.kill();
        }
        let status = child.wait().unwrap();
        input.close();
        reader.join().unwrap();
        assert!(status.success());
        assert_eq!(output.unwrap(), "firstsecond");
    }
}
