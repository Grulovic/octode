use serde::Serialize;
use std::time::{Duration, Instant};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
#[derive(Clone, Serialize)]
pub struct Progress {
    pub bytes: u64,
    pub total: Option<u64>,
}
pub async fn copy<R, W, F>(
    source: &mut R,
    destination: &mut W,
    total: Option<u64>,
    mut progress: F,
) -> Result<u64, String>
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin,
    F: FnMut(Progress) -> Result<(), String>,
{
    let mut buffer = vec![0; 64 * 1024];
    let mut bytes = 0;
    let mut last = Instant::now();
    progress(Progress { bytes, total })?;
    loop {
        let read = source
            .read(&mut buffer)
            .await
            .map_err(|_| "The transfer source could not be read")?;
        if read == 0 {
            break;
        }
        destination
            .write_all(&buffer[..read])
            .await
            .map_err(|_| "The transfer destination could not be written")?;
        bytes += read as u64;
        if last.elapsed() >= Duration::from_millis(100) {
            progress(Progress { bytes, total })?;
            last = Instant::now();
        }
    }
    destination
        .flush()
        .await
        .map_err(|_| "Could not flush the transferred data")?;
    progress(Progress { bytes, total })?;
    Ok(bytes)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn streams_and_reports_progress_without_losing_bytes() {
        let input = vec![7u8; 200000];
        let mut source = input.as_slice();
        let mut output = Vec::new();
        let mut events = Vec::new();
        let bytes = copy(
            &mut source,
            &mut output,
            Some(input.len() as u64),
            |event| {
                events.push(event);
                Ok(())
            },
        )
        .await
        .unwrap();
        assert_eq!(bytes, 200000);
        assert_eq!(output, input);
        assert_eq!(events.first().unwrap().bytes, 0);
        assert_eq!(events.last().unwrap().bytes, 200000);
        assert_eq!(events.last().unwrap().total, Some(200000));
    }
    #[tokio::test]
    async fn stops_when_the_observer_disappears() {
        let input = vec![1; 100];
        let mut source = input.as_slice();
        let mut output = Vec::new();
        assert!(
            copy(&mut source, &mut output, None, |_| Err("closed".into()))
                .await
                .is_err()
        );
        assert!(output.is_empty());
    }
}
