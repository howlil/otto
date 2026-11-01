use super::job::Job;
use crate::agent::events::{AgentEvent, ProviderEvents};
#[cfg(test)]
use crate::agent::{CaptureSnapshot, ChatMessage, Snapshot};
use crate::agent::{CapturedImage, Control, ModelOption, ProviderReadiness, UsageSnapshot};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde_json::{Value, json};
use std::{
    path::{Path, PathBuf},
    process::Stdio,
    sync::atomic::Ordering,
    time::Duration,
};
#[cfg(test)]
use tokio::sync::watch;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines},
    process::{Child, ChildStdin, ChildStdout},
    sync::mpsc,
    time::timeout,
};

pub fn executable() -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        for name in ["pi.exe", "pi.cmd"] {
            let executable = dir.join(name);
            if executable.is_file() {
                return Some(executable);
            }
        }
    }
    None
}

fn launch_args() -> &'static [&'static str] {
    &[
        "--mode",
        "rpc",
        "--no-session",
        "--no-tools",
        "--no-extensions",
        "--no-mcp",
        "--no-skills",
        "--no-prompt-templates",
        "--no-context-files",
        "--no-approve",
    ]
}

struct Rpc {
    job: Job,
    child: Child,
    stdin: ChildStdin,
    stdout: Lines<BufReader<ChildStdout>>,
    next_id: u64,
}

impl Rpc {
    fn launch(cwd: &Path) -> Result<Self, String> {
        let binary = executable().ok_or("Pi CLI was not found in PATH.")?;
        let mut command = super::background_command(binary);
        command
            .args(launch_args())
            .current_dir(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        let (job, mut child) = Job::spawn(&mut command)
            .map_err(|_| "Cannot launch an isolated Pi process tree.")?;
        let stdin = child.stdin.take().ok_or("Pi stdin unavailable.")?;
        let stdout = child.stdout.take().ok_or("Pi stdout unavailable.")?;
        Ok(Self {
            job,
            child,
            stdin,
            stdout: BufReader::new(stdout).lines(),
            next_id: 0,
        })
    }

    async fn send(&mut self, value: Value) -> Result<(), String> {
        let mut payload = serde_json::to_vec(&value).map_err(|_| "Invalid Pi request.")?;
        payload.push(b'\n');
        self.stdin
            .write_all(&payload)
            .await
            .map_err(|_| "Pi disconnected.")?;
        self.stdin
            .flush()
            .await
            .map_err(|_| "Pi disconnected.".to_string())
    }

    async fn read(&mut self) -> Result<Value, String> {
        let line = self
            .stdout
            .next_line()
            .await
            .map_err(|_| "Pi stream failed.")?
            .ok_or("Pi disconnected.")?;
        if line.len() > 1_000_000 {
            return Err("Pi RPC message too large.".into());
        }
        serde_json::from_str(&line).map_err(|_| "Pi returned invalid RPC data.".into())
    }

    async fn request(&mut self, mut command: Value) -> Result<Value, String> {
        self.next_id += 1;
        let id = format!("otto-pi-{}", self.next_id);
        let kind = command["type"]
            .as_str()
            .ok_or("Invalid Pi command.")?
            .to_owned();
        command["id"] = json!(id);
        self.send(command).await?;
        timeout(Duration::from_secs(8), async {
            loop {
                let frame = self.read().await?;
                if frame["type"] == "tool_execution_start"
                    || frame["type"] == "extension_ui_request"
                {
                    return Err("Pi exposed an unsupported action.".into());
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
        .map_err(|_| format!("Pi {kind} timed out."))?
    }

    async fn state(&mut self) -> Result<Value, String> {
        self.request(json!({"type":"get_state"})).await
    }

    async fn configure(
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
                .ok_or("Selected Pi model is not available in the isolated runtime.")?;
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

    async fn terminate(&mut self) {
        self.job.terminate();
        let _ = timeout(Duration::from_secs(3), self.child.wait()).await;
        let _ = self.child.start_kill();
    }
}

fn model_key(model: &Value) -> Option<String> {
    let provider = model["provider"]
        .as_str()
        .filter(|value| !value.is_empty())?;
    let id = model["id"].as_str().filter(|value| !value.is_empty())?;
    if !model["input"].as_array()?.iter().any(|part| part == "text") {
        return None;
    }
    Some(format!("{provider}/{id}"))
}

fn model_identity(state: &Value) -> Option<String> {
    model_key(&state["model"])
}

fn model_accepts_images(state: &Value) -> bool {
    state["model"]["input"]
        .as_array()
        .is_some_and(|inputs| inputs.iter().any(|part| part == "image"))
}

fn model_option(model: &Value) -> Option<ModelOption> {
    let id = model_key(model)?;
    let name = model["name"]
        .as_str()
        .or_else(|| model["id"].as_str())
        .unwrap_or("Unknown");
    Some(ModelOption {
        id,
        display_name: format!("{} · {name}", model["provider"].as_str()?),
        context_window: model["contextWindow"].as_i64(),
        image_input: model["input"]
            .as_array()
            .is_some_and(|inputs| inputs.iter().any(|part| part == "image")),
        thinking_efforts: Vec::new(),
        default_thinking_effort: None,
    })
}

fn available_models(data: &Value) -> Result<Vec<Value>, String> {
    let models = data["models"]
        .as_array()
        .ok_or("Pi model catalog has an invalid format.")?;
    let usable = models
        .iter()
        .filter(|model| model_key(model).is_some())
        .cloned()
        .collect::<Vec<_>>();
    if usable.is_empty() {
        return Err("Pi isolated runtime exposes no text model.".into());
    }
    Ok(usable)
}

fn thinking_levels(data: &Value) -> Result<Vec<String>, String> {
    let levels = data["levels"]
        .as_array()
        .ok_or("Pi thinking levels are unavailable.")?;
    let supported = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
    let result = levels
        .iter()
        .filter_map(Value::as_str)
        .filter(|value| supported.contains(value))
        .map(str::to_owned)
        .collect::<Vec<_>>();
    if result.is_empty() {
        return Err("Pi returned no supported thinking levels.".into());
    }
    Ok(result)
}

fn usage_snapshot(data: &Value) -> Option<UsageSnapshot> {
    let tokens = &data["tokens"];
    Some(UsageSnapshot {
        context_tokens: data["contextUsage"]["tokens"].as_i64(),
        session_tokens: tokens["total"].as_i64()?,
        input_tokens: tokens["input"].as_i64()?,
        cached_input_tokens: tokens["cacheRead"].as_i64()?,
        output_tokens: tokens["output"].as_i64()?,
        reasoning_output_tokens: None,
        model_context_window: data["contextUsage"]["contextWindow"].as_i64(),
    })
}

fn authentication(state: &Value) -> ProviderReadiness {
    match state["status"].as_str() {
        Some("ready") => ProviderReadiness::new("ready", "Pi is ready for text.", ""),
        Some("not_ready") => ProviderReadiness::new(
            "authRequired",
            "Pi needs provider sign-in.",
            "Authenticate the active Pi model, then Retry.",
        ),
        _ => ProviderReadiness::new(
            "unsupported",
            "Pi credential state is not supported.",
            "Update Pi and select a supported model.",
        ),
    }
}

pub async fn readiness(cwd: &PathBuf, selected_model: Option<&str>) -> ProviderReadiness {
    let Some(binary) = executable() else {
        return ProviderReadiness::new(
            "missing",
            "Pi CLI was not found.",
            "Install Pi, then Retry.",
        );
    };
    let Ok(mut rpc) = Rpc::launch(cwd) else {
        return ProviderReadiness::new(
            "unavailable",
            "Cannot start Pi RPC.",
            "Update Pi and Retry.",
        );
    };
    let probe = timeout(Duration::from_secs(18), async {
        let catalog =
            available_models(&rpc.request(json!({"type":"get_available_models"})).await?)?;
        let state = rpc.state().await?;
        let selected = selected_model
            .map(str::to_owned)
            .or_else(|| model_identity(&state))
            .or_else(|| catalog.first().and_then(model_key))
            .ok_or("Pi has no available text model.")?;
        let chosen = catalog
            .iter()
            .find(|model| model_key(model).as_deref() == Some(selected.as_str()))
            .ok_or("Pi selected model is not available in the isolated runtime.")?;
        if model_identity(&state).as_deref() != Some(selected.as_str()) {
            rpc.request(json!({
                "type":"set_model",
                "provider":chosen["provider"],
                "modelId":chosen["id"]
            }))
            .await?;
        }
        let confirmed = rpc.state().await?;
        if model_identity(&confirmed).as_deref() != Some(selected.as_str()) {
            return Err("Pi did not confirm the selected model.".into());
        }
        let efforts = thinking_levels(
            &rpc.request(json!({"type":"get_available_thinking_levels"}))
                .await?,
        )?;
        let mut models = catalog.iter().filter_map(model_option).collect::<Vec<_>>();
        if let Some(model) = models.iter_mut().find(|model| model.id == selected) {
            model.thinking_efforts = efforts.clone();
            model.default_thinking_effort = confirmed["thinkingLevel"].as_str().map(str::to_owned);
        }
        Ok::<_, String>((
            selected,
            models,
            efforts,
            confirmed["thinkingLevel"].as_str().map(str::to_owned),
            model_accepts_images(&confirmed),
        ))
    })
    .await;
    rpc.terminate().await;
    let (model, models, efforts, thinking, image_input) = match probe {
        Ok(Ok(ready)) => ready,
        _ => {
            return ProviderReadiness::new(
                "unsupported",
                "Pi model catalog or selected model could not be confirmed.",
                "Check the isolated Pi RPC models and Retry.",
            );
        }
    };
    let mut command = super::background_command(binary);
    command.args(["auth", "check", "--model", &model, "--json"]);
    command.current_dir(cwd);
    let mut readiness = match Job::probe(command, Duration::from_secs(10)).await {
        Ok(output) => match serde_json::from_slice::<Value>(&output.stdout) {
            Ok(value) => authentication(&value),
            Err(_) => ProviderReadiness::new(
                "unsupported",
                "Pi auth probe is incompatible.",
                "Update Pi and Retry.",
            ),
        },
        _ => ProviderReadiness::new(
            "unavailable",
            "Pi authentication check timed out.",
            "Retry after checking Pi.",
        ),
    };
    readiness.image_input = readiness.status == "ready" && image_input;
    readiness.model = Some(model);
    readiness.models = models;
    readiness.thinking_effort = thinking;
    readiness.thinking_efforts = efforts;
    readiness
}

const MAX_CAPTURE_BYTES: u64 = 24 * 1024 * 1024;
const PNG_MAGIC: [u8; 8] = [137, 80, 78, 71, 13, 10, 26, 10];

fn encode_png_capture(path: &Path) -> Result<String, String> {
    let length = std::fs::metadata(path)
        .map_err(|_| "Captured image is unavailable.".to_string())?
        .len();
    if length == 0 || length > MAX_CAPTURE_BYTES {
        return Err("Captured image exceeds Pi's supported size limit.".into());
    }
    let bytes = std::fs::read(path).map_err(|_| "Cannot read captured image.".to_string())?;
    if !bytes.starts_with(&PNG_MAGIC) || bytes.len() as u64 > MAX_CAPTURE_BYTES {
        return Err("Captured image is not a valid supported PNG.".into());
    }
    Ok(STANDARD.encode(bytes))
}

async fn prompt_command(
    run_id: u64,
    text: &str,
    capture: Option<&CapturedImage>,
) -> Result<Value, String> {
    let mut request = json!({"type":"prompt","id":format!("otto-{run_id}"),"message":text});
    if let Some(image) = capture {
        let path = image.path().to_owned();
        let encoded = tokio::task::spawn_blocking(move || encode_png_capture(&path))
            .await
            .map_err(|_| "Image preparation was interrupted.".to_string())??;
        request["images"] = json!([{"type":"image","data":encoded,"mimeType":"image/png"}]);
    }
    Ok(request)
}

fn accepted_prompt(frame: &Value, run_id: u64) -> Result<bool, String> {
    if frame["type"] != "response" || frame["id"] != format!("otto-{run_id}") {
        return Ok(false);
    }
    if frame["command"] != "prompt"
        || frame["success"] != true
        || (!frame["data"]["disposition"].is_null() && frame["data"]["disposition"] != "started")
    {
        return Err("Pi rejected the requested turn.".into());
    }
    Ok(true)
}

fn begin(text: &str, run_id: u64, events: &ProviderEvents) {
    events.emit(AgentEvent::TurnStarted {
        run_id,
        text: text.to_owned(),
    });
}

fn observe(frame: &Value, id: u64, events: &ProviderEvents) -> bool {
    let snapshot = events.snapshot();
    if snapshot.run_id != id || snapshot.status != "streaming" {
        return false;
    }
    match frame["type"].as_str() {
        Some("message_update") if frame["assistantMessageEvent"]["type"] == "text_delta" => {
            if let Some(delta) = frame["assistantMessageEvent"]["delta"].as_str() {
                events.emit(AgentEvent::TextDelta {
                    run_id: id,
                    delta: delta.to_owned(),
                });
            }
        }
        Some("message_end") if frame["message"]["role"] == "assistant" => {
            if matches!(
                frame["message"]["stopReason"].as_str(),
                Some("error" | "aborted")
            ) {
                events.fail(id, "Pi could not finish the answer.");
                return true;
            }
            if let Some(parts) = frame["message"]["content"].as_array() {
                let answer: String = parts
                    .iter()
                    .filter_map(|part| {
                        (part["type"] == "text")
                            .then(|| part["text"].as_str())
                            .flatten()
                    })
                    .collect();
                events.emit(AgentEvent::TextFinal {
                    run_id: id,
                    text: answer,
                });
            }
        }
        Some("agent_settled") => {
            if frame["aborted"] == true {
                events.fail(id, "Pi aborted the request.");
            } else if snapshot
                .messages
                .last()
                .is_none_or(|item| item.role != "assistant" || item.text.trim().is_empty())
            {
                events.fail(id, "Pi finished without an answer.");
            } else {
                events.emit(AgentEvent::Completed { run_id: id });
            }
            return true;
        }
        _ => {}
    }
    false
}

pub async fn run(mut controls: mpsc::Receiver<Control>, events: ProviderEvents, initial: Control) {
    let Control::Ask {
        text,
        cwd,
        run_id,
        model,
        thinking_effort,
        capture,
    } = initial
    else {
        events.fail(events.snapshot().run_id, "Pi only supports text Quick Ask.");
        return;
    };
    let mut rpc = match Rpc::launch(&cwd) {
        Ok(rpc) => rpc,
        Err(reason) => {
            events.fail(run_id, &reason);
            return;
        }
    };

    let configured = tokio::select! {
        response = rpc.configure(model.as_deref(), thinking_effort.as_deref()) => response,
        control = controls.recv() => {
            if matches!(control, Some(Control::Stop)) {
                events.stopped(run_id);
            } else {
                events.fail(run_id, "Pi startup interrupted.");
            }
            rpc.terminate().await;
            return;
        }
    };
    let (active_model, active_thinking, image_input, session) = match configured {
        Ok(configured) => configured,
        Err(reason) => {
            events.fail(run_id, &reason);
            rpc.terminate().await;
            return;
        }
    };
    events.emit(AgentEvent::RuntimeChanged {
        run_id,
        model: Some(active_model),
        thinking_effort: active_thinking,
    });
    if capture.is_some() && !image_input {
        events.fail(run_id, "The selected Pi model cannot accept screenshots.");
        rpc.terminate().await;
        return;
    }
    events.emit(AgentEvent::SessionReady {
        run_id,
        session_id: session,
    });
    let mut active_capture = capture;
    let request = match prompt_command(run_id, &text, active_capture.as_ref()).await {
        Ok(request) => request,
        Err(reason) => {
            events.fail(run_id, &reason);
            rpc.terminate().await;
            return;
        }
    };
    if rpc.send(request).await.is_err() {
        events.fail(run_id, "Cannot submit the Pi request.");
        rpc.terminate().await;
        return;
    }
    let mut pending_text = text;
    let mut active = Some(run_id);
    let mut acknowledged = false;
    let mut settled: Option<Value> = None;
    let mut buffered: Vec<Value> = Vec::new();
    loop {
        tokio::select! {
            control = controls.recv() => match control {
                Some(Control::Stop) if active.is_some() => {
                    let _ = rpc.send(json!({"type":"abort"})).await;
                    if let Some(id) = active {
                        events.stopped(id);
                    }
                    rpc.terminate().await;
                    break;
                }
                Some(Control::Close {claimed, finished}) => {
                    if finished.is_closed() || claimed.swap(true, Ordering::SeqCst) { continue; }
                    rpc.terminate().await;
                    let _ = finished.send(());
                    break;
                }
                Some(Control::Ask {text, cwd, run_id, model, thinking_effort, capture}) if active.is_none() => {
                    if cwd.as_path() != Path::new(&events.snapshot().cwd) {
                        events.fail(run_id, "Pi context changed. Start a new session.");
                        continue;
                    }
                    let configured = rpc.configure(model.as_deref(), thinking_effort.as_deref()).await;
                    let (active_model, active_thinking, selected_images, _) = match configured {
                        Ok(configured) => configured,
                        Err(reason) => {
                            events.fail(run_id, &reason);
                            continue;
                        }
                    };
                    if capture.is_some() && !selected_images {
                        events.fail(run_id, "The selected Pi model cannot accept screenshots.");
                        continue;
                    }
                    events.emit(AgentEvent::RuntimeChanged {
                        run_id,
                        model: Some(active_model),
                        thinking_effort: active_thinking,
                    });
                    let request = match prompt_command(run_id, &text, capture.as_ref()).await {
                        Ok(request) => request,
                        Err(reason) => {
                            events.fail(run_id, &reason);
                            continue;
                        }
                    };
                    if rpc.send(request).await.is_err() {
                        events.fail(run_id, "Pi follow-up could not start.");
                        rpc.terminate().await;
                        break;
                    }
                    active_capture = capture;
                    pending_text = text;
                    active = Some(run_id);
                    acknowledged = false;
                    settled = None;
                    buffered.clear();
                }
                None => { rpc.terminate().await; break; }
                _ => {}
            },
            frame = rpc.read() => match frame {
                Ok(value) => {
                    let Some(id) = active else { continue; };
                    match accepted_prompt(&value, id) {
                        Ok(true) => {
                            if acknowledged {
                                events.fail(id, "Pi duplicated the prompt acknowledgement.");
                                rpc.terminate().await;
                                break;
                            }
                            acknowledged = true;
                            begin(&pending_text, id, &events);
                            for event in buffered.drain(..) {
                                observe(&event, id, &events);
                            }
                        },
                        Ok(false) => {},
                        Err(reason) => { events.fail(id, &reason); rpc.terminate().await; break; }
                    }
                    if value["type"] == "agent_settled" {
                        settled = Some(value);
                    } else if value["type"] == "message_update" || value["type"] == "message_end" {
                        if acknowledged {
                            observe(&value, id, &events);
                        } else if buffered.len() < 256 {
                            buffered.push(value);
                        } else {
                            events.fail(id, "Pi sent excessive output before acknowledgement.");
                            rpc.terminate().await;
                            break;
                        }
                    } else if value["type"] == "tool_execution_start" || value["type"] == "extension_ui_request" {
                        events.fail(id, "Pi exposed an unsupported action.");
                        rpc.terminate().await;
                        break;
                    }
                    if acknowledged {
                        if let Some(settlement) = settled.take() {
                            if settlement["aborted"] != true {
                                let stats = tokio::select! {
                                    result = timeout(
                                        Duration::from_secs(2),
                                        rpc.request(json!({"type":"get_session_stats"}))
                                    ) => result.ok().and_then(Result::ok),
                                    control = controls.recv() => {
                                        match control {
                                            Some(Control::Stop) => events.stopped(id),
                                            Some(Control::Close { claimed, finished }) => {
                                                if !finished.is_closed()
                                                    && !claimed.swap(true, Ordering::SeqCst)
                                                {
                                                    let _ = finished.send(());
                                                }
                                                events.stopped(id);
                                            }
                                            _ => events.stopped(id),
                                        }
                                        rpc.terminate().await;
                                        break;
                                    }
                                };
                                if let Some(usage) = stats.as_ref().and_then(usage_snapshot) {
                                    events.emit(AgentEvent::UsageUpdated { run_id: id, usage });
                                }
                            }
                            observe(&settlement, id, &events);
                            active = None;
                            drop(active_capture.take());
                        }
                    }

                }
                Err(reason) => {
                    if let Some(id) = active { events.fail(id, &reason); }
                    rpc.terminate().await;
                    break;
                }
            }
        }
    }
    let snapshot = events.snapshot();
    if matches!(
        snapshot.status.as_str(),
        "starting" | "streaming" | "approvalRequired"
    ) {
        events.fail(snapshot.run_id, "Pi exited before completing the answer.");
    } else if snapshot.status == "stopping" {
        events.stopped(snapshot.run_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state() -> watch::Sender<Snapshot> {
        let (tx, _) = watch::channel(Snapshot {
            run_id: 7,
            seq: 0,
            status: "streaming".into(),
            provider: "pi".into(),
            mode: "quickAsk".into(),
            cwd: String::new(),
            thread_id: None,
            model: None,
            thinking_effort: None,
            usage: None,
            messages: vec![ChatMessage {
                id: "7:assistant".into(),
                role: "assistant".into(),
                text: String::new(),
            }],
            activity: None,
            approval: None,
            capture: CaptureSnapshot::default(),
            error: None,
        });
        tx
    }

    #[tokio::test]
    async fn pi_screenshot_prompt_transports_real_png_pixels_and_deletes_temp() {
        let path = std::env::temp_dir().join(format!(
            "otto-pi-image-{}-{}.png",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        {
            let output = std::fs::File::create(&path).unwrap();
            let mut encoder = png::Encoder::new(output, 1, 1);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().unwrap();
            writer.write_image_data(&[20, 30, 40, 255]).unwrap();
        }
        let capture = CapturedImage::new(path.clone());
        let expected = STANDARD.encode(std::fs::read(&path).unwrap());
        let command = prompt_command(7, "What is on screen?", Some(&capture))
            .await
            .unwrap();
        assert_eq!(command["type"], "prompt");
        assert_eq!(command["id"], "otto-7");
        assert_eq!(command["message"], "What is on screen?");
        assert_eq!(command["images"][0]["type"], "image");
        assert_eq!(command["images"][0]["mimeType"], "image/png");
        assert_eq!(command["images"][0]["data"], expected);
        assert!(
            !command
                .to_string()
                .contains(path.to_string_lossy().as_ref())
        );
        drop(capture);
        assert!(!path.exists());
    }

    #[tokio::test]
    async fn pi_text_only_and_invalid_png_never_fake_image_payload() {
        let text = prompt_command(8, "Hello", None).await.unwrap();
        assert!(text.get("images").is_none());
        let path = std::env::temp_dir().join(format!("otto-pi-invalid-{}.png", std::process::id()));
        std::fs::write(&path, b"this is not a png").unwrap();
        let capture = CapturedImage::new(path);
        assert!(
            prompt_command(9, "Analyze this", Some(&capture))
                .await
                .is_err()
        );
    }

    #[test]
    fn pi_image_readiness_requires_selected_model_capability() {
        assert!(model_accepts_images(
            &json!({"model":{"provider":"openai","id":"vision","input":["text","image"]}})
        ));
        assert!(!model_accepts_images(
            &json!({"model":{"provider":"openai","id":"text-only","input":["text"]}})
        ));
        assert!(!model_accepts_images(&json!({"model":{"input":"image"}})));
        assert!(!model_accepts_images(&json!({})));
    }

    #[test]
    fn pi_quick_ask_disables_all_model_tools_and_extension_execution() {
        for flag in [
            "--no-tools",
            "--no-extensions",
            "--no-mcp",
            "--no-skills",
            "--no-prompt-templates",
            "--no-context-files",
            "--no-approve",
            "--no-session",
        ] {
            assert!(launch_args().contains(&flag), "missing {flag}");
        }
    }

    #[test]
    fn pi_only_finishes_on_settled_and_rejects_stale_events() {
        let tx = state();
        let events = ProviderEvents::new(tx.clone());
        assert!(!observe(&json!({"type":"agent_end"}), 7, &events));
        observe(
            &json!({"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"partial"}}),
            7,
            &events,
        );
        assert_eq!(tx.borrow().messages[0].text, "partial");
        observe(
            &json!({"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"final"}]}}),
            7,
            &events,
        );
        assert_eq!(tx.borrow().messages[0].text, "final");
        assert!(!observe(&json!({"type":"agent_settled"}), 6, &events));
        assert!(observe(&json!({"type":"agent_settled"}), 7, &events));
        assert_eq!(tx.borrow().status, "completed");
        observe(
            &json!({"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"late"}}),
            7,
            &events,
        );
        assert_eq!(tx.borrow().messages[0].text, "final");
    }

    #[test]
    fn pi_failed_or_empty_answer_never_looks_completed() {
        let tx = state();
        let events = ProviderEvents::new(tx.clone());
        assert!(observe(
            &json!({"type":"message_end","message":{"role":"assistant","stopReason":"error","content":[{"type":"text","text":"partial"}]}}),
            7,
            &events,
        ));
        assert_eq!(tx.borrow().status, "failed");
        assert!(tx.borrow().messages[0].text.is_empty());
        assert!(!observe(
            &json!({"type":"agent_settled","aborted":false}),
            7,
            &events
        ));
        assert_eq!(tx.borrow().status, "failed");

        let empty = state();
        let empty_events = ProviderEvents::new(empty.clone());
        assert!(observe(
            &json!({"type":"agent_settled","aborted":false}),
            7,
            &empty_events
        ));
        assert_eq!(empty.borrow().status, "failed");
        assert_eq!(
            empty.borrow().error.as_deref(),
            Some("Pi finished without an answer.")
        );

        let aborted = state();
        let aborted_events = ProviderEvents::new(aborted.clone());
        assert!(observe(
            &json!({"type":"agent_settled","aborted":true}),
            7,
            &aborted_events
        ));
        assert_eq!(aborted.borrow().status, "failed");
    }

    #[test]
    fn pi_catalog_preserves_provider_and_slashes_in_model_ids() {
        let catalog = json!({"models":[
            {
                "provider":"netra",
                "id":"deepseek/deepseek-v4.1-flash",
                "name":"DeepSeek",
                "input":["text"],
                "reasoning":true,
                "contextWindow":1000000
            },
            {
                "provider":"opencode-go",
                "id":"gpt-6-luna",
                "input":["text","image"],
                "reasoning":true,
                "contextWindow":1100000
            },
            {
                "provider":"other",
                "id":"image-only",
                "input":["image"]
            }
        ]});
        let models = available_models(&catalog).unwrap();
        assert_eq!(models.len(), 2);
        let first = model_option(&models[0]).unwrap();
        assert_eq!(first.id, "netra/deepseek/deepseek-v4.1-flash");
        assert_eq!(first.context_window, Some(1000000));
        assert!(!first.image_input);
        let other = model_option(&models[1]).unwrap();
        assert_eq!(other.id, "opencode-go/gpt-6-luna");
        assert!(other.image_input);
        assert!(available_models(&json!({"models":[]})).is_err());
    }

    #[test]
    fn pi_thinking_levels_come_from_runtime_not_model_guesses() {
        assert_eq!(
            thinking_levels(&json!({"levels":["off"]})).unwrap(),
            vec!["off"]
        );
        assert_eq!(
            thinking_levels(&json!({"levels":["off","low","high","max"]})).unwrap(),
            vec!["off", "low", "high", "max"]
        );
        assert!(thinking_levels(&json!({"levels":["impossible"]})).is_err());
    }

    #[test]
    fn pi_usage_preserves_unknown_context_after_compaction() {
        let usage = usage_snapshot(&json!({
            "tokens": {
                "input":50000,
                "output":10000,
                "cacheRead":40000,
                "cacheWrite":5000,
                "total":105000
            },
            "contextUsage": {
                "tokens":null,
                "contextWindow":200000,
                "percent":null
            }
        }))
        .unwrap();
        assert_eq!(usage.context_tokens, None);
        assert_eq!(usage.model_context_window, Some(200000));
        assert_eq!(usage.session_tokens, 105000);
        assert_eq!(usage.cached_input_tokens, 40000);
        assert_eq!(usage.reasoning_output_tokens, None);
        assert!(usage_snapshot(&json!({"tokens":{"input":7}})).is_none());
    }

    #[test]
    fn pi_prompt_ack_auth_and_model_gates_fail_closed() {
        assert!(
            accepted_prompt(
                &json!({"type":"response","id":"otto-7","command":"prompt","success":true}),
                7
            )
            .unwrap()
        );
        assert!(
            accepted_prompt(
                &json!({"type":"response","id":"otto-7","command":"prompt",
            "success":true,"data":{"disposition":"started"}}),
                7
            )
            .unwrap()
        );
        assert!(
            accepted_prompt(
                &json!({"type":"response","id":"otto-7","command":"prompt",
            "success":true,"data":{"disposition":"queued"}}),
                7
            )
            .is_err()
        );
        assert_eq!(
            authentication(&json!({"status":"not_ready"})).status,
            "authRequired"
        );
        assert_eq!(
            authentication(&json!({"status":"unknown"})).status,
            "unsupported"
        );
        assert!(
            model_identity(&json!({"model":{"provider":"openai","id":"gpt-6","input":["text"]}}))
                .is_some()
        );
        assert!(
            model_identity(&json!({"model":{"provider":"openai","id":"gpt-6","input":["image"]}}))
                .is_none()
        );
    }
}
