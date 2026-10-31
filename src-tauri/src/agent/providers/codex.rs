use crate::agent::policy::{self, InteractionMode};
use crate::agent::session::{self, ApprovalDecision, PendingApproval, ToolActivity};
use crate::agent::{ChatMessage, Control, ProviderReadiness, Snapshot, fail, mutate};
use serde_json::{Value, json};
use std::{path::PathBuf, process::Stdio, sync::atomic::Ordering, time::Duration};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines},
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

// Account readiness is validated using Codex's own JSON-RPC protocol, never
// by parsing the CLI's human-readable login output. Do not expose account data.
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
            // Local/OSS providers explicitly configured without OpenAI auth.
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

// The default model, not just the signed-in account, must support text.
// Unknown or malformed catalogs never turn into a false Ready signal.
fn model_readiness(value: &Value) -> ProviderReadiness {
    let Some(models) = value["data"].as_array() else {
        return ProviderReadiness::new(
            "unsupported",
            "Codex model catalog is unavailable.",
            "Update Codex, then Retry.",
        );
    };
    let Some(model) = models
        .iter()
        .find(|m| m["isDefault"] == true && m["hidden"] != true)
    else {
        return ProviderReadiness::new(
            "unsupported",
            "Codex did not identify a default model.",
            "Check your Codex model configuration, then Retry.",
        );
    };
    let modalities = model["inputModalities"].as_array();
    // Codex documents absent inputModalities as legacy text+image support,
    // but Otto does not advertise image capability without explicit evidence.
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

// A short-lived owned app-server connection probes authentication without
// opening a browser or submitting a user prompt. Always kill its process tree.
pub async fn readiness() -> ProviderReadiness {
    if executable().is_none() {
        return ProviderReadiness::new(
            "missing",
            "Codex CLI was not found in PATH.",
            "Install Codex CLI, then Retry.",
        );
    }
    let Ok(cwd) = std::env::current_dir() else {
        return ProviderReadiness::new(
            "unavailable",
            "Cannot inspect local working directory.",
            "Retry.",
        );
    };
    let Ok(mut rpc) = Rpc::launch(&cwd) else {
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
            cwd: String::new(),
            thread_id: None,
            messages: Vec::new(),
            activity: None,
            approval: None,
            error: None,
        });
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
        let (models, _) = rpc
            .request(
                "model/list",
                json!({ "limit": 100, "includeHidden": false }),
                &mut approvals,
                &updates,
            )
            .await?;
        Ok(model_readiness(&models))
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

// A server-initiated approval request. The raw JSON-RPC request id is private
// to the adapter; K1 only ever receives the opaque Otto `approval_id`.
struct PendingRequest {
    provider_id: Value,
    approval: PendingApproval,
}

enum ServerRequest {
    // A supported approval was recorded; no reply is sent until the user decides.
    Recorded,
    // Unsupported, mismatched, or a second concurrent request: fail closed.
    Decline,
    // Not an approval request at all: reject the method.
    Unknown,
}

// G8: at most one approval may be pending. A second request, a stale context,
// or an unsupported method never auto-resolves; the provider gets `decline`.
#[derive(Default)]
struct Approvals {
    pending: Option<PendingRequest>,
    counter: u64,
    thread: Option<String>,
    turn: Option<String>,
    previous_turn: Option<String>,
    file_change_items: Vec<(String, String)>,
    run_id: u64,
    // Quick Ask is read-only and never-approval: an approval request there is a
    // contract violation and is declined without ever reaching the UI.
    approval_capable: bool,
}

impl Approvals {
    // The Otto run id is known before any turn exists, so it is pinned here.
    // Deriving it later (in context(), after turn/start returns) loses approvals
    // that arrive while turn/start is still in flight.
    fn for_mode(mode: InteractionMode, run_id: u64) -> Self {
        Self {
            approval_capable: mode == InteractionMode::AgentSession,
            run_id,
            ..Self::default()
        }
    }

    // Before turn/start, bind the next Otto run and forget the old turn ID.
    // The provider assigns the new turn ID only in its acknowledgment, but
    // approval requests for this run can arrive earlier.
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

    // File approvals carry only itemId, not changed paths. Read the real
    // item/started notification; never invent a file list from a generic root.
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
        // Classify the method before mode: a non-approval server request is not
        // an approval, so it must get a JSON-RPC error in every mode rather than
        // an approval-shaped reply the provider cannot interpret.
        let is_approval = method.ends_with("/requestApproval")
            || method == "execCommandApproval"
            || method == "applyPatchApproval";
        if !is_approval {
            return ServerRequest::Unknown;
        }
        // Quick Ask must never surface an approval.
        if !self.approval_capable {
            return ServerRequest::Decline;
        }
        // Only the current conversation may raise an approval. The turn id is
        // unknown while turn/start is in flight, so it is matched only once set.
        if params["threadId"].as_str() != self.thread.as_deref() {
            return ServerRequest::Decline;
        }
        let request_turn = params["turnId"].as_str();
        if let Some(turn) = self.turn.as_deref() {
            if request_turn != Some(turn) {
                return ServerRequest::Decline;
            }
        } else if request_turn.is_none() || request_turn == self.previous_turn.as_deref() {
            // While turn/start is unacknowledged, never approve an event for
            // the previous turn (or one with no identity at all).
            return ServerRequest::Decline;
        }
        // Otto currently supports per-action accept only. Unknown extended
        // permissions or unsupported decisions must not receive a generic Allow.
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
                // grantRoot can request broader session-scoped write access:
                // it is not equivalent to Otto's Allow once policy.
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
            // Permission grants and legacy approval methods have different
            // contracts and remain unsupported.
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
                approval_id: format!("appr-{}", self.counter),
                run_id: self.run_id,
                kind: kind.into(),
                title: title.into(),
                detail: session::bounded(&detail),
                reason: params["reason"].as_str().map(session::bounded),
            },
        });
        ServerRequest::Recorded
    }

    // Returns the exact provider reply for a valid decision. Stale, duplicate
    // and mismatched decisions return None and are never forwarded.
    fn decide(&mut self, approval_id: &str, decision: ApprovalDecision) -> Option<Value> {
        let pending = self.pending.take()?;
        if pending.approval.approval_id != approval_id {
            // Put it back: the real owner still has to answer.
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

// This is also exercised without a subprocess: an approval decision during
// turn/start must produce a provider reply, never a Stop transition.
enum StartupControl {
    Stop,
    Reply(Value),
    Continue,
}

fn classify_startup_control(
    command: Option<Control>,
    approvals: &mut Approvals,
    updates: &watch::Sender<Snapshot>,
) -> Result<StartupControl, String> {
    match command {
        Some(Control::Stop) => Ok(StartupControl::Stop),
        Some(Control::Close { .. }) => Err("Cannot close Codex while starting a turn.".into()),
        Some(Control::Decide {
            approval_id,
            decision,
        }) => {
            if let Some(reply) = approvals.decide(&approval_id, decision) {
                Ok(StartupControl::Reply(reply))
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
                // Do not leave a process running without lifecycle containment.
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

    async fn read(&mut self) -> Result<Value, String> {
        let line = timeout(Duration::from_secs(45), self.stdout.next_line())
            .await
            .map_err(|_| "Codex did not respond in time.")?
            .map_err(|_| "Codex output failed.")?
            .ok_or("Codex process disconnected.")?;
        serde_json::from_str(&line).map_err(|_| "Invalid Codex protocol response.".into())
    }

    // One stdout reader owns the request/response exchange. For the initial
    // turn/start, it also services approval decisions while awaiting the ack:
    // Codex may be blocked on that approval before it can acknowledge the turn.
    async fn request(
        &mut self,
        method: &str,
        params: Value,
        approvals: &mut Approvals,
        updates: &watch::Sender<Snapshot>,
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
        updates: &watch::Sender<Snapshot>,
        mut controls: Option<&mut mpsc::Receiver<Control>>,
    ) -> Result<Option<(Value, Vec<Value>)>, String> {
        self.next_id += 1;
        let id = self.next_id;
        self.send(json!({ "id": id, "method": method, "params": params }))
            .await?;
        let mut notifications = Vec::new();
        loop {
            let value = if let Some(receiver) = controls.as_deref_mut() {
                // Drop the competing read future before writing a decision
                // back through the same Rpc owner.
                let next = tokio::select! {
                    incoming = self.read() => Ok(incoming?),
                    control = receiver.recv() => Err(control),
                };
                match next {
                    Ok(value) => value,
                    Err(control) => {
                        match classify_startup_control(control, approvals, updates)? {
                            StartupControl::Stop => return Ok(None),
                            StartupControl::Reply(reply) => self.send(reply).await?,
                            StartupControl::Continue => {}
                        }
                        continue;
                    }
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
        // The Job Object handle is closed on Rpc drop, including process exit.
    }
}

fn publish_approval(approvals: &Approvals, updates: &watch::Sender<Snapshot>) {
    let Some(pending) = approvals.pending.as_ref() else {
        return;
    };
    let approval = pending.approval.clone();
    mutate(updates, |s| {
        if s.run_id != approval.run_id {
            return;
        }
        s.status = "approvalRequired".into();
        s.activity = None;
        s.approval = Some(approval);
    });
}

fn is_for_turn(value: &Value, thread: &str, turn: &str) -> bool {
    // turn/completed carries the terminal turn in params.turn.id;
    // delta notifications use params.turnId instead.
    let turn_matches = value["params"]["turnId"].as_str() == Some(turn)
        || value["params"]["turn"]["id"].as_str() == Some(turn);
    let thread_matches = match value["params"]["threadId"].as_str() {
        Some(id) => id == thread,
        None => value["method"].as_str() == Some("turn/completed") && turn_matches,
    };
    turn_matches && thread_matches
}

// Tool activity is derived only from real Codex item events.
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

fn handle_delta(value: &Value, run_id: u64, updates: &watch::Sender<Snapshot>) {
    if let Some(delta) = value["params"]["delta"].as_str() {
        mutate(updates, |s| {
            if s.run_id != run_id || s.status != "streaming" {
                return;
            }
            // Answer text resumed, so any tool activity is over.
            s.activity = None;
            if let Some(message) = s.messages.last_mut().filter(|m| {
                m.role == "assistant" && m.text.len().saturating_add(delta.len()) <= 128_000
            }) {
                message.text.push_str(delta);
            }
        });
    }
}

fn handle_item_started(value: &Value, run_id: u64, updates: &watch::Sender<Snapshot>) {
    if let Some(activity) = activity_for(&value["params"]["item"]) {
        mutate(updates, |s| {
            if s.run_id == run_id && s.status == "streaming" {
                s.activity = Some(activity);
            }
        });
    }
}

fn handle_item_completed(value: &Value, run_id: u64, updates: &watch::Sender<Snapshot>) {
    let item = &value["params"]["item"];
    if item["type"].as_str() == Some("agentMessage")
        && let Some(text) = item["text"].as_str()
    {
        mutate(updates, |s| {
            if s.run_id != run_id || s.status != "streaming" {
                return;
            }
            if let Some(m) = s.messages.last_mut().filter(|m| m.role == "assistant") {
                m.text = text.chars().take(128_000).collect();
            }
            // The final answer replaces any in-progress tool activity.
            s.activity = None;
        });
    }
}

fn handle_turn_completed(value: &Value, run_id: u64, updates: &watch::Sender<Snapshot>) {
    let status = value["params"]["turn"]["status"]
        .as_str()
        .unwrap_or("failed");
    mutate(updates, |s| {
        if s.run_id != run_id {
            return;
        }
        if matches!(s.status.as_str(), "completed" | "stopped" | "failed") {
            return;
        }
        s.status = match status {
            _ if s.status == "stopping" => "stopped",
            "completed" => "completed",
            "interrupted" => "stopped",
            _ => "failed",
        }
        .into();
        s.approval = None;
        s.activity = None;
        if s.status == "failed" {
            s.error = Some("Codex turn did not complete.".into());
        }
    });
}

fn handle_event(
    value: &Value,
    thread: &str,
    turn: &str,
    run_id: u64,
    updates: &watch::Sender<Snapshot>,
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

// The requested thread and prompt form one turn's input.
struct TurnInput<'a> {
    thread: &'a str,
    text: &'a str,
}

async fn begin_turn(
    rpc: &mut Rpc,
    input: TurnInput<'_>,
    run_id: u64,
    mode: InteractionMode,
    approvals: &mut Approvals,
    updates: &watch::Sender<Snapshot>,
    controls: Option<&mut mpsc::Receiver<Control>>,
) -> Result<Option<(String, Vec<Value>)>, String> {
    approvals.prepare_turn(input.thread, run_id);
    let response = rpc
        .request_controlled(
            "turn/start",
            policy::turn_start(input.thread, input.text, mode),
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
    mutate(updates, |s| {
        if s.run_id != run_id {
            return;
        }
        s.error = None;
        s.messages.push(ChatMessage {
            id: format!("{run_id}:user"),
            role: "user".into(),
            text: input.text.to_owned(),
        });
        s.messages.push(ChatMessage {
            id: format!("{run_id}:assistant"),
            role: "assistant".into(),
            text: String::new(),
        });
        if s.messages.len() > 24 {
            s.messages.drain(0..2);
        }
        // An approval raised during turn/start already owns the visible state;
        // resuming streaming here would drop the card while the provider waits.
        if s.status == "approvalRequired" {
            return;
        }
        s.status = "streaming".into();
        s.activity = None;
        s.approval = None;
    });
    Ok(Some((turn, buffered)))
}

// Records a decision reply; a rejected decision keeps the pending approval
// visible rather than resuming work the user did not authorize.
async fn resolve_approval(
    rpc: &mut Rpc,
    approvals: &mut Approvals,
    approval_id: &str,
    decision: ApprovalDecision,
    updates: &watch::Sender<Snapshot>,
) {
    if let Some(reply) = approvals.decide(approval_id, decision) {
        let _ = rpc.send(reply).await;
    } else {
        publish_approval(approvals, updates);
    }
}

fn terminal_after_stop() -> &'static str {
    "stopped"
}

pub async fn run(
    mut controls: mpsc::Receiver<Control>,
    updates: watch::Sender<Snapshot>,
    initial: Control,
    mode: InteractionMode,
) {
    let Control::Ask { text, cwd, run_id } = initial else {
        return;
    };
    let mut approvals = Approvals::for_mode(mode, run_id);
    let mut rpc = match Rpc::launch(&cwd) {
        Ok(rpc) => rpc,
        Err(e) => {
            fail(&updates, run_id, &e);
            return;
        }
    };
    // Before the first turn exists, only Stop is legal. Approval cannot be
    // pending until turn/start; during turn/start the request reader handles it.
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
            mutate(&updates, |s| s.thread_id = Some(thread.clone()));
            Ok::<_, String>(thread)
        } => result,
        command = controls.recv() => {
            // No user decision can be pending before a turn has started.
            if !matches!(command, Some(Control::Stop)) {
                fail(&updates, run_id, "Unexpected Codex control during initialization.");
            } else {
                mutate(&updates, |s| {
                    if s.run_id == run_id {
                        s.status = terminal_after_stop().into();
                        s.approval = None;
                    }
                });
            }
            rpc.terminate().await;
            return;
        }
    };
    let thread = match result {
        Ok(thread) => thread,
        Err(error) => {
            fail(&updates, run_id, &error);
            rpc.terminate().await;
            return;
        }
    };
    // begin_turn binds the thread/run before turn/start, even before the ack.
    let (mut turn, buffered) = match begin_turn(
        &mut rpc,
        TurnInput {
            thread: &thread,
            text: &text,
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
            mutate(&updates, |s| {
                if s.run_id == run_id {
                    s.status = "stopped".into();
                    s.approval = None;
                    s.activity = None;
                }
            });
            rpc.terminate().await;
            return;
        }
        Err(error) => {
            fail(&updates, run_id, &error);
            rpc.terminate().await;
            return;
        }
    };
    let mut active = Some(run_id);
    for msg in buffered {
        if handle_event(&msg, &thread, &turn, run_id, &updates) {
            active = None;
        }
    }

    loop {
        tokio::select! {
            command = controls.recv() => match command {
                Some(Control::Close { claimed, finished }) => {
                    // A timed-out reset must not terminate a previous session
                    // after the caller has been told that no reset occurred.
                    // The atomic claim arbitrates the race with the timeout.
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
                        mutate(&updates, |s| {
                            if s.run_id == id && !matches!(s.status.as_str(), "completed" | "failed") {
                                s.status = "stopped".into();
                                s.approval = None;
                                s.activity = None;
                            }
                        });
                        rpc.terminate().await;
                        break;
                    }
                }
                Some(Control::Decide { approval_id, decision }) => {
                    resolve_approval(&mut rpc, &mut approvals, &approval_id, decision, &updates).await;
                }
                Some(Control::Ask { text, cwd, run_id }) if active.is_none() => {
                    if cwd.as_path() != std::path::Path::new(&updates.borrow().cwd) {
                        fail(&updates, run_id, "Working context changed. Restart Otto.");
                        continue;
                    }
                    // Reuse the same single-reader control path as the first turn.
                    // While turn/start is pending, approvals and Stop remain live;
                    // a decision is never mistaken for a closed control channel.
                    match begin_turn(
                        &mut rpc,
                        TurnInput { thread: &thread, text: &text },
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
                                }
                            }
                        }
                        Ok(None) => {
                            mutate(&updates, |s| {
                                if s.run_id == run_id {
                                    s.status = "stopped".into();
                                    s.approval = None;
                                    s.activity = None;
                                }
                            });
                            rpc.terminate().await;
                            break;
                        }
                        Err(error) => {
                            fail(&updates, run_id, &error);
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
                            if let Some(id) = active { fail(&updates, id, "Invalid Codex stream."); }
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
                                if let Some(id) = active { fail(&updates, id, "Cannot answer unsupported Codex request."); }
                                rpc.terminate().await;
                                break;
                            }
                        } else if let Some(id) = active
                            && handle_event(&msg, &thread, &turn, id, &updates)
                        {
                            active = None;
                        }
                    }
                    _ => {
                        if let Some(id) = active { fail(&updates, id, "Codex disconnected."); }
                        break;
                    }
                }
            }
        }
    }

    // A follow-up may have been accepted just before the transport closed.
    // Never leave the visible run indefinitely in "starting" or "streaming".
    let state = updates.borrow().clone();
    match state.status.as_str() {
        "starting" | "streaming" | "approvalRequired" => fail(
            &updates,
            state.run_id,
            "Codex connection closed before the answer finished.",
        ),
        "stopping" => mutate(&updates, |s| {
            s.status = "stopped".into();
            s.approval = None;
        }),
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn model_capability_is_gated_by_the_default_model() {
        let ready = model_readiness(&json!({ "data": [
            { "isDefault": false, "inputModalities": ["text", "image"] },
            { "isDefault": true, "inputModalities": ["text"] }
        ] }));
        assert_eq!(ready.status, "ready");
        assert!(!ready.image_input);

        let image = model_readiness(&json!({ "data": [
            { "isDefault": true, "inputModalities": ["text", "image"] }
        ] }));
        assert_eq!(image.status, "ready");
        assert!(image.image_input);

        for invalid in [
            json!({}),
            json!({ "data": [] }),
            json!({ "data": [{ "isDefault": true, "inputModalities": ["image"] }] }),
        ] {
            let value = model_readiness(&invalid);
            assert_ne!(value.status, "ready");
            assert!(!value.image_input);
        }
        // Old catalogs may omit input modalities; never claim image support.
        let legacy = model_readiness(&json!({ "data": [{ "isDefault": true }] }));
        assert_eq!(legacy.status, "ready");
        assert!(!legacy.image_input);
    }

    fn snapshot(status: &str, run_id: u64) -> watch::Sender<Snapshot> {
        let (tx, _) = watch::channel(Snapshot {
            run_id,
            seq: 1,
            status: status.into(),
            mode: "agentSession".into(),
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
            &tx,
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
        assert!(handle_event(&completed, "thread", "turn", 7, &tx));
        assert_eq!(tx.borrow().status, "stopped");
        let late = json!({
            "method": "item/agentMessage/delta",
            "params": { "threadId": "thread", "turnId": "turn", "delta": "late" }
        });
        handle_event(&late, "thread", "turn", 7, &tx);
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
        publish_approval(&approvals, &tx);
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
        // turn/start can be in flight when the first approval arrives; the
        // thread is already pinned, so it must not be discarded.
        let mut approvals = Approvals::for_mode(InteractionMode::AgentSession, 9);
        approvals.thread = Some("thread".into());
        assert!(matches!(
            approvals.parse(&command_request(1, "thread", "turn")),
            ServerRequest::Recorded
        ));
    }

    #[test]
    fn approval_during_turn_start_is_published() {
        // Faithful window: thread/start already ran, but turn/start has NOT
        // returned yet, so context() has not set the turn id.
        let mut approvals = Approvals::for_mode(InteractionMode::AgentSession, 9);
        approvals.thread = Some("thread".into());
        let tx = snapshot("streaming", 9);
        assert!(matches!(
            approvals.parse(&command_request(1, "thread", "turn")),
            ServerRequest::Recorded
        ));
        publish_approval(&approvals, &tx);
        assert_eq!(
            tx.borrow().status,
            "approvalRequired",
            "an approval raised before turn/start returns must reach the UI"
        );
    }

    #[test]
    fn quick_ask_rejects_non_approval_server_requests_with_an_error() {
        // Quick Ask is read-only. A non-approval server request (e.g.
        // tool/requestUserInput) must get a proper JSON-RPC error, exactly as
        // the previous adapter did, not an approval-shaped "decline" result.
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
        // Design transitions tool -> streaming. In production both phases share
        // status "streaming", so the tool activity must clear when the answer
        // text resumes; otherwise the header stays stuck on "Using tool".
        let tx = snapshot("streaming", 3);
        handle_item_started(
            &json!({
                "method": "item/started",
                "params": { "threadId": "thread", "turnId": "turn",
                    "item": { "type": "commandExecution", "command": "cargo test" } }
            }),
            3,
            &tx,
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
            &tx,
        );
        assert!(
            tx.borrow().activity.is_none(),
            "tool activity must clear once the answer text streams"
        );
    }

    #[test]
    fn quick_ask_never_records_or_shows_an_approval() {
        // Codex must not prompt in Quick Ask; if it does, the adapter declines
        // it and never publishes a pending approval to the UI.
        let mut approvals = Approvals::for_mode(InteractionMode::QuickAsk, 9);
        approvals.context("thread", "turn", 9);
        let request = command_request(1, "thread", "turn");
        assert!(matches!(approvals.parse(&request), ServerRequest::Decline));
        assert!(approvals.pending.is_none());
        let tx = snapshot("streaming", 9);
        publish_approval(&approvals, &tx);
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
        // A second concurrent request must never be auto-approved.
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
    fn decision_encodes_exact_provider_verb_and_rejects_stale_ids() {
        let mut approvals = Approvals::for_mode(InteractionMode::AgentSession, 9);
        approvals.context("thread", "turn", 9);
        approvals.parse(&command_request(1, "thread", "turn"));
        // Stale id: nothing is forwarded and the request is still owned.
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
        // A duplicate decision cannot resolve the same request twice.
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
            &tx,
        );
        assert_eq!(tx.borrow().activity.as_ref().unwrap().summary, "cargo test");
        // Non-tool items and non-streaming runs never fabricate activity.
        handle_item_started(
            &json!({ "method": "item/started", "params": { "item": { "type": "agentMessage" } } }),
            3,
            &tx,
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
        assert!(handle_event(&interrupted, "thread", "turn", 7, &tx));
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

        publish_approval(&approvals, &updates);
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
            &updates,
        )
        .expect("decision must remain available before the ack");
        let StartupControl::Reply(reply) = action else {
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
        drop(receiver); // Same cancellation observed when New Session times out.
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
        publish_approval(&approvals, &tx);
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
            &tx,
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
        assert!(matches!(
            classify_startup_control(Some(Control::Stop), &mut approvals, &tx).unwrap(),
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
            &tx,
        )
        .unwrap();
        assert!(matches!(action, StartupControl::Continue));
        assert!(approvals.pending.is_some());
        assert_eq!(tx.borrow().status, "approvalRequired");
    }
}
