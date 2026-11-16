use super::authentication_required;
mod admission;

use super::transport::JsonlProcess;
use super::{BoundedLineError, read_bounded_line};
use crate::agent::events::{AgentEvent, ProviderEvents};
#[cfg(test)]
use crate::agent::{CaptureSnapshot, Snapshot};
use crate::agent::{
    CapturedImage, Control, ModelOption, ProviderReadiness, RunPhase, UsageSnapshot,
};
use admission::{safe_initialize, safe_session};
use serde_json::{Value, json};
use std::{
    path::{Path, PathBuf},
    sync::atomic::Ordering,
    time::Duration,
};
#[cfg(test)]
use tokio::sync::watch;
use tokio::{io::AsyncReadExt, sync::mpsc, time::timeout};

const AGENT_NAME: &str = "otto-chat";
const AGENT_DEFINITION: &str = "---\nname: otto-chat\ndescription: Tool-free text answers from Otto.\nmainAgent: true\nsubagent: false\ntools: []\ncommandExecutionPolicy: \"off\"\ninheritMcp: false\ninheritCustomizations: false\n---\nAnswer the user's question without executing tools or modifying any files.\n";
const MAX_ACP_FRAME_BYTES: usize = 8 * 1024 * 1024;
const STARTUP_TIMEOUT: Duration = Duration::from_secs(20);
const TURN_IDLE_TIMEOUT: Duration = Duration::from_secs(90);

pub fn executable() -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        for name in ["agy.exe", "agy.cmd"] {
            let binary = dir.join(name);
            if binary.is_file() {
                return Some(binary);
            }
        }
    }
    None
}

fn agent_file(home: &Path) -> PathBuf {
    home.join(".gemini")
        .join("config")
        .join("agents")
        .join(AGENT_NAME)
        .join("agent.md")
}

fn install_safe_agent(home: &Path) -> Result<(), String> {
    let file = agent_file(home);
    if file.is_file() {
        return match std::fs::read_to_string(&file) {
            Ok(existing) if existing == AGENT_DEFINITION => Ok(()),
            _ => Err(
                "An existing Agy agent profile conflicts with Otto. Resolve it before using Agy."
                    .into(),
            ),
        };
    }
    let parent = file.parent().ok_or("Invalid Agy profile path.")?;
    std::fs::create_dir_all(parent).map_err(|_| "Cannot prepare the Otto Agy profile.")?;
    let temporary = file.with_extension(format!("agent.md.tmp-{}", std::process::id()));
    let result = (|| {
        let mut output = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|_| "Cannot create the Otto Agy profile.".to_string())?;
        use std::io::Write;
        output
            .write_all(AGENT_DEFINITION.as_bytes())
            .and_then(|_| output.sync_all())
            .map_err(|_| "Cannot write the Otto Agy profile.".to_string())?;
        std::fs::rename(&temporary, &file)
            .map_err(|_| "Cannot publish the Otto Agy profile.".to_string())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result
}

fn ensure_profile() -> Result<(), String> {
    let home = std::env::var_os("USERPROFILE").ok_or("Windows user profile is unavailable.")?;
    install_safe_agent(Path::new(&home))
}

fn acp_launch_args() -> Vec<String> {
    [
        "acp",
        "--stdio",
        "--agent",
        AGENT_NAME,
        "--include-default-customizations=false",
    ]
    .into_iter()
    .map(str::to_owned)
    .collect()
}

struct AcpClient {
    process: JsonlProcess,
    next_id: u64,
    stderr_task: tokio::task::JoinHandle<String>,
}

impl AcpClient {
    fn launch(cwd: &Path) -> Result<Self, String> {
        let binary = executable().ok_or("Agy CLI was not found in PATH.")?;
        let args = acp_launch_args();
        let (process, stderr) = JsonlProcess::launch(
            "Agy",
            &binary,
            args,
            cwd,
            true,
            "Cannot start Agy ACP mode.",
        )?;
        let mut stderr = stderr.ok_or("Agy stderr unavailable.")?;
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
            process,
            next_id: 0,
            stderr_task,
        })
    }

    async fn read_frame(&mut self) -> Result<Value, String> {
        let line = read_bounded_line(self.process.reader(), MAX_ACP_FRAME_BYTES)
            .await
            .map_err(|error| match error {
                BoundedLineError::TooLarge => "Agy message exceeded the supported limit.",
                BoundedLineError::InvalidUtf8 => "Agy emitted invalid text.",
                BoundedLineError::Read => "Agy stream failed.",
            })?;
        match line {
            Some(text) => {
                serde_json::from_str(&text).map_err(|_| "Agy emitted invalid JSON-RPC.".into())
            }
            None => {
                let diagnostics = timeout(Duration::from_millis(250), &mut self.stderr_task)
                    .await
                    .ok()
                    .and_then(Result::ok);
                Err(disconnect_message(diagnostics.as_deref()).into())
            }
        }
    }

    async fn read_turn(&mut self) -> Result<Value, String> {
        timeout(TURN_IDLE_TIMEOUT, self.read_frame())
            .await
            .map_err(|_| "Agy stopped responding during the answer.".to_string())?
    }

    async fn send_request(&mut self, method: &str, params: Value) -> Result<u64, String> {
        self.next_id += 1;
        let id = self.next_id;
        let payload = serde_json::to_vec(&json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params
        }))
        .map_err(|_| "Cannot serialize an Agy ACP request.")?;
        self.process
            .send_line(payload, "Agy input disconnected.")
            .await?;
        Ok(id)
    }

    async fn send_notification(&mut self, method: &str, params: Value) -> Result<(), String> {
        let payload = serde_json::to_vec(&json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params
        }))
        .map_err(|_| "Cannot serialize an Agy ACP notification.")?;
        self.process
            .send_line(payload, "Agy input disconnected.")
            .await
    }

    async fn request(
        &mut self,
        method: &str,
        params: Value,
        duration: Duration,
    ) -> Result<(Value, Option<i64>), String> {
        let id = self.send_request(method, params).await?;
        let mut context_window = None;
        timeout(duration, async {
            loop {
                let frame = self.read_frame().await?;
                if is_incoming_request(&frame) {
                    return Err("Agy attempted an unsupported tool permission request.".into());
                }
                if frame["method"] == "session/update" {
                    let update = &frame["params"]["update"];
                    if matches!(
                        update["sessionUpdate"].as_str(),
                        Some("tool_call" | "tool_call_update")
                    ) {
                        return Err("Agy attempted an unsupported tool action.".into());
                    }
                    if update["sessionUpdate"] == "usage_update"
                        && let Some(size) = update["size"].as_i64().filter(|value| *value > 0)
                    {
                        context_window = Some(size);
                    }
                    continue;
                }
                if frame["id"] == id {
                    if let Some(error) = frame.get("error") {
                        return Err(rpc_error_message(error).into());
                    }
                    return Ok((frame["result"].clone(), context_window));
                }
            }
        })
        .await
        .map_err(|_| "Agy initialization timed out.".to_string())?
    }

    async fn terminate(&mut self) {
        self.process.terminate_tree().await;
    }
}

fn is_incoming_request(frame: &Value) -> bool {
    frame.get("method").is_some_and(Value::is_string) && frame.get("id").is_some()
}

fn rpc_error_message(error: &Value) -> &'static str {
    let detail = error["message"]
        .as_str()
        .or_else(|| error.as_str())
        .unwrap_or_default();
    result_failure_message(Some(detail))
}

fn model_catalog(
    session_result: &Value,
    image_input: bool,
    context_window: Option<i64>,
) -> Vec<ModelOption> {
    session_result
        .pointer("/models/availableModels")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|model| {
            let id = model["modelId"]
                .as_str()
                .or_else(|| model["id"].as_str())
                .filter(|value| !value.is_empty())?;
            let display_name = model["name"]
                .as_str()
                .or_else(|| model["label"].as_str())
                .filter(|value| !value.is_empty())
                .unwrap_or(id);
            Some(ModelOption {
                id: id.to_owned(),
                display_name: display_name.to_owned(),
                context_window,
                image_input,
                thinking_efforts: Vec::new(),
                default_thinking_effort: None,
            })
        })
        .collect()
}

fn disconnect_message(error: Option<&str>) -> &'static str {
    match result_failure_message(error) {
        "Agy could not finish this request." => {
            "Agy disconnected. Check the CLI installation, then Retry."
        }
        known => known,
    }
}

fn result_failure_message(error: Option<&str>) -> &'static str {
    let detail = error.unwrap_or_default().to_ascii_lowercase();
    if authentication_required(&detail) {
        "Agy authentication expired. Sign in to Agy, then Retry."
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
        "Agy rate limit or quota reached. Retry later."
    } else {
        "Agy could not finish this request."
    }
}

pub async fn readiness(cwd: &Path, selected_model: Option<&str>) -> ProviderReadiness {
    if executable().is_none() {
        return ProviderReadiness::new(
            "missing",
            "Agy CLI was not found.",
            "Install Agy, then Retry.",
        );
    }
    if let Err(reason) = ensure_profile() {
        return ProviderReadiness::new("unsupported", &reason, "Review Agy setup, then Retry.");
    }
    let Ok(mut client) = AcpClient::launch(cwd) else {
        return ProviderReadiness::new("unavailable", "Agy cannot start.", "Update Agy and Retry.");
    };
    let probe = async {
        let (init_result, _) = client
            .request(
                "initialize",
                json!({ "protocolVersion": 1, "clientCapabilities": {} }),
                STARTUP_TIMEOUT,
            )
            .await?;
        let image_supported = safe_initialize(&init_result)?;
        let (session_result, context_window) = client
            .request(
                "session/new",
                json!({ "cwd": cwd.to_string_lossy(), "mcpServers": [] }),
                STARTUP_TIMEOUT,
            )
            .await?;
        let session_id = safe_session(&session_result)?;
        let models = model_catalog(&session_result, image_supported, context_window);
        if models.is_empty() {
            return Ok::<_, String>(ProviderReadiness::new(
                "unsupported",
                "Agy models could not be confirmed.",
                "Update Agy and choose a text model, then Retry.",
            ));
        }
        if let Some(model) = selected_model
            && !models.iter().any(|candidate| candidate.id == model)
        {
            let mut readiness = ProviderReadiness::new(
                "unsupported",
                "Agy selected model is not available.",
                "Choose a model from the current Agy catalog, then Retry.",
            );
            readiness.models = models;
            return Ok(readiness);
        }
        if let Some(model) = selected_model {
            client
                .request(
                    "session/set_model",
                    json!({ "sessionId": session_id, "modelId": model }),
                    STARTUP_TIMEOUT,
                )
                .await?;
        }
        let default_model = session_result
            .pointer("/models/currentModelId")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty() && models.iter().any(|m| m.id == *value))
            .map(str::to_owned);
        let mut readiness = ProviderReadiness::new(
            "ready",
            "Agy CLI is initialized; model access is verified on the first answer.",
            "",
        );
        readiness.tool_free_admission = true;
        readiness.image_input = image_supported;
        readiness.model = selected_model
            .map(str::to_owned)
            .or(default_model)
            .or_else(|| models.first().map(|model| model.id.clone()));
        readiness.models = models;
        Ok(readiness)
    }
    .await;
    client.terminate().await;
    match probe {
        Ok(readiness) => readiness,
        Err(reason) if reason.starts_with("Agy authentication expired.") => ProviderReadiness::new(
            "authRequired",
            "Agy needs authentication.",
            "Sign in to Agy, then Retry.",
        ),
        Err(reason) if reason.starts_with("Agy disconnected.") || reason.contains("timed out") => {
            ProviderReadiness::new("unavailable", &reason, "Check Agy and Retry.")
        }
        Err(reason) => ProviderReadiness::new(
            "unsupported",
            &reason,
            "Use Codex or Pi if Agy ACP cannot start; updating Agy may restore compatibility.",
        ),
    }
}

fn usage_snapshot(
    usage: &Value,
    context_tokens: Option<i64>,
    model_context_window: Option<i64>,
) -> Option<UsageSnapshot> {
    let tokens = |name: &str| usage[name].as_i64().filter(|count| *count >= 0);
    Some(UsageSnapshot {
        context_tokens,
        session_tokens: tokens("totalTokens")?,
        input_tokens: tokens("inputTokens")?,
        cached_input_tokens: tokens("cachedReadTokens").unwrap_or(0),
        output_tokens: tokens("outputTokens")?,
        reasoning_output_tokens: tokens("thoughtTokens"),
        model_context_window,
    })
}

async fn prompt_params(
    session_id: &str,
    text: &str,
    capture: Option<&CapturedImage>,
) -> Result<Value, String> {
    let mut blocks = vec![json!({ "type": "text", "text": text })];
    if let Some(image) = capture {
        let path = image.path().to_owned();
        let encoded = tokio::task::spawn_blocking(move || super::encode_png_capture(&path))
            .await
            .map_err(|_| "Image preparation was interrupted.".to_string())??;
        blocks.push(json!({
            "type": "image",
            "data": encoded,
            "mimeType": "image/png"
        }));
    }
    Ok(json!({
        "sessionId": session_id,
        "prompt": blocks
    }))
}

fn begin(events: &ProviderEvents, id: u64, display_text: &str) {
    events.emit(AgentEvent::TurnStarted {
        run_id: id,
        text: display_text.to_owned(),
    });
}

struct TurnState<'a> {
    run_id: u64,
    prompt_id: u64,
    display_text: &'a str,
    acknowledged: bool,
    accumulated: String,
    context_tokens: Option<i64>,
    model_context_window: Option<i64>,
}

impl<'a> TurnState<'a> {
    fn new(
        run_id: u64,
        prompt_id: u64,
        display_text: &'a str,
        model_context_window: Option<i64>,
    ) -> Self {
        Self {
            run_id,
            prompt_id,
            display_text,
            acknowledged: false,
            accumulated: String::new(),
            context_tokens: None,
            model_context_window,
        }
    }

    fn ensure_started(&mut self, events: &ProviderEvents) {
        if !self.acknowledged {
            self.acknowledged = true;
            begin(events, self.run_id, self.display_text);
        }
    }
}

fn observe_acp(frame: &Value, turn: &mut TurnState<'_>, events: &ProviderEvents) -> bool {
    let snapshot = events.snapshot();
    if snapshot.run_id != turn.run_id
        || !matches!(snapshot.status, RunPhase::Starting | RunPhase::Streaming)
    {
        return false;
    }
    if is_incoming_request(frame) {
        events.fail(
            turn.run_id,
            "Agy attempted an unsupported tool permission request.",
        );
        return true;
    }
    if frame["method"] == "session/update" {
        let update = &frame["params"]["update"];
        match update["sessionUpdate"].as_str() {
            Some("usage_update") => {
                if let Some(used) = update["used"].as_i64().filter(|count| *count >= 0) {
                    turn.context_tokens = Some(used);
                }
                if let Some(size) = update["size"].as_i64().filter(|count| *count > 0) {
                    turn.model_context_window = Some(size);
                }
            }
            Some("user_message_chunk") => {
                turn.ensure_started(events);
            }
            Some("agent_message_chunk") => {
                if update["content"]["type"] == "text"
                    && let Some(delta) = update["content"]["text"].as_str()
                {
                    turn.ensure_started(events);
                    turn.accumulated.push_str(delta);
                    events.emit(AgentEvent::TextDelta {
                        run_id: turn.run_id,
                        delta: delta.to_owned(),
                    });
                }
            }
            Some("tool_call" | "tool_call_update") => {
                events.fail(turn.run_id, "Agy attempted an unsupported tool action.");
                return true;
            }
            _ => {}
        }
        return false;
    }
    if frame["id"] == turn.prompt_id {
        if let Some(error) = frame.get("error") {
            events.fail(turn.run_id, rpc_error_message(error));
            return true;
        }
        let result = &frame["result"];
        if result["stopReason"] == "cancelled" {
            events.stopped(turn.run_id);
            return true;
        }
        if turn.accumulated.trim().is_empty() {
            events.fail(turn.run_id, "Agy returned an empty answer.");
            return true;
        }
        turn.ensure_started(events);
        if let Some(usage) = usage_snapshot(
            &result["usage"],
            turn.context_tokens,
            turn.model_context_window,
        ) {
            events.emit(AgentEvent::UsageUpdated {
                run_id: turn.run_id,
                usage,
            });
        }
        events.emit(AgentEvent::TextFinal {
            run_id: turn.run_id,
            text: std::mem::take(&mut turn.accumulated),
        });
        events.emit(AgentEvent::Completed {
            run_id: turn.run_id,
        });
        return true;
    }
    false
}

pub async fn run(mut controls: mpsc::Receiver<Control>, events: ProviderEvents, initial: Control) {
    let Control::Ask {
        text,
        display_text,
        cwd,
        run_id,
        model,
        capture,
        ..
    } = initial
    else {
        return;
    };
    if let Err(reason) = ensure_profile() {
        events.fail(run_id, &reason);
        return;
    }
    let mut client = match AcpClient::launch(&cwd) {
        Ok(value) => value,
        Err(reason) => {
            events.fail(run_id, &reason);
            return;
        }
    };
    let startup = tokio::select! {
        result = async {
            let (init_result, _) = client
                .request(
                    "initialize",
                    json!({ "protocolVersion": 1, "clientCapabilities": {} }),
                    STARTUP_TIMEOUT,
                )
                .await?;
            let image_supported = safe_initialize(&init_result)?;
            if capture.is_some() && !image_supported {
                return Err("Agy ACP runtime does not support image input.".into());
            }
            let (session_result, context_window) = client
                .request(
                    "session/new",
                    json!({ "cwd": cwd.to_string_lossy(), "mcpServers": [] }),
                    STARTUP_TIMEOUT,
                )
                .await?;
            let session_id = safe_session(&session_result)?;
            if let Some(model) = model.as_deref().filter(|value| !value.is_empty()) {
                client
                    .request(
                        "session/set_model",
                        json!({ "sessionId": session_id, "modelId": model }),
                        STARTUP_TIMEOUT,
                    )
                    .await?;
            }
            Ok::<_, String>((session_id, image_supported, context_window))
        } => result,
        action = controls.recv() => {
            if matches!(action, Some(Control::Stop)) {
                events.stopped(run_id);
            } else {
                events.fail(run_id, "Agy startup interrupted.");
            }
            client.terminate().await;
            return;
        }
    };
    let (session_id, image_supported, known_context_window) = match startup {
        Ok(value) => value,
        Err(reason) => {
            events.fail(run_id, &reason);
            client.terminate().await;
            return;
        }
    };
    events.emit(AgentEvent::SessionReady {
        run_id,
        session_id: session_id.clone(),
    });
    let prompt = match prompt_params(&session_id, &text, capture.as_ref()).await {
        Ok(params) => params,
        Err(reason) => {
            events.fail(run_id, &reason);
            client.terminate().await;
            return;
        }
    };
    let prompt_id = match client.send_request("session/prompt", prompt).await {
        Ok(id) => id,
        Err(reason) => {
            events.fail(run_id, &reason);
            client.terminate().await;
            return;
        }
    };
    let mut active_display = display_text;
    let mut active_turn = Some(TurnState::new(
        run_id,
        prompt_id,
        &active_display,
        known_context_window,
    ));
    loop {
        tokio::select! {
            action = controls.recv() => match action {
                Some(Control::Stop) if active_turn.is_some() => {
                    if let Some(turn) = active_turn.take() {
                        let _ = client
                            .send_notification("session/cancel", json!({ "sessionId": session_id }))
                            .await;
                        events.stopped(turn.run_id);
                    }
                    client.terminate().await;
                    break;
                }
                Some(Control::Close { claimed, finished }) => {
                    if finished.is_closed() || claimed.swap(true, Ordering::SeqCst) { continue; }
                    client.terminate().await;
                    let _ = finished.send(());
                    break;
                }
                Some(Control::Ask { text, display_text, cwd, run_id, capture, .. }) if active_turn.is_none() => {
                    if cwd.as_path() != Path::new(&events.snapshot().cwd) {
                        events.fail(run_id, "Agy context changed. Start a new session.");
                        continue;
                    }
                    if capture.is_some() && !image_supported {
                        events.fail(run_id, "Agy ACP runtime does not support image input.");
                        continue;
                    }
                    let next_prompt = match prompt_params(&session_id, &text, capture.as_ref()).await {
                        Ok(params) => params,
                        Err(reason) => {
                            events.fail(run_id, &reason);
                            continue;
                        }
                    };
                    let next_id = match client.send_request("session/prompt", next_prompt).await {
                        Ok(id) => id,
                        Err(_) => {
                            events.fail(run_id, "Agy follow-up could not start.");
                            client.terminate().await;
                            break;
                        }
                    };
                    active_display = display_text;
                    active_turn = Some(TurnState::new(run_id, next_id, &active_display, known_context_window));
                }
                None => { client.terminate().await; break; }
                _ => {}
            },
            frame = client.read_turn() => match frame {
                Ok(value) => {
                    let Some(turn) = active_turn.as_mut() else { continue; };
                    if observe_acp(&value, turn, &events) {
                        if events.snapshot().status == RunPhase::Failed {
                            client.terminate().await;
                            break;
                        }
                        active_turn = None;
                    }
                }
                Err(reason) => {
                    if let Some(turn) = active_turn.take() {
                        events.fail(turn.run_id, &reason);
                    }
                    client.terminate().await;
                    break;
                }
            }
        }
    }
    let snapshot = events.snapshot();
    if matches!(snapshot.status, RunPhase::Starting | RunPhase::Streaming) {
        events.fail(snapshot.run_id, "Agy terminated before completion.");
    } else if snapshot.status == RunPhase::Stopping {
        events.stopped(snapshot.run_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore = "requires installed Agy; reports capability names only"]
    async fn installed_agy_admission_matches_the_real_cli() {
        ensure_profile().unwrap();
        let mut client = AcpClient::launch(&std::env::temp_dir()).unwrap();
        let (init_result, _) = client
            .request(
                "initialize",
                json!({ "protocolVersion": 1, "clientCapabilities": {} }),
                STARTUP_TIMEOUT,
            )
            .await
            .unwrap();
        let image_supported = safe_initialize(&init_result).unwrap();
        let (session_result, context_window) = client
            .request(
                "session/new",
                json!({ "cwd": std::env::temp_dir().to_string_lossy(), "mcpServers": [] }),
                STARTUP_TIMEOUT,
            )
            .await
            .unwrap();
        let session_id = safe_session(&session_result).unwrap();
        client.terminate().await;
        let models = model_catalog(&session_result, image_supported, context_window);
        println!(
            "Agy ACP session: {session_id}; image: {image_supported}; models: {}",
            models.len()
        );
        assert!(!models.is_empty());
    }

    #[test]
    fn profile_is_tool_free_and_existing_config_is_not_overwritten() {
        let root = std::env::temp_dir().join(format!(
            "otto-agy-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        install_safe_agent(&root).unwrap();
        assert_eq!(
            std::fs::read_to_string(agent_file(&root)).unwrap(),
            AGENT_DEFINITION
        );
        std::fs::write(agent_file(&root), "different config").unwrap();
        assert!(install_safe_agent(&root).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn acp_launch_args_isolate_agent_profile() {
        let args = acp_launch_args();
        assert_eq!(
            args,
            vec![
                "acp",
                "--stdio",
                "--agent",
                AGENT_NAME,
                "--include-default-customizations=false",
            ]
        );
    }

    #[test]
    fn acp_model_catalog_maps_models_and_image_capability() {
        let models = model_catalog(
            &json!({
                "models": {
                    "currentModelId": "gemini-4-argon-medium",
                    "availableModels": [
                        { "modelId": "gemini-4-argon-medium", "name": "Gemini 4 Argon (Medium)" },
                        { "modelId": "gemini-3.8-flash-low", "name": "Gemini 3.8 Flash (Low)" },
                        { "modelId": "" }
                    ]
                }
            }),
            true,
            Some(1_048_576),
        );
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].id, "gemini-4-argon-medium");
        assert_eq!(models[0].display_name, "Gemini 4 Argon (Medium)");
        assert!(models[0].image_input);
        assert_eq!(models[0].context_window, Some(1_048_576));
    }

    #[tokio::test]
    async fn acp_prompt_params_encode_png_capture_as_image_block() {
        let path =
            std::env::temp_dir().join(format!("otto-agy-capture-{}.png", std::process::id()));
        let mut encoder = png::Encoder::new(std::fs::File::create(&path).unwrap(), 1, 1);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().unwrap();
        writer.write_image_data(&[255, 0, 0, 255]).unwrap();
        drop(writer);

        let capture = CapturedImage::new(path.clone());
        let params = prompt_params("session-1", "Describe this", Some(&capture))
            .await
            .unwrap();
        let _ = std::fs::remove_file(&path);
        assert_eq!(params["sessionId"], "session-1");
        assert_eq!(params["prompt"][0]["type"], "text");
        assert_eq!(params["prompt"][0]["text"], "Describe this");
        assert_eq!(params["prompt"][1]["type"], "image");
        assert_eq!(params["prompt"][1]["mimeType"], "image/png");
        assert!(!params["prompt"][1]["data"].as_str().unwrap().is_empty());
    }

    #[test]
    fn acp_observer_streams_text_tracks_usage_and_rejects_tools() {
        let (tx, _) = watch::channel(Snapshot {
            run_id: 8,
            seq: 0,
            status: "starting".into(),
            provider: "agy".into(),
            cwd: String::new(),
            conversation_id: String::new(),
            thread_id: None,
            model: None,
            thinking_effort: None,
            usage: None,
            messages: vec![],
            capture: CaptureSnapshot::default(),
            error: None,
        });
        let events = ProviderEvents::new(tx.clone());
        let mut turn = TurnState::new(8, 3, "Hello", Some(1_048_576));

        assert!(!observe_acp(
            &json!({
                "jsonrpc": "2.0",
                "method": "session/update",
                "params": {
                    "update": {
                        "sessionUpdate": "usage_update",
                        "used": 6767,
                        "size": 1_048_576
                    }
                }
            }),
            &mut turn,
            &events
        ));
        assert!(!observe_acp(
            &json!({
                "jsonrpc": "2.0",
                "method": "session/update",
                "params": {
                    "update": {
                        "sessionUpdate": "user_message_chunk",
                        "content": { "type": "text", "text": "Hello" }
                    }
                }
            }),
            &mut turn,
            &events
        ));
        assert!(!observe_acp(
            &json!({
                "jsonrpc": "2.0",
                "method": "session/update",
                "params": {
                    "update": {
                        "sessionUpdate": "agent_message_chunk",
                        "content": { "type": "text", "text": "Red" }
                    }
                }
            }),
            &mut turn,
            &events
        ));
        assert!(observe_acp(
            &json!({
                "jsonrpc": "2.0",
                "id": 3,
                "result": {
                    "stopReason": "end_turn",
                    "usage": {
                        "inputTokens": 6762,
                        "outputTokens": 5,
                        "cachedReadTokens": 100,
                        "thoughtTokens": 2,
                        "totalTokens": 6767
                    }
                }
            }),
            &mut turn,
            &events
        ));
        let snap = tx.borrow();
        assert_eq!(snap.status, "completed");
        assert_eq!(snap.messages.last().unwrap().text, "Red");
        let usage = snap.usage.as_ref().unwrap();
        assert_eq!(usage.session_tokens, 6767);
        assert_eq!(usage.context_tokens, Some(6767));
        assert_eq!(usage.model_context_window, Some(1_048_576));

        let (tool_tx, _) = watch::channel(Snapshot {
            run_id: 9,
            seq: 0,
            status: "streaming".into(),
            provider: "agy".into(),
            cwd: String::new(),
            conversation_id: String::new(),
            thread_id: None,
            model: None,
            thinking_effort: None,
            usage: None,
            messages: vec![],
            capture: CaptureSnapshot::default(),
            error: None,
        });
        let tool_events = ProviderEvents::new(tool_tx.clone());
        let mut tool_turn = TurnState::new(9, 4, "Run", None);
        assert!(observe_acp(
            &json!({
                "jsonrpc": "2.0",
                "method": "session/update",
                "params": { "update": { "sessionUpdate": "tool_call", "title": "run_command" } }
            }),
            &mut tool_turn,
            &tool_events
        ));
        assert_eq!(tool_tx.borrow().status, "failed");

        let (perm_tx, _) = watch::channel(Snapshot {
            run_id: 10,
            seq: 0,
            status: "streaming".into(),
            provider: "agy".into(),
            cwd: String::new(),
            conversation_id: String::new(),
            thread_id: None,
            model: None,
            thinking_effort: None,
            usage: None,
            messages: vec![],
            capture: CaptureSnapshot::default(),
            error: None,
        });
        let perm_events = ProviderEvents::new(perm_tx.clone());
        let mut perm_turn = TurnState::new(10, 5, "Perm", None);
        assert!(observe_acp(
            &json!({
                "jsonrpc": "2.0",
                "id": 99,
                "method": "session/request_permission",
                "params": {}
            }),
            &mut perm_turn,
            &perm_events
        ));
        assert_eq!(perm_tx.borrow().status, "failed");
    }
}
