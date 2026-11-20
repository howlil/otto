use super::readiness::executable;
use crate::agent::Control;
use crate::agent::providers::{BoundedLineError, read_bounded_line, transport::JsonlProcess};
use serde_json::{Value, json};
use std::{path::Path, time::Duration};
use tokio::{io::AsyncBufRead, sync::mpsc, time::timeout};

pub(super) const MAX_RPC_FRAME_BYTES: usize = 8 * 1024 * 1024;

pub(super) struct Rpc {
    pub(super) process: JsonlProcess,
    next_id: u64,
}

pub(super) fn bounded_line_error(error: BoundedLineError) -> &'static str {
    match error {
        BoundedLineError::TooLarge => "Codex response exceeded the size limit.",
        BoundedLineError::InvalidUtf8 => "Codex returned invalid text.",
        BoundedLineError::Read => "Codex output failed.",
    }
}

pub(super) async fn read_frame<R: AsyncBufRead + Unpin>(
    reader: &mut R,
    idle_timeout: Duration,
) -> Result<Value, String> {
    let line = timeout(idle_timeout, read_bounded_line(reader, MAX_RPC_FRAME_BYTES))
        .await
        .map_err(|_| "Codex did not respond in time.")?
        .map_err(bounded_line_error)?
        .ok_or("Codex process disconnected.")?;
    serde_json::from_str(&line).map_err(|_| "Invalid Codex protocol response.".into())
}

impl Rpc {
    pub(super) fn launch(cwd: &Path) -> Result<Self, String> {
        let binary = executable().ok_or("Codex CLI is not installed.")?;
        #[cfg(windows)]
        let start_error = "Cannot start Codex CLI on Windows.";
        #[cfg(not(windows))]
        let start_error = "Cannot start Codex CLI.";
        let (process, _) = JsonlProcess::launch(
            "Codex",
            &binary,
            ["app-server", "--stdio"],
            cwd,
            false,
            start_error,
        )?;
        Ok(Self {
            process,
            next_id: 0,
        })
    }

    pub(super) async fn send(&mut self, value: Value) -> Result<(), String> {
        let payload = serde_json::to_vec(&value).map_err(|_| "Cannot encode Codex request.")?;
        self.process
            .send_line(payload, "Codex connection closed.")
            .await
    }

    pub(super) async fn read(&mut self) -> Result<Value, String> {
        read_frame(self.process.reader(), Duration::from_secs(45)).await
    }

    pub(super) async fn request(
        &mut self,
        method: &str,
        params: Value,
    ) -> Result<(Value, Vec<Value>), String> {
        self.next_id += 1;
        let id = self.next_id;
        self.send(json!({ "id": id, "method": method, "params": params }))
            .await?;
        let mut notifications = Vec::new();
        loop {
            let value = self.read().await?;
            if value.get("id").and_then(Value::as_u64) == Some(id) && value.get("method").is_none()
            {
                if value.get("error").is_some() {
                    return Err(format!(
                        "Codex rejected {method}. Check installation, login and permissions."
                    ));
                }
                return Ok((
                    value.get("result").cloned().unwrap_or(Value::Null),
                    notifications,
                ));
            }
            if value.get("id").is_some() && value.get("method").is_some() {
                return Err("Codex requested a permission decision that Otto cannot display. Review Codex's native permission settings, then retry.".into());
            }
            if notifications.len() < 2048 {
                notifications.push(value);
            } else {
                return Err("Codex emitted too many pending events.".into());
            }
        }
    }

    pub(super) async fn request_controlled(
        &mut self,
        method: &str,
        params: Value,
        mut controls: Option<&mut mpsc::Receiver<Control>>,
    ) -> Result<Option<(Value, Vec<Value>)>, String> {
        self.next_id += 1;
        let id = self.next_id;
        self.send(json!({ "id": id, "method": method, "params": params }))
            .await?;
        let mut notifications = Vec::new();
        loop {
            let value = if let Some(receiver) = controls.as_deref_mut() {
                let next = tokio::select! {
                    incoming = self.read() => Ok(incoming?),
                    control = receiver.recv() => Err(control),
                };
                match next {
                    Ok(value) => value,
                    Err(control) => match control {
                        Some(Control::Stop) => return Ok(None),
                        Some(Control::Close { .. }) => {
                            return Err("Cannot close Codex while starting a turn.".into());
                        }
                        Some(Control::Ask { .. }) => {
                            return Err("Cannot queue another turn during startup.".into());
                        }
                        Some(Control::PermissionDecision { .. }) => continue,
                        None => {
                            return Err("Codex control channel closed during startup.".into());
                        }
                    },
                }
            } else {
                self.read().await?
            };
            if value.get("id").and_then(Value::as_u64) == Some(id) && value.get("method").is_none()
            {
                if value.get("error").is_some() {
                    return Err(format!(
                        "Codex rejected {method}. Check installation, login and permissions."
                    ));
                }
                return Ok(Some((
                    value.get("result").cloned().unwrap_or(Value::Null),
                    notifications,
                )));
            }
            if value.get("id").is_some() && value.get("method").is_some() {
                return Err("Codex requested a permission decision that Otto cannot display. Review Codex's native permission settings, then retry.".into());
            } else if notifications.len() < 2048 {
                notifications.push(value);
            } else {
                return Err("Codex emitted too many pending events.".into());
            }
        }
    }

    pub(super) async fn terminate(&mut self) {
        self.process.kill_now().await;
    }
}
