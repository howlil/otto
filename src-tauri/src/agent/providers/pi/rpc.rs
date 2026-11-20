use super::readiness::executable;
use crate::agent::providers::{BoundedLineError, read_bounded_line, transport::JsonlProcess};
use serde_json::{Value, json};
use std::{path::Path, time::Duration};
use tokio::time::timeout;

pub(super) const MAX_RPC_MESSAGE_BYTES: usize = 8 * 1024 * 1024;
pub(super) const STARTUP_REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
pub(super) const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
pub(super) const TURN_IDLE_TIMEOUT: Duration = Duration::from_secs(90);

pub(super) fn launch_args() -> &'static [&'static str] {
    &["--mode", "rpc"]
}

pub(super) fn request_timeout(started: bool) -> Duration {
    if started {
        REQUEST_TIMEOUT
    } else {
        STARTUP_REQUEST_TIMEOUT
    }
}

pub(super) struct Rpc {
    process: JsonlProcess,
    next_id: u64,
    started: bool,
}

impl Rpc {
    pub(super) fn launch(cwd: &Path) -> Result<Self, String> {
        let binary = executable().ok_or("Pi CLI was not found in PATH.")?;
        let (process, _) = JsonlProcess::launch(
            "Pi",
            &binary,
            launch_args(),
            cwd,
            false,
            "Cannot start Pi RPC mode.",
        )?;
        Ok(Self {
            process,
            next_id: 0,
            started: false,
        })
    }

    pub(super) async fn send(&mut self, value: Value) -> Result<(), String> {
        let payload = serde_json::to_vec(&value).map_err(|_| "Invalid Pi request.")?;
        self.process.send_line(payload, "Pi disconnected.").await
    }

    pub(super) async fn read(&mut self) -> Result<Value, String> {
        let line = read_bounded_line(self.process.reader(), MAX_RPC_MESSAGE_BYTES)
            .await
            .map_err(|error| match error {
                BoundedLineError::TooLarge => "Pi RPC message too large.",
                BoundedLineError::InvalidUtf8 => "Pi returned invalid text.",
                BoundedLineError::Read => "Pi stream failed.",
            })?
            .ok_or("Pi disconnected.")?;
        serde_json::from_str(&line).map_err(|_| "Pi returned invalid RPC data.".into())
    }

    pub(super) async fn read_turn(&mut self) -> Result<Value, String> {
        timeout(TURN_IDLE_TIMEOUT, self.read())
            .await
            .map_err(|_| "Pi stopped responding during the answer.".to_string())?
    }

    pub(super) async fn request(&mut self, mut command: Value) -> Result<Value, String> {
        self.next_id += 1;
        let id = format!("otto-pi-{}", self.next_id);
        let kind = command["type"]
            .as_str()
            .ok_or("Invalid Pi command.")?
            .to_owned();
        command["id"] = json!(id);
        self.send(command).await?;
        let response = timeout(request_timeout(self.started), async {
            loop {
                let frame = self.read().await?;
                if protocol_parse_error(&frame) {
                    return Err("Pi rejected malformed RPC data.".into());
                }
                if frame["type"] == "response" && frame["id"] == id {
                    if frame["command"] != kind || frame["success"] != true {
                        return Err(format!("Pi rejected {kind}."));
                    }
                    return Ok(frame["data"].clone());
                }
            }
        })
        .await
        .map_err(|_| format!("Pi {kind} timed out."))??;
        self.started = true;
        Ok(response)
    }

    pub(super) async fn state(&mut self) -> Result<Value, String> {
        self.request(json!({"type":"get_state"})).await
    }

    pub(super) async fn configure(
        &mut self,
        selected: Option<&str>,
        thinking: Option<&str>,
    ) -> Result<(String, Option<String>, bool, String), String> {
        if let Some(selected) = selected {
            let models =
                available_models(&self.request(json!({"type":"get_available_models"})).await?)?;
            let model = models
                .iter()
                .find(|model| model_key(model).as_deref() == Some(selected))
                .ok_or("Selected Pi model is not available in the current Pi configuration.")?;
            let current = self.state().await?;
            if model_identity(&current).as_deref() != Some(selected) {
                self.request(json!({
                    "type":"set_model",
                    "provider":model["provider"],
                    "modelId":model["id"]
                }))
                .await?;
            }
        }
        let levels = thinking_levels(
            &self
                .request(json!({"type":"get_available_thinking_levels"}))
                .await?,
        )?;
        if let Some(thinking) = thinking {
            if !levels.iter().any(|level| level == thinking) {
                return Err("Selected thinking level is not supported by this Pi model.".into());
            }
            self.request(json!({"type":"set_thinking_level","level":thinking}))
                .await?;
        }
        let state = self.state().await?;
        let model = model_identity(&state).ok_or("Pi has no active text model.")?;
        if selected.is_some_and(|selected| selected != model.as_str()) {
            return Err("Pi did not apply the requested model.".into());
        }
        if thinking.is_some_and(|value| state["thinkingLevel"].as_str() != Some(value)) {
            return Err("Pi did not apply the requested thinking level.".into());
        }
        let session = state["sessionId"]
            .as_str()
            .filter(|id| !id.is_empty())
            .ok_or("Pi did not provide a session ID.")?
            .to_owned();
        Ok((
            model,
            state["thinkingLevel"].as_str().map(str::to_owned),
            model_accepts_images(&state),
            session,
        ))
    }

    pub(super) async fn terminate(&mut self) {
        self.process.terminate_tree().await;
    }
}

pub(super) fn protocol_parse_error(frame: &Value) -> bool {
    frame["type"] == "response" && frame["command"] == "parse" && frame["success"] == false
}

pub(super) fn model_key(model: &Value) -> Option<String> {
    let provider = model["provider"]
        .as_str()
        .filter(|value| !value.is_empty())?;
    let id = model["id"].as_str().filter(|value| !value.is_empty())?;
    if !model["input"].as_array()?.iter().any(|part| part == "text") {
        return None;
    }
    Some(format!("{provider}/{id}"))
}

pub(super) fn model_identity(state: &Value) -> Option<String> {
    model_key(&state["model"])
}

pub(super) fn model_accepts_images(state: &Value) -> bool {
    state["model"]["input"]
        .as_array()
        .is_some_and(|inputs| inputs.iter().any(|part| part == "image"))
}

pub(super) fn available_models(data: &Value) -> Result<Vec<Value>, String> {
    let models = data["models"]
        .as_array()
        .ok_or("Pi model catalog has an invalid format.")?;
    let usable = models
        .iter()
        .filter(|model| model_key(model).is_some())
        .cloned()
        .collect::<Vec<_>>();
    if usable.is_empty() {
        return Err("Pi does not expose a text model in its current configuration.".into());
    }
    Ok(usable)
}

fn valid_thinking_level(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 32
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_".contains(&byte))
}

pub(super) fn thinking_levels(data: &Value) -> Result<Vec<String>, String> {
    let levels = data["levels"]
        .as_array()
        .ok_or("Pi thinking levels are unavailable.")?;
    let mut result = Vec::new();
    for entry in levels {
        let level = entry
            .as_str()
            .filter(|value| valid_thinking_level(value))
            .ok_or("Pi returned an invalid thinking level.")?;
        if !result.iter().any(|existing| existing == level) {
            result.push(level.to_owned());
        }
    }
    Ok(result)
}
