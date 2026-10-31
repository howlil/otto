use crate::agent::{fail, mutate, ChatMessage, Control, Snapshot};
use crate::agent::policy;
use serde_json::{json, Value};
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
            if candidate.is_file() { return Some(candidate); }
        }
    }
    None
}

struct Rpc {
    child: Child,
    stdin: ChildStdin,
    stdout: Lines<BufReader<ChildStdout>>,
    next_id: u64,
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
        let stdin = child.stdin.take().ok_or("Codex stdin unavailable.")?;
        let stdout = child.stdout.take().ok_or("Codex stdout unavailable.")?;
        Ok(Self { child, stdin, stdout: BufReader::new(stdout).lines(), next_id: 0 })
    }

    async fn send(&mut self, value: Value) -> Result<(), String> {
        let mut json = serde_json::to_vec(&value).map_err(|_| "Cannot encode Codex request.")?;
        json.push(b'\n');
        self.stdin.write_all(&json).await.map_err(|_| "Codex connection closed.")?;
        self.stdin.flush().await.map_err(|_| "Codex connection closed.")
    }

    async fn read(&mut self) -> Result<Value, String> {
        let line = timeout(Duration::from_secs(45), self.stdout.next_line())
            .await.map_err(|_| "Codex did not respond in time.")?
            .map_err(|_| "Codex output failed.")?
            .ok_or("Codex process disconnected.")?;
        serde_json::from_str(&line).map_err(|_| "Invalid Codex protocol response.".into())
    }

    // Notifications emitted before the response are returned to the caller,
    // not silently discarded. Exactly one reader owns stdout.
    async fn request(&mut self, method: &str, params: Value) -> Result<(Value, Vec<Value>), String> {
        self.next_id += 1;
        let id = self.next_id;
        self.send(json!({ "id": id, "method": method, "params": params })).await?;
        let mut notifications = Vec::new();
        loop {
            let value = self.read().await?;
            if value.get("id").and_then(Value::as_u64) == Some(id) {
                if value.get("error").is_some() {
                    return Err(format!("Codex rejected {method}. Check installation, login and permissions."));
                }
                return Ok((value.get("result").cloned().unwrap_or(Value::Null), notifications));
            }
            // Never ignore server-initiated requests: reject them immediately.
            if value.get("id").is_some() && value.get("method").is_some() {
                self.deny_request(&value).await?;
            } else if notifications.len() < 2048 {
                notifications.push(value);
            } else {
                return Err("Codex emitted too many pending events.".into());
            }
        }
    }

    async fn deny_request(&mut self, request: &Value) -> Result<(), String> {
        let id = request.get("id").cloned().unwrap_or(Value::Null);
        let method = request["method"].as_str().unwrap_or_default();
        if method.ends_with("/requestApproval") || method == "execCommandApproval" || method == "applyPatchApproval" {
            self.send(json!({ "id": id, "result": { "decision": "decline" } })).await
        } else {
            self.send(json!({ "id": id, "error": { "code": -32601, "message": "Unsupported by Otto Quick Ask" } })).await
        }
    }

    async fn terminate(&mut self) {
        // On Windows, stop the owned wrapper and its child tree (npm may launch codex via .cmd).
        // A native Windows Job Object is still required for a crash-proof descendant guarantee.
        #[cfg(windows)]
        if let Some(pid) = self.child.id() {
            let _ = timeout(Duration::from_secs(3),
                Command::new("taskkill.exe")
                    .args(["/PID", &pid.to_string(), "/T", "/F"])
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .status()
            ).await;
        }
        let _ = self.child.kill().await;
        let _ = self.child.wait().await;
    }
}

fn is_for_turn(value: &Value, thread: &str, turn: &str) -> bool {
    value["params"]["threadId"].as_str() == Some(thread)
        && value["params"]["turnId"].as_str() == Some(turn)
}

fn handle_event(value: &Value, thread: &str, turn: &str, run_id: u64, updates: &watch::Sender<Snapshot>) -> bool {
    if !is_for_turn(value, thread, turn) { return false; }
    match value["method"].as_str() {
        Some("item/agentMessage/delta") => {
            if let Some(delta) = value["params"]["delta"].as_str() {
                mutate(updates, |s| {
                    if s.run_id != run_id || s.status != "streaming" { return; }
                    if let Some(message) = s.messages.last_mut().filter(|m| m.role == "assistant") {
                        if message.text.len().saturating_add(delta.len()) <= 128_000 {
                            message.text.push_str(delta);
                        }
                    }
                });
            }
        }
        Some("item/completed") => {
            let item = &value["params"]["item"];
            if item["type"].as_str() == Some("agentMessage") {
                if let Some(text) = item["text"].as_str() {
                    mutate(updates, |s| {
                        if s.run_id != run_id || s.status != "streaming" { return; }
                        if let Some(m) = s.messages.last_mut().filter(|m| m.role == "assistant") {
                            m.text = text.chars().take(128_000).collect();
                        }
                    });
                }
            }
        }
        Some("turn/completed") => {
            let status = value["params"]["turn"]["status"].as_str().unwrap_or("failed");
            mutate(updates, |s| {
                if s.run_id != run_id { return; }
                if matches!(s.status.as_str(), "completed" | "stopped" | "failed") { return; }
                s.status = match status {
                    _ if s.status == "stopping" => "stopped",
                    "completed" => "completed",
                    "interrupted" => "stopped",
                    _ => "failed",
                }.into();
                if s.status == "failed" { s.error = Some("Codex turn did not complete.".into()); }
            });
            return true;
        }
        _ => {}
    }
    false
}

async fn begin_turn(
    rpc: &mut Rpc, thread: &str, text: &str, run_id: u64,
    updates: &watch::Sender<Snapshot>,
) -> Result<(String, Vec<Value>), String> {
    let (result, buffered) = rpc.request("turn/start", policy::turn_start(thread, text)).await?;
    let turn = result.pointer("/turn/id").and_then(Value::as_str)
        .ok_or("Codex returned no turn ID.")?.to_owned();
    mutate(updates, |s| {
        if s.run_id != run_id { return; }
        s.status = "streaming".into();
        s.error = None;
        s.messages.push(ChatMessage { role: "user".into(), text: text.to_owned() });
        s.messages.push(ChatMessage { role: "assistant".into(), text: String::new() });
        if s.messages.len() > 24 { s.messages.drain(0..2); }
    });
    Ok((turn, buffered))
}

pub async fn run(mut controls: mpsc::Receiver<Control>, updates: watch::Sender<Snapshot>, initial: Control) {
    let Control::Ask { text, cwd, run_id } = initial else { return; };
    let mut rpc = match Rpc::launch(&cwd) {
        Ok(rpc) => rpc,
        Err(e) => { fail(&updates, run_id, &e); return; }
    };
    let result = async {
        rpc.request("initialize", json!({
            "clientInfo": { "name": "otto", "title": "Otto", "version": "0.1.0" }
        })).await?;
        rpc.send(json!({ "method": "initialized", "params": {} })).await?;
        let (thread_response, _) = rpc.request("thread/start", policy::thread_start(&cwd.to_string_lossy())).await?;
        if !policy::thread_is_read_only(&thread_response) {
            return Err("Codex cannot confirm read-only sandbox. Quick Ask is unavailable.".into());
        }
        let thread = thread_response.pointer("/thread/id").and_then(Value::as_str)
            .ok_or("Codex returned no thread ID.")?.to_owned();
        mutate(&updates, |s| s.thread_id = Some(thread.clone()));
        let (turn, buffered) = begin_turn(&mut rpc, &thread, &text, run_id, &updates).await?;
        Ok::<_, String>((thread, turn, buffered))
    }.await;
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
                            rpc.request("turn/interrupt", json!({ "threadId": thread, "turnId": turn }))
                        ).await;
                        mutate(&updates, |s| {
                            if s.run_id == id && !matches!(s.status.as_str(), "completed" | "failed") {
                                s.status = "stopped".into();
                            }
                        });
                        rpc.terminate().await;
                        break;
                    }
                }
                Some(Control::Ask { text, cwd, run_id }) if active.is_none() => {
                    if cwd != PathBuf::from(&updates.borrow().cwd) {
                        fail(&updates, run_id, "Working context changed. Restart Otto.");
                        continue;
                    }
                    match begin_turn(&mut rpc, &thread, &text, run_id, &updates).await {
                        Ok((new_turn, buffered)) => {
                            turn = new_turn;
                            active = Some(run_id);
                            for msg in buffered {
                                if handle_event(&msg, &thread, &turn, run_id, &updates) { active = None; }
                            }
                        }
                        Err(error) => { fail(&updates, run_id, &error); }
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
                            if rpc.deny_request(&msg).await.is_err() {
                                if let Some(id) = active { fail(&updates, id, "Cannot deny unsupported Codex request."); }
                                rpc.terminate().await;
                                break;
                            }
                        } else if let Some(id) = active {
                            if handle_event(&msg, &thread, &turn, id, &updates) { active = None; }
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
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unrelated_turn_cannot_append_output() {
        let (tx, _) = watch::channel(Snapshot {
            run_id: 5, seq: 1, status: "streaming".into(), cwd: String::new(),
            thread_id: None, messages: vec![ChatMessage { role: "assistant".into(), text: String::new() }],
            error: None,
        });
        handle_event(&json!({
            "method": "item/agentMessage/delta",
            "params": { "threadId": "other", "turnId": "turn", "delta": "bad" }
        }), "real", "turn", 5, &tx);
        assert!(tx.borrow().messages[0].text.is_empty());
    }

    #[test]
    fn stop_wins_race_against_completed_notification() {
        let (tx, _) = watch::channel(Snapshot {
            run_id: 7, seq: 1, status: "stopping".into(), cwd: String::new(),
            thread_id: Some("thread".into()),
            messages: vec![ChatMessage { role: "assistant".into(), text: String::new() }],
            error: None,
        });
        let completed = json!({
            "method": "turn/completed",
            "params": { "threadId": "thread", "turnId": "turn", "turn": { "status": "completed" } }
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
}
