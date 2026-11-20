use super::spec::AcpSpec;
use crate::agent::providers::{
    BoundedLineError, authentication_required, read_bounded_line, transport::JsonlProcess,
};
use serde_json::{Value, json};
use std::{
    path::{Path, PathBuf},
    time::Duration,
};
use tokio::{io::AsyncReadExt, time::timeout};

const MAX_ACP_FRAME_BYTES: usize = 8 * 1024 * 1024;
pub(super) const STARTUP_TIMEOUT: Duration = Duration::from_secs(20);
pub(super) const TURN_IDLE_TIMEOUT: Duration = Duration::from_secs(90);

pub(in crate::agent::providers) fn executable(spec: &AcpSpec) -> Option<PathBuf> {
    crate::agent::providers::find_executable(spec.executables)
}

pub(super) struct AcpClient {
    spec: &'static AcpSpec,
    process: JsonlProcess,
    next_id: u64,
    stderr_task: tokio::task::JoinHandle<String>,
}

impl AcpClient {
    pub(super) fn launch(spec: &'static AcpSpec, cwd: &Path) -> Result<Self, String> {
        let name = spec.name;
        let binary = executable(spec).ok_or(format!("{name} CLI was not found in PATH."))?;
        let args: Vec<String> = spec.args.iter().map(|arg| (*arg).to_owned()).collect();
        let env: Vec<(std::ffi::OsString, std::ffi::OsString)> = spec
            .env
            .iter()
            .map(|(key, value)| ((*key).into(), (*value).into()))
            .collect();
        let (process, stderr) = JsonlProcess::launch_env(
            name,
            &binary,
            args,
            cwd,
            true,
            &format!("Cannot start {name} ACP mode."),
            &env,
        )?;
        let mut stderr = stderr.ok_or(format!("{name} stderr unavailable."))?;
        let stderr_task = tokio::spawn(async move {
            let mut captured = Vec::new();
            let mut chunk = [0_u8; 1024];
            loop {
                match stderr.read(&mut chunk).await {
                    Ok(0) | Err(_) => break,
                    Ok(count) => {
                        let remaining = 4096_usize.saturating_sub(captured.len());
                        captured.extend_from_slice(&chunk[..count.min(remaining)]);
                    }
                }
            }
            String::from_utf8_lossy(&captured).into_owned()
        });
        Ok(Self {
            spec,
            process,
            next_id: 0,
            stderr_task,
        })
    }

    pub(super) async fn read_frame(&mut self) -> Result<Value, String> {
        let name = self.spec.name;
        let line = read_bounded_line(self.process.reader(), MAX_ACP_FRAME_BYTES)
            .await
            .map_err(|error| match error {
                BoundedLineError::TooLarge => {
                    format!("{name} message exceeded the supported limit.")
                }
                BoundedLineError::InvalidUtf8 => format!("{name} emitted invalid text."),
                BoundedLineError::Read => format!("{name} stream failed."),
            })?;
        match line {
            Some(text) => {
                serde_json::from_str(&text).map_err(|_| format!("{name} emitted invalid JSON-RPC."))
            }
            None => {
                let diagnostics = timeout(Duration::from_millis(250), &mut self.stderr_task)
                    .await
                    .ok()
                    .and_then(Result::ok);
                Err(disconnect_message(name, diagnostics.as_deref()))
            }
        }
    }

    pub(super) async fn read_turn(&mut self) -> Result<Value, String> {
        timeout(TURN_IDLE_TIMEOUT, self.read_frame())
            .await
            .map_err(|_| format!("{} stopped responding during the answer.", self.spec.name))?
    }

    pub(super) async fn send_request(
        &mut self,
        method: &str,
        params: Value,
    ) -> Result<u64, String> {
        self.next_id += 1;
        let id = self.next_id;
        let payload = serde_json::to_vec(&json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params
        }))
        .map_err(|_| format!("Cannot serialize a {} ACP request.", self.spec.name))?;
        self.process
            .send_line(payload, &format!("{} input disconnected.", self.spec.name))
            .await?;
        Ok(id)
    }

    pub(super) async fn send_notification(
        &mut self,
        method: &str,
        params: Value,
    ) -> Result<(), String> {
        let payload = serde_json::to_vec(&json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params
        }))
        .map_err(|_| format!("Cannot serialize a {} ACP notification.", self.spec.name))?;
        self.process
            .send_line(payload, &format!("{} input disconnected.", self.spec.name))
            .await
    }

    pub(super) async fn send_raw(&mut self, value: &Value) -> Result<(), String> {
        let payload = serde_json::to_vec(value)
            .map_err(|_| format!("Cannot serialize a {} ACP response.", self.spec.name))?;
        self.process
            .send_line(payload, &format!("{} input disconnected.", self.spec.name))
            .await
    }

    pub(super) async fn request(
        &mut self,
        method: &str,
        params: Value,
        duration: Duration,
    ) -> Result<(Value, Option<i64>), String> {
        let id = self.send_request(method, params).await?;
        let name = self.spec.name;
        let mut context_window = None;
        timeout(duration, async {
            loop {
                let frame = self.read_frame().await?;
                if is_incoming_request(&frame) {
                    return Err(permission_message(name));
                }
                if frame["method"] == "session/update" {
                    let update = &frame["params"]["update"];
                    if update["sessionUpdate"] == "usage_update"
                        && let Some(size) = update["size"].as_i64().filter(|value| *value > 0)
                    {
                        context_window = Some(size);
                    }
                    continue;
                }
                if frame["id"] == id {
                    if let Some(error) = frame.get("error") {
                        return Err(rpc_error_message(name, error));
                    }
                    return Ok((frame["result"].clone(), context_window));
                }
            }
        })
        .await
        .map_err(|_| format!("{name} initialization timed out."))?
    }

    pub(super) async fn open_session(
        &mut self,
        cwd: &Path,
    ) -> Result<(Value, Value, Option<i64>), String> {
        let (init_result, _) = self
            .request(
                "initialize",
                json!({ "protocolVersion": 1, "clientCapabilities": {} }),
                STARTUP_TIMEOUT,
            )
            .await?;
        if let Some(method) = self.spec.authenticate {
            self.request(
                "authenticate",
                json!({ "methodId": method }),
                STARTUP_TIMEOUT,
            )
            .await?;
        }
        let (session_result, context_window) = self
            .request(
                "session/new",
                json!({ "cwd": cwd.to_string_lossy() }),
                STARTUP_TIMEOUT,
            )
            .await?;
        Ok((init_result, session_result, context_window))
    }

    pub(super) async fn terminate(&mut self) {
        self.process.terminate_tree().await;
    }
}

pub(super) fn is_incoming_request(frame: &Value) -> bool {
    frame.get("method").is_some_and(Value::is_string) && frame.get("id").is_some()
}

pub(super) fn permission_message(name: &str) -> String {
    format!(
        "{name} requested a provider permission decision that Otto cannot display. Review {name}'s native permission settings, then retry."
    )
}

pub(super) fn rpc_error_message(name: &str, error: &Value) -> String {
    let detail = error["message"]
        .as_str()
        .or_else(|| error.as_str())
        .unwrap_or_default();
    result_failure_message(name, Some(detail))
}

fn disconnect_message(name: &str, error: Option<&str>) -> String {
    let message = result_failure_message(name, error);
    if message == format!("{name} could not finish this request.") {
        format!("{name} disconnected. Check the CLI installation, then Retry.")
    } else {
        message
    }
}

fn result_failure_message(name: &str, error: Option<&str>) -> String {
    let detail = error.unwrap_or_default().to_ascii_lowercase();
    if authentication_required(&detail) {
        format!("{name} authentication expired. Sign in to {name}, then Retry.")
    } else if [
        "rate limit",
        "rate-limit",
        "quota",
        "429",
        "resource exhausted",
    ]
    .iter()
    .any(|signal| detail.contains(signal))
    {
        format!("{name} rate limit or quota reached. Retry later.")
    } else if ["network", "connection", "timed out", "timeout", "dns"]
        .iter()
        .any(|signal| detail.contains(signal))
    {
        format!("{name} could not reach the model service. Check your connection, then Retry.")
    } else if ["model", "not found", "unsupported"]
        .iter()
        .any(|signal| detail.contains(signal))
    {
        format!("Selected {name} model is unavailable. Choose another model, then Retry.")
    } else {
        format!("{name} could not finish this request.")
    }
}
