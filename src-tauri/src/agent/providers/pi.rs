use super::job::Job;
use crate::agent::{ChatMessage, Control, ProviderReadiness, Snapshot, fail, mutate};
use serde_json::{Value, json};
use std::{
    path::{Path, PathBuf},
    process::Stdio,
    sync::atomic::Ordering,
    time::Duration,
};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines},
    process::{Child, ChildStdin, ChildStdout, Command},
    sync::{mpsc, watch},
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
}

impl Rpc {
    fn launch(cwd: &Path) -> Result<Self, String> {
        let binary = executable().ok_or("Pi CLI was not found in PATH.")?;
        let mut command = Command::new(binary);
        command
            .args(launch_args())
            .current_dir(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        let mut child = command.spawn().map_err(|_| "Cannot launch Pi RPC mode.")?;
        let job = match child.id().and_then(|pid| Job::attach(pid).ok()) {
            Some(job) => job,
            None => {
                let _ = child.start_kill();
                return Err("Cannot isolate the Pi process tree.".into());
            }
        };
        let stdin = child.stdin.take().ok_or("Pi stdin unavailable.")?;
        let stdout = child.stdout.take().ok_or("Pi stdout unavailable.")?;
        Ok(Self {
            job,
            child,
            stdin,
            stdout: BufReader::new(stdout).lines(),
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

    async fn state(&mut self) -> Result<Value, String> {
        self.send(json!({"id":"otto-state","type":"get_state"}))
            .await?;
        timeout(Duration::from_secs(8), async {
            loop {
                let frame = self.read().await?;
                if frame["type"] == "response" && frame["id"] == "otto-state" {
                    if frame["command"] != "get_state" || frame["success"] != true {
                        return Err("Pi could not confirm RPC state.".into());
                    }
                    return Ok(frame["data"].clone());
                }
            }
        })
        .await
        .map_err(|_| "Pi RPC state timed out.".to_string())?
    }

    async fn terminate(&mut self) {
        self.job.terminate();
        let _ = timeout(Duration::from_secs(3), self.child.wait()).await;
        let _ = self.child.start_kill();
    }
}

fn model_identity(state: &Value) -> Option<String> {
    let model = &state["model"];
    let (provider, id) = (model["provider"].as_str()?, model["id"].as_str()?);
    if provider.is_empty()
        || id.is_empty()
        || !model["input"].as_array()?.iter().any(|part| part == "text")
    {
        return None;
    }
    Some(format!("{provider}/{id}"))
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

pub async fn readiness(cwd: &PathBuf) -> ProviderReadiness {
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
    let model = rpc
        .state()
        .await
        .ok()
        .and_then(|state| model_identity(&state));
    rpc.terminate().await;
    let Some(model) = model else {
        return ProviderReadiness::new(
            "unsupported",
            "Pi has no confirmed text model or RPC support.",
            "Choose a Pi model or update Pi, then Retry.",
        );
    };
    let mut command = Command::new(binary);
    command
        .args(["auth", "check", "--model", &model, "--json"])
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    match timeout(Duration::from_secs(10), command.output()).await {
        Ok(Ok(output)) => match serde_json::from_slice::<Value>(&output.stdout) {
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
    }
}

fn accepted_prompt(frame: &Value, run_id: u64) -> Result<bool, String> {
    if frame["type"] != "response" || frame["id"] != format!("otto-{run_id}") {
        return Ok(false);
    }
    if frame["command"] != "prompt"
        || frame["success"] != true
        || frame["data"]["disposition"] != "started"
    {
        return Err("Pi rejected the requested turn.".into());
    }
    Ok(true)
}

fn begin(text: &str, run_id: u64, updates: &watch::Sender<Snapshot>) {
    mutate(updates, |s| {
        if s.run_id != run_id {
            return;
        }
        s.status = "streaming".into();
        s.error = None;
        s.activity = None;
        s.approval = None;
        s.messages.push(ChatMessage {
            id: format!("{run_id}:user"),
            role: "user".into(),
            text: text.into(),
        });
        s.messages.push(ChatMessage {
            id: format!("{run_id}:assistant"),
            role: "assistant".into(),
            text: String::new(),
        });
        if s.messages.len() > 24 {
            s.messages.drain(0..2);
        }
    });
}

fn observe(frame: &Value, id: u64, updates: &watch::Sender<Snapshot>) -> bool {
    let snapshot = updates.borrow().clone();
    if snapshot.run_id != id || snapshot.status != "streaming" {
        return false;
    }
    match frame["type"].as_str() {
        Some("message_update") if frame["assistantMessageEvent"]["type"] == "text_delta" => {
            if let Some(delta) = frame["assistantMessageEvent"]["delta"].as_str() {
                mutate(updates, |s| {
                    if let Some(last) = s
                        .messages
                        .last_mut()
                        .filter(|item| item.role == "assistant")
                    {
                        last.text.push_str(delta);
                    }
                });
            }
        }
        Some("message_end") if frame["message"]["role"] == "assistant" => {
            if matches!(
                frame["message"]["stopReason"].as_str(),
                Some("error" | "aborted")
            ) {
                fail(updates, id, "Pi could not finish the answer.");
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
                mutate(updates, |s| {
                    if let Some(last) = s
                        .messages
                        .last_mut()
                        .filter(|item| item.role == "assistant")
                    {
                        last.text = answer;
                    }
                });
            }
        }
        Some("agent_settled") => {
            if frame["aborted"] == true {
                fail(updates, id, "Pi aborted the request.");
            } else if snapshot
                .messages
                .last()
                .is_none_or(|item| item.role != "assistant" || item.text.trim().is_empty())
            {
                fail(updates, id, "Pi finished without an answer.");
            } else {
                mutate(updates, |s| {
                    if s.run_id == id && s.status == "streaming" {
                        s.status = "completed".into();
                        s.activity = None;
                    }
                });
            }
            return true;
        }
        _ => {}
    }
    false
}

pub async fn run(
    mut controls: mpsc::Receiver<Control>,
    updates: watch::Sender<Snapshot>,
    initial: Control,
) {
    let Control::Ask {
        text,
        cwd,
        run_id,
        capture: None,
    } = initial
    else {
        fail(
            &updates,
            updates.borrow().run_id,
            "Pi only supports text Quick Ask.",
        );
        return;
    };
    let mut rpc = match Rpc::launch(&cwd) {
        Ok(rpc) => rpc,
        Err(reason) => {
            fail(&updates, run_id, &reason);
            return;
        }
    };
    let state = tokio::select! {
        response = rpc.state() => response,
        control = controls.recv() => {
            if matches!(control, Some(Control::Stop)) {
                mutate(&updates, |s| if s.run_id == run_id { s.status = "stopped".into(); });
            } else {
                fail(&updates, run_id, "Pi startup interrupted.");
            }
            rpc.terminate().await;
            return;
        }
    };
    let Some(session) = state.ok().and_then(|s| {
        model_identity(&s)?;
        s["sessionId"].as_str().map(str::to_owned)
    }) else {
        fail(&updates, run_id, "Pi session or text model is unavailable.");
        rpc.terminate().await;
        return;
    };
    mutate(&updates, |s| {
        if s.run_id == run_id {
            s.thread_id = Some(session);
        }
    });
    if rpc
        .send(json!({"type":"prompt","id":format!("otto-{run_id}"),"message":text}))
        .await
        .is_err()
    {
        fail(&updates, run_id, "Cannot submit the Pi request.");
        rpc.terminate().await;
        return;
    }
    let mut pending_text = text;
    let mut active = Some(run_id);
    let mut acknowledged = false;
    let mut settled = false;
    let mut buffered: Vec<Value> = Vec::new();
    loop {
        tokio::select! {
            control = controls.recv() => match control {
                Some(Control::Stop) if active.is_some() => {
                    let _ = rpc.send(json!({"type":"abort"})).await;
                    if let Some(id) = active {
                        mutate(&updates, |s| if s.run_id == id { s.status = "stopped".into(); });
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
                Some(Control::Ask {text, cwd, run_id, capture: None}) if active.is_none() => {
                    if cwd.as_path() != Path::new(&updates.borrow().cwd) {
                        fail(&updates, run_id, "Pi context changed. Start a new session.");
                        continue;
                    }
                    if rpc.send(json!({"type":"prompt","id":format!("otto-{run_id}"),"message":text})).await.is_err() {
                        fail(&updates, run_id, "Pi follow-up could not start.");
                        rpc.terminate().await;
                        break;
                    }
                    pending_text = text;
                    active = Some(run_id);
                    acknowledged = false;
                    settled = false;
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
                                fail(&updates, id, "Pi duplicated the prompt acknowledgement.");
                                rpc.terminate().await;
                                break;
                            }
                            acknowledged = true;
                            begin(&pending_text, id, &updates);
                            for event in buffered.drain(..) {
                                observe(&event, id, &updates);
                            }
                        },
                        Ok(false) => {},
                        Err(reason) => { fail(&updates, id, &reason); rpc.terminate().await; break; }
                    }
                    if value["type"] == "agent_settled" {
                        settled = true;
                        if !acknowledged {
                            buffered.push(value);
                        } else {
                            observe(&value, id, &updates);
                        }
                    } else if value["type"] == "message_update" || value["type"] == "message_end" {
                        if acknowledged {
                            observe(&value, id, &updates);
                        } else if buffered.len() < 256 {
                            buffered.push(value);
                        } else {
                            fail(&updates, id, "Pi sent excessive output before acknowledgement.");
                            rpc.terminate().await;
                            break;
                        }
                    } else if value["type"] == "tool_execution_start" || value["type"] == "extension_ui_request" {
                        fail(&updates, id, "Pi exposed an unsupported action.");
                        rpc.terminate().await;
                        break;
                    }
                    if acknowledged && settled {
                        active = None;
                    }

                }
                Err(reason) => {
                    if let Some(id) = active { fail(&updates, id, &reason); }
                    rpc.terminate().await;
                    break;
                }
            }
        }
    }
    let snapshot = updates.borrow().clone();
    if matches!(
        snapshot.status.as_str(),
        "starting" | "streaming" | "approvalRequired"
    ) {
        fail(
            &updates,
            snapshot.run_id,
            "Pi exited before completing the answer.",
        );
    } else if snapshot.status == "stopping" {
        mutate(&updates, |s| s.status = "stopped".into());
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
            messages: vec![ChatMessage {
                id: "7:assistant".into(),
                role: "assistant".into(),
                text: String::new(),
            }],
            activity: None,
            approval: None,
            error: None,
        });
        tx
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
        assert!(!observe(&json!({"type":"agent_end"}), 7, &tx));
        observe(
            &json!({"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"partial"}}),
            7,
            &tx,
        );
        assert_eq!(tx.borrow().messages[0].text, "partial");
        observe(
            &json!({"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"final"}]}}),
            7,
            &tx,
        );
        assert_eq!(tx.borrow().messages[0].text, "final");
        assert!(!observe(&json!({"type":"agent_settled"}), 6, &tx));
        assert!(observe(&json!({"type":"agent_settled"}), 7, &tx));
        assert_eq!(tx.borrow().status, "completed");
        observe(
            &json!({"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"late"}}),
            7,
            &tx,
        );
        assert_eq!(tx.borrow().messages[0].text, "final");
    }

    #[test]
    fn pi_failed_or_empty_answer_never_looks_completed() {
        let tx = state();
        assert!(observe(
            &json!({"type":"message_end","message":{"role":"assistant","stopReason":"error","content":[{"type":"text","text":"partial"}]}}),
            7,
            &tx,
        ));
        assert_eq!(tx.borrow().status, "failed");
        assert!(tx.borrow().messages[0].text.is_empty());
        assert!(!observe(
            &json!({"type":"agent_settled","aborted":false}),
            7,
            &tx
        ));
        assert_eq!(tx.borrow().status, "failed");

        let empty = state();
        assert!(observe(
            &json!({"type":"agent_settled","aborted":false}),
            7,
            &empty
        ));
        assert_eq!(empty.borrow().status, "failed");
        assert_eq!(
            empty.borrow().error.as_deref(),
            Some("Pi finished without an answer.")
        );

        let aborted = state();
        assert!(observe(
            &json!({"type":"agent_settled","aborted":true}),
            7,
            &aborted
        ));
        assert_eq!(aborted.borrow().status, "failed");
    }

    #[test]
    fn pi_prompt_ack_auth_and_model_gates_fail_closed() {
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
