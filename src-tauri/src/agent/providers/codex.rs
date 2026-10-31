use crate::agent::policy::{self, InteractionMode};
use crate::agent::session::{self, ApprovalDecision, PendingApproval, ToolActivity};
use crate::agent::{ChatMessage, Control, Snapshot, fail, mutate};
use serde_json::{Value, json};
use std::{path::PathBuf, process::Stdio, time::Duration};
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

    fn context(&mut self, thread: &str, turn: &str, run_id: u64) {
        self.thread = Some(thread.to_owned());
        self.turn = Some(turn.to_owned());
        self.run_id = run_id;
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
        if let Some(turn) = self.turn.as_deref()
            && params["turnId"].as_str() != Some(turn)
        {
            return ServerRequest::Decline;
        }
        let built = match method {
            "item/commandExecution/requestApproval" => Some(("command", "Run command", {
                let command = params["command"].as_str().unwrap_or("a shell command");
                let cwd = params["cwd"].as_str().unwrap_or("");
                if cwd.is_empty() {
                    command.to_owned()
                } else {
                    format!("{command}\n(cwd: {cwd})")
                }
            })),
            "item/fileChange/requestApproval" => Some(("fileChange", "Change files", {
                let root = params["grantRoot"].as_str().unwrap_or("the workspace");
                format!("Modify files under {root}")
            })),
            // permissions/requestApproval, legacy exec/patch approvals, and any
            // future approval method carry a wider contract than this slice.
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

    // Notifications and approval requests emitted before the response are
    // handled here, not silently discarded. Exactly one reader owns stdout.
    async fn request(
        &mut self,
        method: &str,
        params: Value,
        approvals: &mut Approvals,
        updates: &watch::Sender<Snapshot>,
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

async fn begin_turn(
    rpc: &mut Rpc,
    thread: &str,
    text: &str,
    run_id: u64,
    mode: InteractionMode,
    approvals: &mut Approvals,
    updates: &watch::Sender<Snapshot>,
) -> Result<(String, Vec<Value>), String> {
    let (result, buffered) = rpc
        .request(
            "turn/start",
            policy::turn_start(thread, text, mode),
            approvals,
            updates,
        )
        .await?;
    let turn = result
        .pointer("/turn/id")
        .and_then(Value::as_str)
        .ok_or("Codex returned no turn ID.")?
        .to_owned();
    approvals.context(thread, &turn, run_id);
    mutate(updates, |s| {
        if s.run_id != run_id {
            return;
        }
        s.error = None;
        s.messages.push(ChatMessage {
            id: format!("{run_id}:user"),
            role: "user".into(),
            text: text.to_owned(),
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
    Ok((turn, buffered))
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
    // Allow Stop to cancel initialization/auth checks before the first turn exists.
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
            let (turn, buffered) = begin_turn(&mut rpc, &thread, &text, run_id, mode, &mut approvals, &updates).await?;
            Ok::<_, String>((thread, turn, buffered))
        } => result,
        _ = controls.recv() => {
            mutate(&updates, |s| {
                if s.run_id == run_id { s.status = terminal_after_stop().into(); }
            });
            rpc.terminate().await;
            return;
        }
    };
    let (thread, mut turn, buffered) = match result {
        Ok(value) => value,
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
                    // A follow-up can be waiting for turn/start to acknowledge while
                    // the user presses Stop. The control receiver must remain live.
                    enum FollowUp {
                        Started(Result<(String, Vec<Value>), String>),
                        Stop,
                        Closed,
                    }
                    let outcome = tokio::select! {
                        result = begin_turn(&mut rpc, &thread, &text, run_id, mode, &mut approvals, &updates) => FollowUp::Started(result),
                        command = controls.recv() => match command {
                            Some(Control::Stop) => FollowUp::Stop,
                            _ => FollowUp::Closed,
                        },
                    };
                    match outcome {
                        FollowUp::Started(Ok((new_turn, buffered))) => {
                            turn = new_turn;
                            active = Some(run_id);
                            for msg in buffered {
                                if handle_event(&msg, &thread, &turn, run_id, &updates) { active = None; }
                            }
                        }
                        FollowUp::Started(Err(error)) => {
                            fail(&updates, run_id, &error);
                            rpc.terminate().await;
                            break;
                        }
                        FollowUp::Stop => {
                            mutate(&updates, |s| {
                                if s.run_id == run_id && s.status == "stopping" {
                                    s.status = "stopped".into();
                                }
                            });
                            rpc.terminate().await;
                            break;
                        }
                        FollowUp::Closed => {
                            fail(&updates, run_id, "Codex control channel closed.");
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
}
