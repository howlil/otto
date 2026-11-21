use std::path::Path;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::Command;
use tokio::sync::watch;

use crate::voice::model::{clean_whisper_transcript, normalize_voice_language};

const MAX_TRANSCRIPT_BYTES: usize = 256 * 1024;
const TRANSCRIBE_TIMEOUT: Duration = Duration::from_secs(60);

async fn read_bounded<R: AsyncRead + Unpin>(mut reader: R) -> Result<Vec<u8>, String> {
    let mut output = Vec::new();
    let mut chunk = [0_u8; 4096];
    loop {
        let count = reader
            .read(&mut chunk)
            .await
            .map_err(|_| "Could not read Whisper output.".to_string())?;
        if count == 0 {
            return Ok(output);
        }
        if output.len().saturating_add(count) > MAX_TRANSCRIPT_BYTES {
            return Err("Voice transcription output exceeded the safety limit.".into());
        }
        output.extend_from_slice(&chunk[..count]);
    }
}

pub async fn transcribe_wav(
    binary: &Path,
    model: &Path,
    wav: &Path,
    language: &str,
    mut cancel_rx: watch::Receiver<bool>,
) -> Result<String, String> {
    let mut command = Command::new(binary);
    command
        .args([
            "-m",
            &model.to_string_lossy(),
            "-f",
            &wav.to_string_lossy(),
            "-l",
            normalize_voice_language(language),
            "--no-timestamps",
            "-np",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    {
        use windows_sys::Win32::System::Threading::CREATE_NO_WINDOW;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = command
        .spawn()
        .map_err(|_| "Could not start the local Whisper voice engine.".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or("Whisper output stream is unavailable.")?;
    let stderr = child
        .stderr
        .take()
        .ok_or("Whisper diagnostic stream is unavailable.")?;
    let stdout_task = tokio::spawn(read_bounded(stdout));
    let stderr_task = tokio::spawn(read_bounded(stderr));

    let wait_future = tokio::time::timeout(TRANSCRIBE_TIMEOUT, child.wait());
    let status = tokio::select! {
        _ = wait_for_cancel(&mut cancel_rx) => {
            let _ = child.kill().await;
            stdout_task.abort();
            stderr_task.abort();
            return Err("Voice transcription cancelled.".into());
        }
        res = wait_future => {
            match res {
                Ok(Ok(status)) => status,
                Ok(Err(_)) => {
                    stdout_task.abort();
                    stderr_task.abort();
                    return Err("Local Whisper failed while transcribing.".into());
                }
                Err(_) => {
                    let _ = child.kill().await;
                    stdout_task.abort();
                    stderr_task.abort();
                    return Err("Voice transcription timed out.".into());
                }
            }
        }
    };

    let stdout_bytes = stdout_task
        .await
        .map_err(|_| "Whisper output interrupted.".to_string())??;
    let stderr_bytes = stderr_task
        .await
        .map_err(|_| "Whisper diagnostics interrupted.".to_string())??;
    if !status.success() {
        let detail = String::from_utf8_lossy(&stderr_bytes);
        let first_line = detail
            .lines()
            .find(|line| !line.trim().is_empty())
            .unwrap_or("");
        if first_line.is_empty() {
            return Err("Local Whisper could not transcribe this recording.".into());
        }
        return Err(format!("Whisper error: {}", first_line.trim()));
    }
    let text = String::from_utf8_lossy(&stdout_bytes);
    Ok(clean_whisper_transcript(&text))
}

async fn wait_for_cancel(cancel_rx: &mut watch::Receiver<bool>) {
    if *cancel_rx.borrow() {
        return;
    }
    while cancel_rx.changed().await.is_ok() {
        if *cancel_rx.borrow() {
            return;
        }
    }
    std::future::pending::<()>().await;
}
