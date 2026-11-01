use crate::agent::events::{AgentEvent, ProviderEvents};
use crate::agent::policy::{self, InteractionMode};
use crate::agent::session::{self, ApprovalDecision, PendingApproval, ToolActivity};
#[cfg(test)]
use crate::agent::{ChatMessage, mutate};
use crate::agent::{Control, ProviderReadiness, Snapshot};
use serde_json::{Value, json};
use std::{path::PathBuf, process::Stdio, sync::atomic::Ordering, time::Duration};
use tokio::{
    io::{AsyncBufRead, AsyncBufReadExt, AsyncWriteExt, BufReader, Lines},
    process::{Child, ChildStdin, ChildStdout, Command},
    sync::{mpsc, watch},
    time::timeout,
};

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

fn model_readiness(value: &Value, configured: Option<&str>) -> ProviderReadiness {
    let Some(models) = value["data"].as_array() else {
        return ProviderReadiness::new(
            "unsupported",
            "Codex model catalog is unavailable.",
            "Update Codex, then Retry.",
        );
    };
    let selected = configured.filter(|name| !name.is_empty());
    let model = if let Some(name) = selected {
        models
            .iter()
            .find(|m| m["model"].as_str() == Some(name) || m["id"].as_str() == Some(name))
    } else {
        models
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
    let mut ready = ProviderReadiness::new("ready", "Codex is ready for text requests.", "");
    ready.image_input = modalities.is_some_and(|items| items.iter().any(|v| v == "image"));
    ready
}

fn configured_model(value: &Value) -> Result<Option<&str>, ProviderReadiness> {
    let Some(config) = value.get("config").and_then(Value::as_object) else {
        return Err(ProviderReadiness::new(
            "unsupported",
            "Codex did not return effective model configuration.",
            "Update Codex and Retry.",
        ));
    };
    match config.get("model") {
        Some(Value::Null) => Ok(None),
        Some(Value::String(name)) if !name.trim().is_empty() => Ok(Some(name.as_str())),
        _ => Err(ProviderReadiness::new(
            "unsupported",
            "Codex returned an invalid model configuration.",
            "Inspect your Codex model setting, then Retry.",
        )),
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
        let (updates, _) = watch::channel(Snapshot {
            run_id: 0,
            seq: 0,
            status: "idle".into(),
            mode: "quickAsk".into(),
            provider: "codex".into(),
            cwd: String::new(),
            thread_id: None,
            messages: Vec::new(),
            activity: None,
            approval: None,
            error: None,
        });
        let updates = ProviderEvents::new(updates);
        let mut approvals = Approvals::for_mode(InteractionMode::QuickAsk, 0);
        rpc.request(
            "initialize",
            json!({ "clientInfo": { "name": "otto", "title": "Otto", "version": "0.1.0" } }),
            &mut approvals,
            &updates,
        )
        .await?;
        rpc.send(json!({ "method": "initialized", "params": {} }))
            .await?;
        let (account, _) = rpc
            .request(
                "account/read",
                json!({ "refreshToken": true }),
                &mut approvals,
                &updates,
            )
            .await?;
        let authentication = account_readiness(&account);
        if authentication.status != "ready" {
            return Ok::<ProviderReadiness, String>(authentication);
        }

        let (config, _) = rpc
            .request(
                "config/read",
                json!({ "cwd": cwd.to_string_lossy(), "includeLayers": false }),
                &mut approvals,
                &updates,
            )
            .await?;
        let selected = match configured_model(&config) {
            Ok(model) => model,
            Err(status) => return Ok(status),
        };
        let (models, _) = rpc
            .request(
                "model/list",
                json!({ "limit": 100, "includeHidden": true }),
                &mut approvals,
                &updates,
            )
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
    stdout: Lines<BufReader<ChildStdout>>,
    next_id: u64,
}

struct PendingRequest {
    provider_id: Value,
    approval: PendingApproval,
}

async fn read_frame<R: AsyncBufRead + Unpin>(
    lines: &mut Lines<R>,
    idle_timeout: Duration,
    awaiting_user_decision: bool,
) -> Result<Value, String> {
    let next = if awaiting_user_decision {
        lines.next_line().await
    } else {
        timeout(idle_timeout, lines.next_line())
            .await
            .map_err(|_| "Codex did not respond in time.")?
    };
    let line = next
        .map_err(|_| "Codex output failed.")?
        .ok_or("Codex process disconnected.")?;
    serde_json::from_str(&line).map_err(|_| "Invalid Codex protocol response.".into())
}

enum ServerRequest {
    Recorded,

    Decline,

    Unknown,
}

#[derive(Default)]
struct Approvals {
    pending: Option<PendingRequest>,
    counter: u64,
    thread: Option<String>,
    turn: Option<String>,
    previous_turn: Option<String>,
    file_change_items: Vec<(String, String)>,
    run_id: u64,

    approval_capable: bool,
}

impl Approvals {
    fn for_mode(mode: InteractionMode, run_id: u64) -> Self {
        Self {
            approval_capable: mode == InteractionMode::AgentSession,
            run_id,
            ..Self::default()
        }
    }

    fn prepare_turn(&mut self, thread: &str, run_id: u64) {
        self.thread = Some(thread.to_owned());
        self.previous_turn = self.turn.take();
        self.file_change_items.clear();
        self.run_id = run_id;
    }

    fn context(&mut self, thread: &str, turn: &str, run_id: u64) {
        self.thread = Some(thread.to_owned());
        self.turn = Some(turn.to_owned());
        self.run_id = run_id;
    }

    fn note_item(&mut self, event: &Value) {
        let params = &event["params"];
        if params["threadId"].as_str() != self.thread.as_deref() {
            return;
        }
        let turn = params["turnId"].as_str();
        if let Some(current) = self.turn.as_deref() {
            if turn != Some(current) {
                return;
            }
        } else if turn.is_none() || turn == self.previous_turn.as_deref() {
            return;
        }
        let item = &params["item"];
        let Some(id) = item["id"].as_str() else {
            return;
        };
        match event["method"].as_str() {
            Some("item/completed") => self.file_change_items.retain(|(key, _)| key != id),
            Some("item/started") if item["type"].as_str() == Some("fileChange") => {
                let Some(changes) = item["changes"].as_array() else {
                    return;
                };
                if changes.is_empty() || changes.len() > 8 {
                    return;
                }
                let mut paths = Vec::with_capacity(changes.len());
                for change in changes {
                    let Some(path) = change["path"].as_str().filter(|p| !p.trim().is_empty())
                    else {
                        return;
                    };
                    paths.push(path);
                }
                let detail = format!("Modify files:\n{}", paths.join("\n"));
                if detail.chars().count() > session::MAX_DETAIL {
                    return;
                }
                self.file_change_items.retain(|(key, _)| key != id);
                if self.file_change_items.len() == 16 {
                    self.file_change_items.remove(0);
                }
                self.file_change_items.push((id.to_owned(), detail));
            }
            _ => {}
        }
    }

    fn parse(&mut self, value: &Value) -> ServerRequest {
        let method = value["method"].as_str().unwrap_or_default();
        let params = &value["params"];

        let is_approval = method.ends_with("/requestApproval")
            || method == "execCommandApproval"
            || method == "applyPatchApproval";
        if !is_approval {
            return ServerRequest::Unknown;
        }

        if !self.approval_capable {
            return ServerRequest::Decline;
        }

        if params["threadId"].as_str() != self.thread.as_deref() {
            return ServerRequest::Decline;
        }
        let request_turn = params["turnId"].as_str();
        if let Some(turn) = self.turn.as_deref() {
            if request_turn != Some(turn) {
                return ServerRequest::Decline;
            }
        } else if request_turn.is_none() || request_turn == self.previous_turn.as_deref() {
            return ServerRequest::Decline;
        }

        if !params["additionalPermissions"].is_null() {
            return ServerRequest::Decline;
        }
        if let Some(choices) = params["availableDecisions"].as_array() {
            if !choices
                .iter()
                .any(|choice| choice.as_str() == Some("accept"))
            {
                return ServerRequest::Decline;
            }
        } else if !params["availableDecisions"].is_null() {
            return ServerRequest::Decline;
        }
        let built = match method {
            "item/commandExecution/requestApproval" => {
                if !params["networkApprovalContext"].is_null() {
                    let context = &params["networkApprovalContext"];
                    let Some(host) = context["host"].as_str().filter(|s| !s.trim().is_empty())
                    else {
                        return ServerRequest::Decline;
                    };
                    let Some(protocol) = context["protocol"]
                        .as_str()
                        .filter(|s| matches!(*s, "http" | "https" | "socks5Tcp" | "socks5Udp"))
                    else {
                        return ServerRequest::Decline;
                    };
                    let detail = format!("{protocol} · {host}");
                    if detail.chars().count() > session::MAX_DETAIL {
                        return ServerRequest::Decline;
                    }
                    Some(("network", "Allow network access", detail))
                } else {
                    let Some(command) = params["command"].as_str().filter(|s| !s.trim().is_empty())
                    else {
                        return ServerRequest::Decline;
                    };
                    let cwd = params["cwd"].as_str().unwrap_or("");
                    let detail = if cwd.is_empty() {
                        command.to_owned()
                    } else {
                        format!("{command}\n(cwd: {cwd})")
                    };
                    if detail.chars().count() > session::MAX_DETAIL {
                        return ServerRequest::Decline;
                    }
                    Some(("command", "Run command", detail))
                }
            }
            "item/fileChange/requestApproval" => {
                if !params["grantRoot"].is_null() {
                    return ServerRequest::Decline;
                }
                let Some(id) = params["itemId"].as_str() else {
                    return ServerRequest::Decline;
                };
                self.file_change_items
                    .iter()
                    .find(|(key, _)| key == id)
                    .map(|(_, detail)| ("fileChange", "Change files", detail.clone()))
            }

            _ => None,
        };
        let Some((kind, title, detail)) = built else {
            return ServerRequest::Decline;
        };
        if self.pending.is_some() {
            return ServerRequest::Decline;
        }
        self.counter += 1;
        self.pending = Some(PendingRequest {
            provider_id: value["id"].clone(),
            approval: PendingApproval {
                approval_id: format!("appr-{}-{}", self.run_id, self.counter),
                run_id: self.run_id,
                kind: kind.into(),
                title: title.into(),
                detail: session::bounded(&detail),
                reason: params["reason"].as_str().map(session::bounded),
            },
        });
        ServerRequest::Recorded
    }

    fn decide(&mut self, approval_id: &str, decision: ApprovalDecision) -> Option<Value> {
        let pending = self.pending.take()?;
        if pending.approval.approval_id != approval_id {
            self.pending = Some(pending);
            return None;
        }
        Some(json!({
            "id": pending.provider_id,
            "result": { "decision": decision.provider_verb() }
        }))
    }

    fn decline(value: &Value) -> Value {
        json!({ "id": value["id"].clone(), "result": { "decision": "decline" } })
    }

    fn reject(value: &Value) -> Value {
        json!({
            "id": value["id"].clone(),
            "error": { "code": -32601, "message": "Unsupported by Otto" }
        })
    }
}

enum StartupControl {
    Stop,
    Reply(Value, String),
    Continue,
}

fn classify_startup_control(
    command: Option<Control>,
    approvals: &mut Approvals,
    updates: &ProviderEvents,
) -> Result<StartupControl, String> {
    match command {
        Some(Control::Stop) => Ok(StartupControl::Stop),
        Some(Control::Close { .. }) => Err("Cannot close Codex while starting a turn.".into()),
        Some(Control::Decide {
            approval_id,
            decision,
        }) => {
            if let Some(reply) = approvals.decide(&approval_id, decision) {
                Ok(StartupControl::Reply(reply, approval_id))
            } else {
                publish_approval(approvals, updates);
                Ok(StartupControl::Continue)
            }
        }
        Some(Control::Ask { .. }) => Err("Cannot queue another turn during startup.".into()),
        None => Err("Codex control channel closed during startup.".into()),
    }
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
        let mut child = cmd.spawn().map_err(|_| "Cannot start Codex CLI.")?;
        #[cfg(windows)]
        let job = match child.id().and_then(|pid| super::job::Job::attach(pid).ok()) {
            Some(job) => job,
            None => {
                let _ = child.start_kill();
                return Err("Cannot isolate the Codex process tree on Windows.".into());
            }
        };
        let stdin = child.stdin.take().ok_or("Codex stdin unavailable.")?;
        let stdout = child.stdout.take().ok_or("Codex stdout unavailable.")?;
        Ok(Self {
            #[cfg(windows)]
            job,
            child,
            stdin,
            stdout: BufReader::new(stdout).lines(),
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

    async fn read(&mut self, awaiting_user_decision: bool) -> Result<Value, String> {
        read_frame(
            &mut self.stdout,
            Duration::from_secs(45),
            awaiting_user_decision,
        )
        .await
    }

    async fn request(
        &mut self,
        method: &str,
        params: Value,
        approvals: &mut Approvals,
        updates: &ProviderEvents,
    ) -> Result<(Value, Vec<Value>), String> {
        self.request_controlled(method, params, approvals, updates, None)
            .await?
            .ok_or_else(|| "Codex request stopped.".into())
    }

    async fn request_controlled(
        &mut self,
        method: &str,
        params: Value,
        approvals: &mut Approvals,
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
                    incoming = self.read(approvals.pending.is_some()) => Ok(incoming?),
                    control = receiver.recv() => Err(control),
                };
                match next {
                    Ok(value) => value,
                    Err(control) => {
                        match classify_startup_control(control, approvals, updates)? {
                            StartupControl::Stop => return Ok(None),
                            StartupControl::Reply(reply, approval_id) => {
                                self.send(reply).await?;
                                updates.emit(AgentEvent::ApprovalResolved {
                                    run_id: approvals.run_id,
                                    approval_id,
                                });
                            }
                            StartupControl::Continue => {}
                        }
                        continue;
                    }
                }
            } else {
                self.read(false).await?
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
            approvals.note_item(&value);
            if value.get("id").is_some() && value.get("method").is_some() {
                match approvals.parse(&value) {
                    ServerRequest::Recorded => publish_approval(approvals, updates),
                    ServerRequest::Decline => self.send(Approvals::decline(&value)).await?,
                    ServerRequest::Unknown => self.send(Approvals::reject(&value)).await?,
                }
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

fn publish_approval(approvals: &Approvals, updates: &ProviderEvents) {
    if let Some(pending) = approvals.pending.as_ref() {
        let approval = pending.approval.clone();
        updates.emit(AgentEvent::ApprovalRequested {
            run_id: approval.run_id,
            approval,
        });
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

fn activity_for(item: &Value) -> Option<ToolActivity> {
    let kind = item["type"].as_str()?;
    let tool = match kind {
        "commandExecution" => ("command", item["command"].as_str().unwrap_or("")),
        "fileChange" => {
            let root = item["changes"]
                .as_array()
                .and_then(|changes| changes.first())
                .and_then(|change| change["path"].as_str())
                .unwrap_or("workspace");
            ("fileChange", root)
        }
        _ => return None,
    };
    Some(ToolActivity {
        kind: tool.0.into(),
        summary: session::bounded(tool.1),
    })
}

fn handle_delta(value: &Value, run_id: u64, updates: &ProviderEvents) {
    if let Some(delta) = value["params"]["delta"].as_str() {
        updates.emit(AgentEvent::TextDelta {
            run_id,
            delta: delta.to_owned(),
        });
    }
}

fn handle_item_started(value: &Value, run_id: u64, updates: &ProviderEvents) {
    if let Some(activity) = activity_for(&value["params"]["item"]) {
        updates.emit(AgentEvent::ActivityChanged { run_id, activity });
    }
}

fn handle_item_completed(value: &Value, run_id: u64, updates: &ProviderEvents) {
    let item = &value["params"]["item"];
    if item["type"].as_str() == Some("agentMessage")
        && let Some(text) = item["text"].as_str()
    {
        updates.emit(AgentEvent::TextFinal {
            run_id,
            text: text.to_owned(),
        });
    }
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
        Some("item/started") => handle_item_started(value, run_id, updates),
        Some("item/completed") => handle_item_completed(value, run_id, updates),
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
    image: Option<&'a std::path::Path>,
}

async fn begin_turn(
    rpc: &mut Rpc,
    input: TurnInput<'_>,
    run_id: u64,
    mode: InteractionMode,
    approvals: &mut Approvals,
    updates: &ProviderEvents,
    controls: Option<&mut mpsc::Receiver<Control>>,
) -> Result<Option<(String, Vec<Value>)>, String> {
    approvals.prepare_turn(input.thread, run_id);
    let response = rpc
        .request_controlled(
            "turn/start",
            policy::turn_start_with_image(input.thread, input.text, mode, input.image),
            approvals,
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
    approvals.context(input.thread, &turn, run_id);
    updates.emit(AgentEvent::TurnStarted {
        run_id,
        text: input.text.to_owned(),
    });
    Ok(Some((turn, buffered)))
}

async fn resolve_approval(
    rpc: &mut Rpc,
    approvals: &mut Approvals,
    approval_id: &str,
    decision: ApprovalDecision,
    updates: &ProviderEvents,
) -> Result<(), String> {
    if let Some(reply) = approvals.decide(approval_id, decision) {
        rpc.send(reply).await?;
        updates.emit(AgentEvent::ApprovalResolved {
            run_id: updates.snapshot().run_id,
            approval_id: approval_id.to_owned(),
        });
    } else {
        publish_approval(approvals, updates);
    }
    Ok(())
}

pub async fn run(
    mut controls: mpsc::Receiver<Control>,
    updates: ProviderEvents,
    initial: Control,
    mode: InteractionMode,
) {
    let Control::Ask {
        text,
        cwd,
        run_id,
        capture,
    } = initial
    else {
        return;
    };
    let mut active_capture = capture;
    let mut approvals = Approvals::for_mode(mode, run_id);
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
                &mut approvals,
                &updates,
            ).await?;
            rpc.send(json!({ "method": "initialized", "params": {} })).await?;
            let (thread_response, _) = rpc.request(
                "thread/start",
                policy::thread_start(&cwd.to_string_lossy(), mode),
                &mut approvals,
                &updates,
            ).await?;
            if !policy::thread_matches_policy(&thread_response, mode) {
                return Err(match mode {
                    InteractionMode::QuickAsk => "Codex cannot confirm read-only sandbox. Quick Ask is unavailable.".into(),
                    InteractionMode::AgentSession => "Codex cannot confirm workspace-write with on-request approval. Agent Session is unavailable.".to_string(),
                });
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

    let (mut turn, buffered) = match begin_turn(
        &mut rpc,
        TurnInput {
            thread: &thread,
            text: &text,
            image: active_capture.as_ref().map(|image| image.path()),
        },
        run_id,
        mode,
        &mut approvals,
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
    let mut active = Some(run_id);
    for msg in buffered {
        if handle_event(&msg, &thread, &turn, run_id, &updates) {
            active = None;
            drop(active_capture.take());
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
                    if let Some(id) = active {
                        let _ = timeout(Duration::from_secs(5),
                            rpc.request("turn/interrupt", json!({ "threadId": thread, "turnId": turn }), &mut approvals, &updates)
                        ).await;
                        updates.stopped(id);
                        rpc.terminate().await;
                        break;
                    }
                }
                Some(Control::Decide { approval_id, decision }) => {
                    if let Err(error) = resolve_approval(&mut rpc, &mut approvals, &approval_id, decision, &updates).await {
                        if let Some(id) = active {
                            updates.fail(id, &error);
                        }
                        rpc.terminate().await;
                        break;
                    }
                }
                Some(Control::Ask { text, cwd, run_id, capture }) if active.is_none() => {
                    if cwd.as_path() != std::path::Path::new(&updates.snapshot().cwd) {
                        updates.fail(run_id, "Working context changed. Restart Otto.");
                        continue;
                    }

                    active_capture = capture;
                    match begin_turn(
                        &mut rpc,
                        TurnInput { thread: &thread, text: &text, image: active_capture.as_ref().map(|image| image.path()) },
                        run_id,
                        mode,
                        &mut approvals,
                        &updates,
                        Some(&mut controls),
                    ).await {
                        Ok(Some((new_turn, buffered))) => {
                            turn = new_turn;
                            active = Some(run_id);
                            for msg in buffered {
                                if handle_event(&msg, &thread, &turn, run_id, &updates) {
                                    active = None;
                                    drop(active_capture.take());
                                }
                            }
                        }
                        Ok(None) => {
                            updates.stopped(run_id);
                            rpc.terminate().await;
                            break;
                        }
                        Err(error) => {
                            updates.fail(run_id, &error);
                            rpc.terminate().await;
                            break;
                        }
                    }
                }
                None => { rpc.terminate().await; break; }
                _ => {}
            },
            line = rpc.stdout.next_line() => {
                match line {
                    Ok(Some(line)) => {
                        let Ok(msg) = serde_json::from_str::<Value>(&line) else {
                            if let Some(id) = active { updates.fail(id, "Invalid Codex stream."); }
                            rpc.terminate().await;
                            break;
                        };
                        approvals.note_item(&msg);
                        if msg.get("method").is_some() && msg.get("id").is_some() {
                            let reply = match approvals.parse(&msg) {
                                ServerRequest::Recorded => { publish_approval(&approvals, &updates); None }
                                ServerRequest::Decline => Some(Approvals::decline(&msg)),
                                ServerRequest::Unknown => Some(Approvals::reject(&msg)),
                            };
                            if let Some(reply) = reply
                                && rpc.send(reply).await.is_err()
                            {
                                if let Some(id) = active { updates.fail(id, "Cannot answer unsupported Codex request."); }
                                rpc.terminate().await;
                                break;
                            }
                        } else if let Some(id) = active
                            && handle_event(&msg, &thread, &turn, id, &updates)
                        {
                            active = None;
                            drop(active_capture.take());
                        }
                    }
                    _ => {
                        if let Some(id) = active { updates.fail(id, "Codex disconnected."); }
                        break;
                    }
                }
            }
        }
    }

    let state = updates.snapshot();
    match state.status.as_str() {
        "starting" | "streaming" | "approvalRequired" => updates.fail(
            state.run_id,
            "Codex connection closed before the answer finished.",
        ),
        "stopping" => updates.stopped(state.run_id),
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn approval_can_wait_longer_than_the_normal_rpc_idle_timeout() {
        let (mut writer, reader) = tokio::io::duplex(512);
        let mut frames = BufReader::new(reader).lines();
        let delayed_frame = tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(35)).await;
            writer
                .write_all(b"{\"id\":1,\"result\":{}}\n")
                .await
                .unwrap();
        });
        let got = timeout(
            Duration::from_secs(1),
            read_frame(&mut frames, Duration::from_millis(5), true),
        )
        .await
        .expect("pending approval remains available")
        .expect("valid frame");
        delayed_frame.await.unwrap();
        assert_eq!(got["id"], 1);
    }

    #[tokio::test]
    async fn ordinary_rpc_read_still_has_an_idle_timeout() {
        let (writer, reader) = tokio::io::duplex(256);
        let _keep_writer_open = writer;
        let mut frames = BufReader::new(reader).lines();
        let error = read_frame(&mut frames, Duration::from_millis(5), false)
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
            account_readiness(&json!({"account": {"type": "chatgpt"}, "requiresOpenaiAuth": true}))
                .status,
            "ready"
        );
        assert_eq!(
            account_readiness(&json!({"account": {"type": "mystery"}})).status,
            "unsupported"
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
            assert!(!status.image_input);
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
            { "isDefault": false, "inputModalities": ["text", "image"] },
            { "isDefault": true, "inputModalities": ["text"] }
        ] }),
            None,
        );
        assert_eq!(ready.status, "ready");
        assert!(!ready.image_input);

        let image = model_readiness(
            &json!({ "data": [
            { "isDefault": true, "inputModalities": ["text", "image"] }
        ] }),
            None,
        );
        assert_eq!(image.status, "ready");
        assert!(image.image_input);

        for invalid in [
            json!({}),
            json!({ "data": [] }),
            json!({ "data": [{ "isDefault": true, "inputModalities": ["image"] }] }),
            json!({ "data": [{ "isDefault": true, "inputModalities": "text" }] }),
        ] {
            let value = model_readiness(&invalid, None);
            assert_ne!(value.status, "ready");
            assert!(!value.image_input);
        }

        let legacy = model_readiness(&json!({ "data": [{ "isDefault": true }] }), None);
        assert_eq!(legacy.status, "ready");
        assert!(!legacy.image_input);
        let override_model = model_readiness(
            &json!({ "data": [
                { "model": "default", "isDefault": true, "inputModalities": ["text", "image"] },
                { "model": "custom", "isDefault": false, "hidden": true, "inputModalities": ["text"] }
            ] }),
            Some("custom"),
        );
        assert_eq!(override_model.status, "ready");
        assert!(!override_model.image_input);
        let unknown = model_readiness(
            &json!({ "data": [
                { "model": "default", "isDefault": true, "inputModalities": ["text", "image"] }
            ] }),
            Some("not-listed"),
        );
        assert_eq!(unknown.status, "unsupported");
        assert!(!unknown.image_input);
    }

    fn snapshot(status: &str, run_id: u64) -> watch::Sender<Snapshot> {
        let (tx, _) = watch::channel(Snapshot {
            run_id,
            seq: 1,
            status: status.into(),
            mode: "agentSession".into(),
            provider: "codex".into(),
            cwd: String::new(),
            thread_id: None,
            messages: vec![ChatMessage {
                id: "test:assistant".into(),
                role: "assistant".into(),
                text: String::new(),
            }],
            activity: None,
            approval: None,
            error: None,
        });
        tx
    }

    fn command_request(id: u64, thread: &str, turn: &str) -> Value {
        json!({
            "id": id,
            "method": "item/commandExecution/requestApproval",
            "params": { "threadId": thread, "turnId": turn, "command": "npm test", "cwd": "C:/p" }
        })
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
    fn stop_wins_race_against_completed_notification() {
        let tx = snapshot("stopping", 7);
        let completed = json!({
            "method": "turn/completed",
            "params": { "threadId": "thread", "turn": { "id": "turn", "status": "completed" } }
        });
        assert!(handle_event(
            &completed,
            "thread",
            "turn",
            7,
            &ProviderEvents::new(tx.clone())
        ));
        assert_eq!(tx.borrow().status, "stopped");
        let late = json!({
            "method": "item/agentMessage/delta",
            "params": { "threadId": "thread", "turnId": "turn", "delta": "late" }
        });
        handle_event(&late, "thread", "turn", 7, &ProviderEvents::new(tx.clone()));
        assert!(tx.borrow().messages[0].text.is_empty());
    }

    #[test]
    fn approval_request_for_current_turn_is_recorded_and_published() {
        let mut approvals = Approvals::for_mode(InteractionMode::AgentSession, 9);
        approvals.context("thread", "turn", 9);
        let tx = snapshot("streaming", 9);
        assert!(matches!(
            approvals.parse(&command_request(1, "thread", "turn")),
            ServerRequest::Recorded
        ));
        publish_approval(&approvals, &ProviderEvents::new(tx.clone()));
        let snapshot = tx.borrow();
        assert_eq!(snapshot.status, "approvalRequired");
        let approval = snapshot.approval.as_ref().expect("pending approval");
        assert_eq!(approval.kind, "command");
        assert_eq!(approval.detail, "npm test\n(cwd: C:/p)");
        assert_eq!(approval.run_id, 9);
    }

    #[test]
    fn network_approval_displays_actual_destination() {
        let mut approvals = Approvals::for_mode(InteractionMode::AgentSession, 9);
        approvals.context("thread", "turn", 9);
        let request = json!({
            "id": 10, "method": "item/commandExecution/requestApproval",
            "params": { "threadId": "thread", "turnId": "turn",
                "networkApprovalContext": { "host": "api.example.org:443", "protocol": "https" },
                "availableDecisions": ["accept", "decline"] }
        });
        assert!(matches!(approvals.parse(&request), ServerRequest::Recorded));
        let info = &approvals.pending.as_ref().unwrap().approval;
        assert_eq!(info.kind, "network");
        assert_eq!(info.title, "Allow network access");
        assert_eq!(info.detail, "https · api.example.org:443");
    }

    #[test]
    fn ambiguous_or_expanded_approval_is_declined() {
        let mut approvals = Approvals::for_mode(InteractionMode::AgentSession, 9);
        approvals.context("thread", "turn", 9);
        let mut request = command_request(1, "thread", "turn");
        request["params"]["command"] = Value::Null;
        assert!(matches!(approvals.parse(&request), ServerRequest::Decline));
        request["params"]["command"] = json!("curl example.org");
        request["params"]["additionalPermissions"] = json!({"network": {"enabled": true}});
        assert!(matches!(approvals.parse(&request), ServerRequest::Decline));
        request["params"]["additionalPermissions"] = Value::Null;
        request["params"]["availableDecisions"] = json!(["decline", "acceptForSession"]);
        assert!(matches!(approvals.parse(&request), ServerRequest::Decline));
        request["params"]["availableDecisions"] = Value::Null;
        request["params"]["networkApprovalContext"] = json!({"host": "", "protocol": "https"});
        assert!(matches!(approvals.parse(&request), ServerRequest::Decline));
        assert!(approvals.pending.is_none());
    }

    #[test]
    fn prior_turn_file_paths_are_not_reused_on_followup() {
        let mut approvals = Approvals::for_mode(InteractionMode::AgentSession, 9);
        approvals.context("thread", "old", 9);
        let event = json!({
            "method": "item/started",
            "params": { "threadId": "thread", "turnId": "old",
                "item": { "id": "same", "type": "fileChange",
                    "changes": [{ "path": "secret.txt" }] } }
        });
        approvals.note_item(&event);
        assert_eq!(approvals.file_change_items.len(), 1);
        approvals.prepare_turn("thread", 10);
        assert!(approvals.file_change_items.is_empty());
        approvals.note_item(&event);
        assert!(approvals.file_change_items.is_empty());
        let request = json!({
            "id": 31, "method": "item/fileChange/requestApproval",
            "params": { "threadId": "thread", "turnId": "new", "itemId": "same" }
        });
        assert!(matches!(approvals.parse(&request), ServerRequest::Decline));
    }

    #[test]
    fn file_change_approval_requires_item_paths_and_no_session_grant() {
        let mut approvals = Approvals::for_mode(InteractionMode::AgentSession, 9);
        approvals.context("thread", "turn", 9);
        let mut request = json!({
            "id": 11, "method": "item/fileChange/requestApproval",
            "params": { "threadId": "thread", "turnId": "turn", "itemId": "item1" }
        });
        assert!(matches!(approvals.parse(&request), ServerRequest::Decline));
        approvals.note_item(&json!({
            "method": "item/started",
            "params": { "threadId": "thread", "turnId": "turn",
                "item": { "id": "item1", "type": "fileChange",
                    "changes": [{ "path": "src/a.rs" }, { "path": "src/b.rs" }] } }
        }));
        request["params"]["grantRoot"] = json!("C:/repo");
        assert!(matches!(approvals.parse(&request), ServerRequest::Decline));
        request["params"]["grantRoot"] = Value::Null;
        assert!(matches!(approvals.parse(&request), ServerRequest::Recorded));
        let pending = &approvals.pending.as_ref().unwrap().approval;
        assert_eq!(pending.kind, "fileChange");
        assert_eq!(pending.detail, "Modify files:\nsrc/a.rs\nsrc/b.rs");
    }

    #[test]
    fn approval_before_turn_id_is_known_is_still_recorded() {
        let mut approvals = Approvals::for_mode(InteractionMode::AgentSession, 9);
        approvals.thread = Some("thread".into());
        assert!(matches!(
            approvals.parse(&command_request(1, "thread", "turn")),
            ServerRequest::Recorded
        ));
    }

    #[test]
    fn approval_during_turn_start_is_published() {
        let mut approvals = Approvals::for_mode(InteractionMode::AgentSession, 9);
        approvals.thread = Some("thread".into());
        let tx = snapshot("streaming", 9);
        assert!(matches!(
            approvals.parse(&command_request(1, "thread", "turn")),
            ServerRequest::Recorded
        ));
        publish_approval(&approvals, &ProviderEvents::new(tx.clone()));
        assert_eq!(
            tx.borrow().status,
            "approvalRequired",
            "an approval raised before turn/start returns must reach the UI"
        );
    }

    #[test]
    fn quick_ask_rejects_non_approval_server_requests_with_an_error() {
        let mut approvals = Approvals::for_mode(InteractionMode::QuickAsk, 9);
        approvals.thread = Some("thread".into());
        let request = json!({
            "id": 3,
            "method": "item/tool/requestUserInput",
            "params": { "threadId": "thread", "turnId": "turn" }
        });
        assert!(matches!(approvals.parse(&request), ServerRequest::Unknown));
    }

    #[test]
    fn activity_clears_when_the_answer_streams_after_a_tool() {
        let tx = snapshot("streaming", 3);
        handle_item_started(
            &json!({
                "method": "item/started",
                "params": { "threadId": "thread", "turnId": "turn",
                    "item": { "type": "commandExecution", "command": "cargo test" } }
            }),
            3,
            &ProviderEvents::new(tx.clone()),
        );
        assert!(tx.borrow().activity.is_some());
        handle_event(
            &json!({
                "method": "item/agentMessage/delta",
                "params": { "threadId": "thread", "turnId": "turn", "delta": "Here is the answer" }
            }),
            "thread",
            "turn",
            3,
            &ProviderEvents::new(tx.clone()),
        );
        assert!(
            tx.borrow().activity.is_none(),
            "tool activity must clear once the answer text streams"
        );
    }

    #[test]
    fn quick_ask_never_records_or_shows_an_approval() {
        let mut approvals = Approvals::for_mode(InteractionMode::QuickAsk, 9);
        approvals.context("thread", "turn", 9);
        let request = command_request(1, "thread", "turn");
        assert!(matches!(approvals.parse(&request), ServerRequest::Decline));
        assert!(approvals.pending.is_none());
        let tx = snapshot("streaming", 9);
        publish_approval(&approvals, &ProviderEvents::new(tx.clone()));
        assert_eq!(tx.borrow().status, "streaming");
        assert!(tx.borrow().approval.is_none());
        assert_eq!(
            Approvals::decline(&request),
            json!({ "id": 1, "result": { "decision": "decline" } })
        );
    }

    #[test]
    fn mismatched_or_second_approval_fails_closed() {
        let mut approvals = Approvals::for_mode(InteractionMode::AgentSession, 9);
        approvals.context("thread", "turn", 9);
        assert!(matches!(
            approvals.parse(&command_request(1, "other", "turn")),
            ServerRequest::Decline
        ));
        assert!(matches!(
            approvals.parse(&command_request(2, "thread", "other")),
            ServerRequest::Decline
        ));

        assert!(matches!(
            approvals.parse(&command_request(3, "thread", "turn")),
            ServerRequest::Recorded
        ));
        assert!(matches!(
            approvals.parse(&command_request(4, "thread", "turn")),
            ServerRequest::Decline
        ));
    }

    #[test]
    fn unsupported_permissions_approval_is_declined() {
        let mut approvals = Approvals::for_mode(InteractionMode::AgentSession, 9);
        approvals.context("thread", "turn", 9);
        let request = json!({
            "id": 7,
            "method": "item/permissions/requestApproval",
            "params": { "threadId": "thread", "turnId": "turn" }
        });
        assert!(matches!(approvals.parse(&request), ServerRequest::Decline));
        assert_eq!(
            Approvals::decline(&request),
            json!({ "id": 7, "result": { "decision": "decline" } })
        );
    }

    #[test]
    fn approval_identifiers_never_alias_between_runs_or_new_processes() {
        let mut first = Approvals::for_mode(InteractionMode::AgentSession, 9);
        first.context("thread-one", "turn", 9);
        assert!(matches!(
            first.parse(&command_request(1, "thread-one", "turn")),
            ServerRequest::Recorded
        ));
        let old_id = first.pending.as_ref().unwrap().approval.approval_id.clone();

        let mut second = Approvals::for_mode(InteractionMode::AgentSession, 10);
        second.context("thread-two", "turn", 10);
        assert!(matches!(
            second.parse(&command_request(2, "thread-two", "turn")),
            ServerRequest::Recorded
        ));
        let new_id = second
            .pending
            .as_ref()
            .unwrap()
            .approval
            .approval_id
            .clone();
        assert_ne!(old_id, new_id);
        assert!(
            second
                .decide(&old_id, ApprovalDecision::AllowOnce)
                .is_none()
        );
        assert_eq!(
            second.pending.as_ref().unwrap().approval.approval_id,
            new_id
        );
    }

    #[test]
    fn decision_encodes_exact_provider_verb_and_rejects_stale_ids() {
        let mut approvals = Approvals::for_mode(InteractionMode::AgentSession, 9);
        approvals.context("thread", "turn", 9);
        approvals.parse(&command_request(1, "thread", "turn"));

        assert!(
            approvals
                .decide("appr-9", ApprovalDecision::AllowOnce)
                .is_none()
        );
        let approval_id = approvals
            .pending
            .as_ref()
            .unwrap()
            .approval
            .approval_id
            .clone();
        let accept = approvals
            .decide(&approval_id, ApprovalDecision::AllowOnce)
            .unwrap();
        assert_eq!(
            accept,
            json!({ "id": 1, "result": { "decision": "accept" } })
        );

        assert!(
            approvals
                .decide(&approval_id, ApprovalDecision::Deny)
                .is_none()
        );
    }

    #[test]
    fn deny_maps_to_cancel() {
        let mut approvals = Approvals::for_mode(InteractionMode::AgentSession, 9);
        approvals.context("thread", "turn", 9);
        approvals.parse(&command_request(1, "thread", "turn"));
        let approval_id = approvals
            .pending
            .as_ref()
            .unwrap()
            .approval
            .approval_id
            .clone();
        let reply = approvals
            .decide(&approval_id, ApprovalDecision::Deny)
            .unwrap();
        assert_eq!(
            reply,
            json!({ "id": 1, "result": { "decision": "cancel" } })
        );
    }

    #[test]
    fn tool_activity_comes_only_from_real_items() {
        let tx = snapshot("streaming", 3);
        handle_item_started(
            &json!({
                "method": "item/started",
                "params": { "threadId": "thread", "turnId": "turn",
                    "item": { "type": "commandExecution", "command": "cargo test" } }
            }),
            3,
            &ProviderEvents::new(tx.clone()),
        );
        assert_eq!(tx.borrow().activity.as_ref().unwrap().summary, "cargo test");

        handle_item_started(
            &json!({ "method": "item/started", "params": { "item": { "type": "agentMessage" } } }),
            3,
            &ProviderEvents::new(tx.clone()),
        );
        assert!(tx.borrow().activity.is_some());
    }

    #[test]
    fn interrupted_turn_is_stopped_and_clears_approval() {
        let tx = snapshot("approvalRequired", 7);
        mutate(&tx, |s| {
            s.approval = Some(PendingApproval {
                approval_id: "appr-1".into(),
                run_id: 7,
                kind: "command".into(),
                title: "Run command".into(),
                detail: "x".into(),
                reason: None,
            })
        });
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
        assert!(tx.borrow().approval.is_none());
    }
    #[test]
    fn followup_approval_before_ack_is_bound_to_new_run() {
        let mut approvals = Approvals::for_mode(InteractionMode::AgentSession, 4);
        approvals.context("thread", "previous-turn", 4);
        let updates = snapshot("starting", 5);

        approvals.prepare_turn("thread", 5);
        assert_eq!(approvals.turn, None);
        assert_eq!(approvals.previous_turn.as_deref(), Some("previous-turn"));
        assert_eq!(approvals.run_id, 5);
        assert!(matches!(
            approvals.parse(&command_request(11, "thread", "previous-turn")),
            ServerRequest::Decline
        ));
        assert!(matches!(
            approvals.parse(&command_request(12, "thread", "next-turn")),
            ServerRequest::Recorded
        ));

        publish_approval(&approvals, &ProviderEvents::new(updates.clone()));
        let snap = updates.borrow();
        assert_eq!(snap.status, "approvalRequired");
        let approval = snap
            .approval
            .as_ref()
            .expect("follow-up approval is visible");
        assert_eq!(approval.run_id, 5);
        let approval_id = approval.approval_id.clone();
        drop(snap);

        let action = classify_startup_control(
            Some(Control::Decide {
                approval_id,
                decision: ApprovalDecision::AllowOnce,
            }),
            &mut approvals,
            &ProviderEvents::new(updates.clone()),
        )
        .expect("decision must remain available before the ack");
        let StartupControl::Reply(reply, approval_id) = action else {
            panic!("follow-up approval must not terminate the session");
        };
        assert_eq!(
            reply,
            json!({ "id": 12, "result": { "decision": "accept" } })
        );

        approvals.context("thread", "next-turn", 5);
        assert!(matches!(
            approvals.parse(&command_request(13, "thread", "previous-turn")),
            ServerRequest::Decline
        ));
    }

    #[test]
    fn expired_close_ack_is_not_a_live_reset_request() {
        let (finished, receiver) = tokio::sync::oneshot::channel::<()>();
        assert!(!finished.is_closed());
        drop(receiver);
        assert!(finished.is_closed());
    }

    #[test]
    fn startup_approval_decision_is_not_stop() {
        let mut approvals = Approvals::for_mode(InteractionMode::AgentSession, 9);
        approvals.thread = Some("thread".into());
        assert!(matches!(
            approvals.parse(&command_request(1, "thread", "turn")),
            ServerRequest::Recorded
        ));
        let tx = snapshot("approvalRequired", 9);
        publish_approval(&approvals, &ProviderEvents::new(tx.clone()));
        let approval_id = approvals
            .pending
            .as_ref()
            .unwrap()
            .approval
            .approval_id
            .clone();
        let action = classify_startup_control(
            Some(Control::Decide {
                approval_id,
                decision: ApprovalDecision::AllowOnce,
            }),
            &mut approvals,
            &ProviderEvents::new(tx.clone()),
        )
        .unwrap();
        let StartupControl::Reply(reply) = action else {
            panic!("an approval must reply to Codex without stopping startup");
        };
        assert_eq!(
            reply,
            json!({ "id": 1, "result": { "decision": "accept" } })
        );
        assert!(approvals.pending.is_none());
        assert_eq!(approval_id, "appr-9-1");
        assert_eq!(tx.borrow().status, "approvalRequired");
        assert!(matches!(
            classify_startup_control(
                Some(Control::Stop),
                &mut approvals,
                &ProviderEvents::new(tx.clone())
            )
            .unwrap(),
            StartupControl::Stop
        ));
    }

    #[test]
    fn stale_startup_approval_does_not_stop_or_resolve_current_request() {
        let mut approvals = Approvals::for_mode(InteractionMode::AgentSession, 9);
        approvals.thread = Some("thread".into());
        assert!(matches!(
            approvals.parse(&command_request(1, "thread", "turn")),
            ServerRequest::Recorded
        ));
        let tx = snapshot("approvalRequired", 9);
        let action = classify_startup_control(
            Some(Control::Decide {
                approval_id: "stale".into(),
                decision: ApprovalDecision::Deny,
            }),
            &mut approvals,
            &ProviderEvents::new(tx.clone()),
        )
        .unwrap();
        assert!(matches!(action, StartupControl::Continue));
        assert!(approvals.pending.is_some());
        assert_eq!(tx.borrow().status, "approvalRequired");
    }
}
