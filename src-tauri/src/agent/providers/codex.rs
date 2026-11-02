use super::{BoundedLineError, read_bounded_line};
#[cfg(test)]
use crate::agent::ChatMessage;
use crate::agent::events::{AgentEvent, ProviderEvents};
use crate::agent::policy;
use crate::agent::providers::registry::ProviderId;
use crate::agent::{
    CaptureSnapshot, Control, ModelOption, ProviderReadiness, RunPhase, Snapshot, UsageSnapshot,
};
use serde_json::{Value, json};
use std::{path::PathBuf, process::Stdio, sync::atomic::Ordering, time::Duration};
use tokio::{
    io::{AsyncBufRead, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, ChildStdout, Command},
    sync::{mpsc, watch},
    time::timeout,
};

const MAX_RPC_FRAME_BYTES: usize = 8 * 1024 * 1024;

pub fn executable() -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        for name in ["codex.exe", "codex.cmd"] {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

fn account_readiness(value: &Value) -> ProviderReadiness {
    let account = &value["account"];
    if account.is_null() {
        return if value["requiresOpenaiAuth"] == true {
            ProviderReadiness::new(
                "authRequired",
                "Codex needs sign-in.",
                "Run codex login, then Retry.",
            )
        } else if value["requiresOpenaiAuth"] == false {
            ProviderReadiness::new("ready", "Codex does not require OpenAI sign-in.", "")
        } else {
            ProviderReadiness::new(
                "unsupported",
                "Codex did not report whether authentication is required.",
                "Update Codex or check its provider configuration, then Retry.",
            )
        };
    }
    match account["type"].as_str() {
        Some("chatgpt" | "apiKey" | "apikey" | "amazonBedrock" | "gcp") => {
            ProviderReadiness::new("ready", "Codex account is configured.", "")
        }
        _ => ProviderReadiness::new(
            "unsupported",
            "Codex returned an unrecognized account type.",
            "Update Codex, then Retry.",
        ),
    }
}

fn model_id(value: &Value) -> Option<&str> {
    value["model"]
        .as_str()
        .or_else(|| value["id"].as_str())
        .filter(|value| !value.trim().is_empty())
}

fn reasoning_efforts(value: &Value) -> Vec<String> {
    value["supportedReasoningEfforts"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|effort| {
            effort["reasoningEffort"]
                .as_str()
                .or_else(|| effort.as_str())
        })
        .map(str::to_owned)
        .collect()
}

fn model_option(value: &Value) -> Option<ModelOption> {
    let id = model_id(value)?.to_owned();
    let thinking_efforts = reasoning_efforts(value);
    Some(ModelOption {
        id,
        display_name: value["displayName"]
            .as_str()
            .filter(|name| !name.trim().is_empty())
            .unwrap_or_else(|| model_id(value).unwrap_or("Unknown model"))
            .to_owned(),
        context_window: value["contextWindow"].as_i64(),
        image_input: value["inputModalities"]
            .as_array()
            .is_some_and(|items| items.iter().any(|item| item == "image")),
        default_thinking_effort: value["defaultReasoningEffort"].as_str().map(str::to_owned),
        thinking_efforts,
    })
}

fn model_readiness(value: &Value, configured: Option<&str>) -> ProviderReadiness {
    let Some(models) = value["data"].as_array() else {
        return ProviderReadiness::new(
            "unsupported",
            "Codex model catalog is unavailable.",
            "Update Codex, then Retry.",
        );
    };
    let catalog = models;
    let models = catalog.iter().filter_map(model_option).collect::<Vec<_>>();
    let selected = configured.filter(|name| !name.is_empty());
    let model = if let Some(name) = selected {
        catalog.iter().find(|m| model_id(m) == Some(name))
    } else {
        catalog
            .iter()
            .find(|m| m["isDefault"] == true && m["hidden"] != true)
    };
    let Some(model) = model else {
        return ProviderReadiness::new(
            "unsupported",
            "Codex could not verify the configured model.",
            "Choose a model available to this Codex account, then Retry.",
        );
    };
    let modalities = match model.get("inputModalities") {
        None => None,
        Some(Value::Array(items)) => Some(items),
        _ => {
            return ProviderReadiness::new(
                "unsupported",
                "Codex returned invalid model input capabilities.",
                "Update Codex, then Retry.",
            );
        }
    };

    let text = modalities.is_none_or(|items| items.iter().any(|v| v == "text"));
    if !text {
        return ProviderReadiness::new(
            "unsupported",
            "Codex's default model does not support text.",
            "Select a text-capable Codex model, then Retry.",
        );
    }
    let selected_option = model_option(model);
    let mut ready = ProviderReadiness::new("ready", "Codex is ready for text requests.", "");
    ready.image_input = modalities.is_some_and(|items| items.iter().any(|v| v == "image"));
    ready.model = model_id(model).map(str::to_owned);
    ready.models = models;
    ready.thinking_effort = selected_option
        .as_ref()
        .and_then(|option| option.default_thinking_effort.clone());
    ready.thinking_efforts = selected_option
        .map(|option| option.thinking_efforts)
        .unwrap_or_default();
    ready
}

fn configured_model(value: &Value) -> Result<Option<&str>, Box<ProviderReadiness>> {
    let Some(config) = value.get("config").and_then(Value::as_object) else {
        return Err(Box::new(ProviderReadiness::new(
            "unsupported",
            "Codex did not return effective model configuration.",
            "Update Codex and Retry.",
        )));
    };
    match config.get("model") {
        Some(Value::Null) => Ok(None),
        Some(Value::String(name)) if !name.trim().is_empty() => Ok(Some(name.as_str())),
        _ => Err(Box::new(ProviderReadiness::new(
            "unsupported",
            "Codex returned an invalid model configuration.",
            "Inspect your Codex model setting, then Retry.",
        ))),
    }
}

pub async fn readiness(cwd: &PathBuf) -> ProviderReadiness {
    if executable().is_none() {
        return ProviderReadiness::new(
            "missing",
            "Codex CLI was not found in PATH.",
            "Install Codex CLI, then Retry.",
        );
    }
    let Ok(mut rpc) = Rpc::launch(cwd) else {
        return ProviderReadiness::new(
            "unavailable",
            "Codex App Server could not start.",
            "Check your Codex installation, then Retry.",
        );
    };
    let result = timeout(Duration::from_secs(12), async {
        let (_updates, _) = watch::channel(Snapshot {
            run_id: 0,
            seq: 0,
            status: RunPhase::Idle,
            provider: ProviderId::Codex,
            cwd: String::new(),
            conversation_id: String::new(),
            thread_id: None,
            model: None,
            thinking_effort: None,
            usage: None,
            messages: Vec::new(),
            capture: CaptureSnapshot::default(),
            error: None,
        });
        rpc.request(
            "initialize",
            json!({ "clientInfo": { "name": "otto", "title": "Otto", "version": "0.1.0" } }),
        )
        .await?;
        rpc.send(json!({ "method": "initialized", "params": {} }))
            .await?;
        let (account, _) = rpc
            .request("account/read", json!({ "refreshToken": true }))
            .await?;
        let authentication = account_readiness(&account);
        if authentication.status != "ready" {
            return Ok::<ProviderReadiness, String>(authentication);
        }

        let (config, _) = rpc
            .request(
                "config/read",
                json!({ "cwd": cwd.to_string_lossy(), "includeLayers": false }),
            )
            .await?;
        let selected = match configured_model(&config) {
            Ok(model) => model,
            Err(status) => return Ok(*status),
        };
        let (models, _) = rpc
            .request("model/list", json!({ "limit": 100, "includeHidden": true }))
            .await?;
        Ok(model_readiness(&models, selected))
    })
    .await;
    rpc.terminate().await;
    match result {
        Ok(Ok(readiness)) => readiness,
        Ok(Err(_)) => ProviderReadiness::new(
            "unavailable",
            "Codex could not verify authentication or model capabilities.",
            "Check Codex sign-in and connectivity, then Retry.",
        ),
        Err(_) => ProviderReadiness::new(
            "unavailable",
            "Codex readiness check timed out.",
            "Retry after checking your Codex connection.",
        ),
    }
}

struct Rpc {
    #[cfg(windows)]
    job: super::job::Job,
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    next_id: u64,
}

fn bounded_line_error(error: BoundedLineError) -> &'static str {
    match error {
        BoundedLineError::TooLarge => "Codex response exceeded the size limit.",
        BoundedLineError::InvalidUtf8 => "Codex returned invalid text.",
        BoundedLineError::Read => "Codex output failed.",
    }
}

async fn read_frame<R: AsyncBufRead + Unpin>(
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
    fn launch(cwd: &PathBuf) -> Result<Self, String> {
        let binary = executable().ok_or("Codex CLI is not installed.")?;
        let mut cmd = Command::new(binary);
        cmd.args(["app-server", "--stdio"])
            .current_dir(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        #[cfg(windows)]
        let (mut child, job) = super::job::Job::spawn(cmd)
            .map_err(|_| "Cannot start isolated Codex CLI on Windows.")?;
        #[cfg(not(windows))]
        let mut child = cmd.spawn().map_err(|_| "Cannot start Codex CLI.")?;
        let stdin = child.stdin.take().ok_or("Codex stdin unavailable.")?;
        let stdout = child.stdout.take().ok_or("Codex stdout unavailable.")?;
        Ok(Self {
            #[cfg(windows)]
            job,
            child,
            stdin,
            stdout: BufReader::new(stdout),
            next_id: 0,
        })
    }

    async fn send(&mut self, value: Value) -> Result<(), String> {
        let mut json = serde_json::to_vec(&value).map_err(|_| "Cannot encode Codex request.")?;
        json.push(b'\n');
        self.stdin
            .write_all(&json)
            .await
            .map_err(|_| "Codex connection closed.")?;
        self.stdin
            .flush()
            .await
            .map_err(|_| "Codex connection closed.".to_string())
    }

    async fn read(&mut self) -> Result<Value, String> {
        read_frame(&mut self.stdout, Duration::from_secs(45)).await
    }

    async fn request(
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
                return Err("Codex requested unsupported tool or approval control.".into());
            }
            if notifications.len() < 2048 {
                notifications.push(value);
            } else {
                return Err("Codex emitted too many pending events.".into());
            }
        }
    }

    async fn request_controlled(
        &mut self,
        method: &str,
        params: Value,
        updates: &ProviderEvents,
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
                updates.fail(
                    updates.snapshot().run_id,
                    "Codex requested unsupported tool or approval control.",
                );
                return Err("Codex requested unsupported tool or approval control.".into());
            } else if notifications.len() < 2048 {
                notifications.push(value);
            } else {
                return Err("Codex emitted too many pending events.".into());
            }
        }
    }

    async fn terminate(&mut self) {
        #[cfg(windows)]
        self.job.terminate();
        let _ = self.child.kill().await;
        let _ = self.child.wait().await;
    }
}

fn is_for_turn(value: &Value, thread: &str, turn: &str) -> bool {
    let turn_matches = value["params"]["turnId"].as_str() == Some(turn)
        || value["params"]["turn"]["id"].as_str() == Some(turn);
    let thread_matches = match value["params"]["threadId"].as_str() {
        Some(id) => id == thread,
        None => value["method"].as_str() == Some("turn/completed") && turn_matches,
    };
    turn_matches && thread_matches
}

fn handle_delta(value: &Value, run_id: u64, updates: &ProviderEvents) {
    if let Some(delta) = value["params"]["delta"].as_str() {
        updates.emit(AgentEvent::TextDelta {
            run_id,
            delta: delta.to_owned(),
        });
    }
}

fn handle_item_started(value: &Value, run_id: u64, updates: &ProviderEvents) -> bool {
    let kind = value["params"]["item"]["type"].as_str();
    if !matches!(kind, Some("agentMessage" | "reasoning")) {
        updates.fail(run_id, "Codex attempted an unsupported tool action.");
        return true;
    }
    false
}

fn handle_item_completed(value: &Value, run_id: u64, updates: &ProviderEvents) -> bool {
    let item = &value["params"]["item"];
    if !matches!(item["type"].as_str(), Some("agentMessage" | "reasoning")) {
        updates.fail(run_id, "Codex attempted an unsupported tool action.");
        return true;
    }
    if item["type"].as_str() == Some("agentMessage")
        && let Some(text) = item["text"].as_str()
    {
        updates.emit(AgentEvent::TextFinal {
            run_id,
            text: text.to_owned(),
        });
    }
    false
}

fn usage_snapshot(value: &Value) -> Option<UsageSnapshot> {
    let token_usage = &value["params"]["tokenUsage"];
    let last = &token_usage["last"];
    let total = &token_usage["total"];
    token_usage.is_object().then(|| UsageSnapshot {
        context_tokens: last["totalTokens"].as_i64(),
        session_tokens: total["totalTokens"].as_i64().unwrap_or(0),
        input_tokens: last["inputTokens"].as_i64().unwrap_or(0),
        cached_input_tokens: last["cachedInputTokens"].as_i64().unwrap_or(0),
        output_tokens: last["outputTokens"].as_i64().unwrap_or(0),
        reasoning_output_tokens: last["reasoningOutputTokens"].as_i64(),
        model_context_window: token_usage["modelContextWindow"].as_i64(),
    })
}

fn handle_turn_completed(value: &Value, run_id: u64, updates: &ProviderEvents) {
    match value["params"]["turn"]["status"].as_str() {
        Some("completed") => updates.emit(AgentEvent::Completed { run_id }),
        Some("interrupted") => updates.stopped(run_id),
        _ => updates.fail(run_id, "Codex turn did not complete."),
    }
}

fn handle_event(
    value: &Value,
    thread: &str,
    turn: &str,
    run_id: u64,
    updates: &ProviderEvents,
) -> bool {
    if !is_for_turn(value, thread, turn) {
        return false;
    }
    match value["method"].as_str() {
        Some("item/agentMessage/delta") => handle_delta(value, run_id, updates),
        Some("item/started") => return handle_item_started(value, run_id, updates),
        Some("item/completed") => return handle_item_completed(value, run_id, updates),
        Some("thread/tokenUsage/updated") => {
            if let Some(usage) = usage_snapshot(value) {
                updates.emit(AgentEvent::UsageUpdated { run_id, usage });
            }
        }
        Some("model/rerouted") => {
            if let Some(model) = value["params"]["toModel"].as_str() {
                updates.emit(AgentEvent::RuntimeChanged {
                    run_id,
                    model: Some(model.to_owned()),
                    thinking_effort: updates.snapshot().thinking_effort,
                });
            }
        }
        Some("turn/completed") => {
            handle_turn_completed(value, run_id, updates);
            return true;
        }
        _ => {}
    }
    false
}

struct TurnInput<'a> {
    thread: &'a str,
    text: &'a str,
    display_text: &'a str,
    model: Option<&'a str>,
    thinking_effort: Option<&'a str>,
    image: Option<&'a std::path::Path>,
}

async fn begin_turn(
    rpc: &mut Rpc,
    input: TurnInput<'_>,
    run_id: u64,
    updates: &ProviderEvents,
    controls: Option<&mut mpsc::Receiver<Control>>,
) -> Result<Option<(String, Vec<Value>)>, String> {
    let response = rpc
        .request_controlled(
            "turn/start",
            policy::turn_start_with_image(
                input.thread,
                input.text,
                input.model,
                input.thinking_effort,
                input.image,
            ),
            updates,
            controls,
        )
        .await?;
    let Some((result, buffered)) = response else {
        return Ok(None);
    };
    let turn = result
        .pointer("/turn/id")
        .and_then(Value::as_str)
        .ok_or("Codex returned no turn ID.")?
        .to_owned();
    updates.emit(AgentEvent::RuntimeChanged {
        run_id,
        model: result["turn"]["model"]
            .as_str()
            .map(str::to_owned)
            .or_else(|| input.model.map(str::to_owned)),
        thinking_effort: result["turn"]["reasoningEffort"]
            .as_str()
            .map(str::to_owned)
            .or_else(|| input.thinking_effort.map(str::to_owned)),
    });
    updates.emit(AgentEvent::TurnStarted {
        run_id,
        text: input.display_text.to_owned(),
    });
    Ok(Some((turn, buffered)))
}

pub async fn run(mut controls: mpsc::Receiver<Control>, updates: ProviderEvents, initial: Control) {
    let Control::Ask {
        text,
        display_text,
        cwd,
        run_id,
        model,
        thinking_effort,
        capture,
    } = initial
    else {
        return;
    };
    let mut active_capture = capture;
    let mut rpc = match Rpc::launch(&cwd) {
        Ok(rpc) => rpc,
        Err(e) => {
            updates.fail(run_id, &e);
            return;
        }
    };

    let result = tokio::select! {
        result = async {
            rpc.request(
                "initialize",
                json!({ "clientInfo": { "name": "otto", "title": "Otto", "version": "0.1.0" } }),
            ).await?;
            rpc.send(json!({ "method": "initialized", "params": {} })).await?;
            let (thread_response, _) = rpc.request(
                "thread/start",
                policy::thread_start(
                    &cwd.to_string_lossy(),
                    model.as_deref(),
                    thinking_effort.as_deref(),
                ),
            ).await?;
            if !policy::thread_matches_policy(&thread_response) {
                return Err("Codex cannot confirm a read-only chat sandbox.".into());
            }
            let thread = thread_response.pointer("/thread/id").and_then(Value::as_str)
                .ok_or("Codex returned no thread ID.")?.to_owned();
            updates.emit(AgentEvent::SessionReady { run_id, session_id: thread.clone() });
            Ok::<_, String>(thread)
        } => result,
        command = controls.recv() => {

            if !matches!(command, Some(Control::Stop)) {
                updates.fail(run_id, "Unexpected Codex control during initialization.");
            } else {
                updates.stopped(run_id);
            }
            rpc.terminate().await;
            return;
        }
    };
    let thread = match result {
        Ok(thread) => thread,
        Err(error) => {
            updates.fail(run_id, &error);
            rpc.terminate().await;
            return;
        }
    };

    let (turn, buffered) = match begin_turn(
        &mut rpc,
        TurnInput {
            thread: &thread,
            text: &text,
            display_text: &display_text,
            model: model.as_deref(),
            thinking_effort: thinking_effort.as_deref(),
            image: active_capture.as_ref().map(|image| image.path()),
        },
        run_id,
        &updates,
        Some(&mut controls),
    )
    .await
    {
        Ok(Some(value)) => value,
        Ok(None) => {
            updates.stopped(run_id);
            rpc.terminate().await;
            return;
        }
        Err(error) => {
            updates.fail(run_id, &error);
            rpc.terminate().await;
            return;
        }
    };
    let active = run_id;
    for msg in buffered {
        if handle_event(&msg, &thread, &turn, run_id, &updates) {
            drop(active_capture.take());
            rpc.terminate().await;
            return;
        }
    }

    loop {
        tokio::select! {
            command = controls.recv() => match command {
                Some(Control::Close { claimed, finished }) => {

                    if finished.is_closed() || claimed.swap(true, Ordering::SeqCst) {
                        continue;
                    }
                    rpc.terminate().await;
                    let _ = finished.send(());
                    break;
                }
                Some(Control::Stop) => {
                    let _ = timeout(Duration::from_secs(5),
                        rpc.request("turn/interrupt", json!({ "threadId": thread, "turnId": turn }))
                    ).await;
                    updates.stopped(active);
                    rpc.terminate().await;
                    break;
                }
                None => { rpc.terminate().await; break; }
                _ => {}
            },
            line = read_bounded_line(&mut rpc.stdout, MAX_RPC_FRAME_BYTES) => {
                match line {
                    Ok(Some(line)) => {
                        let Ok(msg) = serde_json::from_str::<Value>(&line) else {
                            updates.fail(active, "Invalid Codex stream.");
                            rpc.terminate().await;
                            break;
                        };
                        if msg.get("method").is_some() && msg.get("id").is_some() {
                            updates.fail(
                                active,
                                "Codex requested unsupported tool or approval control.",
                            );
                            rpc.terminate().await;
                            break;
                        } else if handle_event(&msg, &thread, &turn, active, &updates) {
                            drop(active_capture.take());
                            rpc.terminate().await;
                            break;
                        }
                    }
                    Ok(None) => {
                        updates.fail(active, "Codex disconnected.");
                        break;
                    }
                    Err(error) => {
                        updates.fail(active, bounded_line_error(error));
                        rpc.terminate().await;
                        break;
                    }
                }
            }
        }
    }

    let state = updates.snapshot();
    match state.status {
        RunPhase::Starting | RunPhase::Streaming => updates.fail(
            state.run_id,
            "Codex connection closed before the answer finished.",
        ),
        RunPhase::Stopping => updates.stopped(state.run_id),
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn ordinary_rpc_read_has_an_idle_timeout() {
        let (writer, reader) = tokio::io::duplex(256);
        let _keep_writer_open = writer;
        let mut frames = BufReader::new(reader);
        let error = read_frame(&mut frames, Duration::from_millis(5))
            .await
            .unwrap_err();
        assert_eq!(error, "Codex did not respond in time.");
    }

    #[test]
    fn readiness_requires_explicit_account_evidence() {
        assert_eq!(
            account_readiness(&json!({"account": null, "requiresOpenaiAuth": true})).status,
            "authRequired"
        );
        assert_eq!(
            account_readiness(&json!({"account": null, "requiresOpenaiAuth": false})).status,
            "ready"
        );
        assert_eq!(account_readiness(&json!({})).status, "unsupported");
        assert_eq!(
            account_readiness(&json!({"account": {"type": "chatgpt"}})).status,
            "ready"
        );
    }

    #[test]
    fn malformed_codex_config_never_falls_back_to_default() {
        for payload in [
            json!({}),
            json!({ "config": null }),
            json!({ "config": [] }),
            json!({ "config": {} }),
            json!({ "config": { "model": "" } }),
            json!({ "config": { "model": 123 } }),
        ] {
            let status = configured_model(&payload).unwrap_err();
            assert_eq!(status.status, "unsupported");
        }
        assert!(matches!(
            configured_model(&json!({ "config": { "model": null } })),
            Ok(None)
        ));
        assert!(matches!(
            configured_model(&json!({ "config": { "model": "custom" } })),
            Ok(Some("custom"))
        ));
    }

    #[test]
    fn model_capability_is_gated_by_the_default_model() {
        let ready = model_readiness(
            &json!({ "data": [
                { "isDefault": true, "inputModalities": ["text", "image"] }
            ] }),
            None,
        );
        assert_eq!(ready.status, "ready");
        assert!(ready.image_input);

        for invalid in [
            json!({}),
            json!({ "data": [] }),
            json!({ "data": [{ "isDefault": true, "inputModalities": ["image"] }] }),
            json!({ "data": [{ "isDefault": true, "inputModalities": "text" }] }),
        ] {
            assert_ne!(model_readiness(&invalid, None).status, "ready");
        }
    }

    #[test]
    fn model_catalog_exposes_selection_and_thinking_capabilities() {
        let ready = model_readiness(
            &json!({ "data": [{
                "id": "gpt-5-codex",
                "model": "gpt-5-codex",
                "displayName": "GPT-5 Codex",
                "isDefault": true,
                "inputModalities": ["text", "image"],
                "supportedReasoningEfforts": [
                    { "reasoningEffort": "medium" },
                    { "reasoningEffort": "high" }
                ],
                "defaultReasoningEffort": "medium"
            }] }),
            None,
        );
        assert_eq!(ready.model.as_deref(), Some("gpt-5-codex"));
        assert_eq!(ready.thinking_effort.as_deref(), Some("medium"));
        assert_eq!(ready.thinking_efforts, ["medium", "high"]);
        assert_eq!(ready.models.len(), 1);
    }

    #[test]
    fn provider_usage_notification_maps_context_and_session_totals() {
        let usage = usage_snapshot(&json!({
            "params": {
                "tokenUsage": {
                    "last": {
                        "inputTokens": 120,
                        "cachedInputTokens": 40,
                        "outputTokens": 80,
                        "reasoningOutputTokens": 20,
                        "totalTokens": 200
                    },
                    "total": {
                        "inputTokens": 120,
                        "cachedInputTokens": 40,
                        "outputTokens": 80,
                        "totalTokens": 200
                    },
                    "modelContextWindow": 4000
                }
            }
        }))
        .expect("valid usage notification");
        assert_eq!(usage.context_tokens, Some(200));
        assert_eq!(usage.session_tokens, 200);
        assert_eq!(usage.cached_input_tokens, 40);
        assert_eq!(usage.model_context_window, Some(4000));
    }

    fn snapshot(status: &str, run_id: u64) -> watch::Sender<Snapshot> {
        let (tx, _) = watch::channel(Snapshot {
            run_id,
            seq: 1,
            status: status.into(),
            provider: "codex".into(),
            cwd: String::new(),
            conversation_id: String::new(),
            thread_id: None,
            model: None,
            thinking_effort: None,
            usage: None,
            messages: vec![ChatMessage {
                id: "test:assistant".into(),
                role: "assistant".into(),
                text: String::new(),
            }],
            capture: CaptureSnapshot::default(),
            error: None,
        });
        tx
    }

    #[test]
    fn unrelated_turn_cannot_append_output() {
        let tx = snapshot("streaming", 5);
        handle_event(
            &json!({
                "method": "item/agentMessage/delta",
                "params": { "threadId": "other", "turnId": "turn", "delta": "bad" }
            }),
            "real",
            "turn",
            5,
            &ProviderEvents::new(tx.clone()),
        );
        assert!(tx.borrow().messages[0].text.is_empty());
    }

    #[test]
    fn tool_items_fail_closed_without_ui_state() {
        let tx = snapshot("streaming", 3);
        assert!(handle_event(
            &json!({
                "method": "item/started",
                "params": { "threadId": "thread", "turnId": "turn",
                    "item": { "type": "commandExecution", "command": "cargo test" } }
            }),
            "thread",
            "turn",
            3,
            &ProviderEvents::new(tx.clone()),
        ));
        assert_eq!(tx.borrow().status, "failed");
        assert_eq!(
            tx.borrow().error.as_deref(),
            Some("Codex attempted an unsupported tool action.")
        );
    }

    #[test]
    fn interrupted_turn_is_stopped() {
        let tx = snapshot("streaming", 7);
        let interrupted = json!({
            "method": "turn/completed",
            "params": { "threadId": "thread", "turn": { "id": "turn", "status": "interrupted" } }
        });
        assert!(handle_event(
            &interrupted,
            "thread",
            "turn",
            7,
            &ProviderEvents::new(tx.clone())
        ));
        assert_eq!(tx.borrow().status, "stopped");
    }
}
