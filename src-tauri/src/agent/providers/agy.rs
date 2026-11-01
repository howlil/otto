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

const AGENT_NAME: &str = "otto-quick-ask";
const AGENT_DEFINITION: &str = "---\nname: otto-quick-ask\ndescription: Tool-free text answers from Otto.\nmainAgent: true\nsubagent: false\ntools: []\ncommandExecutionPolicy: off\ninheritMcp: false\ninheritCustomizations: false\n---\nAnswer the user's question without executing tools or modifying any files.\n";

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
            _ => Err("An existing Agy agent profile conflicts with Otto. Resolve it before using Agy.".into()),
        };
    }
    let parent = file.parent().ok_or("Invalid Agy profile path.")?;
    std::fs::create_dir_all(parent).map_err(|_| "Cannot prepare the Otto Agy profile.")?;
    match std::fs::OpenOptions::new().write(true).create_new(true).open(&file) {
        Ok(mut output) => {
            use std::io::Write;
            output
                .write_all(AGENT_DEFINITION.as_bytes())
                .map_err(|_| "Cannot write the Otto Agy profile.".to_string())
        }
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            if std::fs::read_to_string(&file).ok().as_deref() == Some(AGENT_DEFINITION) {
                Ok(())
            } else {
                Err("Otto Agy profile was modified; refusing to replace it.".into())
            }
        }
        Err(_) => Err("Cannot create the Otto Agy profile.".into()),
    }
}

fn ensure_profile() -> Result<(), String> {
    let home = std::env::var_os("USERPROFILE").ok_or("Windows user profile is unavailable.")?;
    install_safe_agent(Path::new(&home))
}

fn launch_args() -> &'static [&'static str] {
    &[
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--agent",
        AGENT_NAME,
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
        let binary = executable().ok_or("Agy CLI was not found in PATH.")?;
        let mut command = Command::new(binary);
        command
            .args(launch_args())
            .current_dir(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        let mut child = command.spawn().map_err(|_| "Cannot start Agy stream-json mode.")?;
        let job = match child.id().and_then(|pid| Job::attach(pid).ok()) {
            Some(job) => job,
            None => {
                let _ = child.start_kill();
                return Err("Cannot isolate the Agy process tree.".into());
            }
        };
        let stdin = child.stdin.take().ok_or("Agy stdin unavailable.")?;
        let stdout = child.stdout.take().ok_or("Agy stdout unavailable.")?;
        Ok(Self {
            job,
            child,
            stdin,
            stdout: BufReader::new(stdout).lines(),
        })
    }

    async fn read(&mut self) -> Result<Value, String> {
        let line = self
            .stdout
            .next_line()
            .await
            .map_err(|_| "Agy stream failed.")?
            .ok_or("Agy disconnected.")?;
        if line.len() > 1_000_000 {
            return Err("Agy message exceeded the supported limit.".into());
        }
        serde_json::from_str(&line).map_err(|_| "Agy emitted invalid stream-json.".into())
    }

    async fn send(&mut self, prompt: &str) -> Result<(), String> {
        let mut message = serde_json::to_vec(&json!({
            "event": "user",
            "message": { "content": prompt }
        }))
        .map_err(|_| "Cannot serialize an Agy question.")?;
        message.push(b'\n');
        self.stdin
            .write_all(&message)
            .await
            .map_err(|_| "Agy input disconnected.")?;
        self.stdin
            .flush()
            .await
            .map_err(|_| "Agy input disconnected.".into())
    }

    async fn terminate(&mut self) {
        self.job.terminate();
        let _ = timeout(Duration::from_secs(3), self.child.wait()).await;
        let _ = self.child.start_kill();
    }
}

fn safe_init(frame: &Value) -> Result<String, String> {
    if frame["event"] != "init" || frame["init"]["agent"] != AGENT_NAME {
        return Err("Agy did not confirm Otto's tool-free agent profile.".into());
    }
    let Some(tools) = frame["init"]["tools"].as_array() else {
        return Err("Agy did not disclose its available tools.".into());
    };
    if tools.iter().any(|tool| tool.as_str() != Some("send_message")) {
        return Err("Agy exposed tools outside Otto's Quick Ask policy.".into());
    }
    let Some(session) = frame["conversation_id"].as_str().filter(|value| !value.is_empty()) else {
        return Err("Agy did not return a conversation identity.".into());
    };
    Ok(session.to_owned())
}

fn available_models(value: &Value) -> bool {
    let models = value.as_array().or_else(|| value["models"].as_array());
    models.is_some_and(|items| !items.is_empty())
}

pub async fn readiness(cwd: &PathBuf) -> ProviderReadiness {
    let Some(binary) = executable() else {
        return ProviderReadiness::new("missing", "Agy CLI was not found.", "Install Agy, then Retry.");
    };
    if let Err(reason) = ensure_profile() {
        return ProviderReadiness::new("unsupported", &reason, "Review Agy setup, then Retry.");
    }
    let mut command = Command::new(binary);
    command
        .args(["models", "--output-format", "json"])
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    match timeout(Duration::from_secs(12), command.output()).await {
        Ok(Ok(output)) if output.status.success() => {
            if !serde_json::from_slice::<Value>(&output.stdout)
                .ok()
                .is_some_and(|value| available_models(&value))
            {
                return ProviderReadiness::new(
                    "unsupported",
                    "Agy models could not be confirmed.",
                    "Update Agy and choose a text model, then Retry.",
                );
            }
        }
        Ok(Ok(_)) => {
            return ProviderReadiness::new(
                "authRequired",
                "Agy is not signed in or has no accessible model.",
                "Open Agy, sign in, then Retry.",
            );
        }
        _ => {
            return ProviderReadiness::new(
                "unavailable",
                "Agy model verification timed out or failed.",
                "Check the Agy installation, then Retry.",
            );
        }
    }
    let Ok(mut rpc) = Rpc::launch(cwd) else {
        return ProviderReadiness::new("unavailable", "Agy cannot start.", "Update Agy and Retry.");
    };
    let response = timeout(Duration::from_secs(20), rpc.read()).await;
    let confirmed = matches!(response, Ok(Ok(ref frame)) if safe_init(frame).is_ok());
    rpc.terminate().await;
    if confirmed {
        ProviderReadiness::new("ready", "Agy is ready for tool-free text.", "")
    } else {
        ProviderReadiness::new(
            "unsupported",
            "Agy did not confirm its tool-free agent profile.",
            "Update Agy or check Otto's agent profile, then Retry.",
        )
    }
}

fn begin(updates: &watch::Sender<Snapshot>, id: u64, text: &str) {
    mutate(updates, |s| {
        if s.run_id != id || s.status != "starting" {
            return;
        }
        s.status = "streaming".into();
        s.error = None;
        s.messages.push(ChatMessage {
            id: format!("{id}:user"),
            role: "user".into(),
            text: text.into(),
        });
        s.messages.push(ChatMessage {
            id: format!("{id}:assistant"),
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
    if snapshot.run_id != id || !matches!(snapshot.status.as_str(), "starting" | "streaming") {
        return false;
    }
    if frame["event"] == "step_update" {
        let step = &frame["step_update"];
        if step["step_type"] == "tool" {
            fail(updates, id, "Agy attempted an unsupported tool action.");
            return true;
        }
        if step["step_type"] == "agent_response"
            && let Some(delta) = step["text_delta"].as_str()
        {
            if snapshot.status == "starting" {
                fail(updates, id, "Agy returned output before the request was acknowledged.");
                return true;
            }
            mutate(updates, |s| {
                if let Some(last) = s.messages.last_mut().filter(|entry| entry.role == "assistant") {
                    last.text.push_str(delta);
                }
            });
        }
    }
    if frame["event"] == "result" {
        if frame["result"]["status"] != "SUCCESS" {
            fail(updates, id, "Agy could not finish this request.");
            return true;
        }
        let response = frame["result"]["response"].as_str().unwrap_or("");
        if response.trim().is_empty() {
            fail(updates, id, "Agy returned an empty answer.");
            return true;
        }
        mutate(updates, |s| {
            if s.run_id == id && s.status == "streaming" {
                if let Some(last) = s.messages.last_mut().filter(|entry| entry.role == "assistant") {
                    last.text = response.into();
                }
                s.status = "completed".into();
                s.activity = None;
            }
        });
        return true;
    }
    false
}

pub async fn run(
    mut controls: mpsc::Receiver<Control>,
    updates: watch::Sender<Snapshot>,
    initial: Control,
) {
    let Control::Ask { text, cwd, run_id, capture: None } = initial else {
        fail(&updates, updates.borrow().run_id, "Agy only supports tool-free text Quick Ask.");
        return;
    };
    if let Err(reason) = ensure_profile() {
        fail(&updates, run_id, &reason);
        return;
    }
    let mut rpc = match Rpc::launch(&cwd) {
        Ok(value) => value,
        Err(reason) => {
            fail(&updates, run_id, &reason);
            return;
        }
    };
    let init = tokio::select! {
        init = timeout(Duration::from_secs(20), rpc.read()) => init,
        action = controls.recv() => {
            if matches!(action, Some(Control::Stop)) {
                mutate(&updates, |s| if s.run_id == run_id { s.status = "stopped".into(); });
            } else {
                fail(&updates, run_id, "Agy startup interrupted.");
            }
            rpc.terminate().await;
            return;
        }
    };
    let session = match init {
        Ok(Ok(frame)) => match safe_init(&frame) {
            Ok(session) => session,
            Err(reason) => {
                fail(&updates, run_id, &reason);
                rpc.terminate().await;
                return;
            }
        },
        _ => {
            fail(&updates, run_id, "Agy startup did not confirm tool-free capabilities.");
            rpc.terminate().await;
            return;
        }
    };
    mutate(&updates, |s| if s.run_id == run_id { s.thread_id = Some(session); });
    if rpc.send(&text).await.is_err() {
        fail(&updates, run_id, "Agy rejected the prompt.");
        rpc.terminate().await;
        return;
    }
    let mut active = Some(run_id);
    let mut pending_text = text;
    let mut acknowledged = false;
    loop {
        tokio::select! {
            action = controls.recv() => match action {
                Some(Control::Stop) if active.is_some() => {
                    if let Some(id) = active {
                        mutate(&updates, |s| if s.run_id == id { s.status = "stopped".into(); });
                    }
                    rpc.terminate().await;
                    break;
                }
                Some(Control::Close { claimed, finished }) => {
                    if finished.is_closed() || claimed.swap(true, Ordering::SeqCst) { continue; }
                    rpc.terminate().await;
                    let _ = finished.send(());
                    break;
                }
                Some(Control::Ask {text, cwd, run_id, capture: None}) if active.is_none() => {
                    if cwd.as_path() != Path::new(&updates.borrow().cwd) {
                        fail(&updates, run_id, "Agy context changed. Start a new session.");
                        continue;
                    }
                    if rpc.send(&text).await.is_err() {
                        fail(&updates, run_id, "Agy follow-up could not start.");
                        rpc.terminate().await;
                        break;
                    }
                    active = Some(run_id);
                    pending_text = text;
                    acknowledged = false;
                }
                None => { rpc.terminate().await; break; }
                _ => {}
            },
            frame = rpc.read() => match frame {
                Ok(value) => {
                    let Some(id) = active else { continue; };
                    if value["event"] == "step_update"
                        && value["step_update"]["step_type"] == "user_input"
                    {
                        if !acknowledged {
                            acknowledged = true;
                            begin(&updates, id, &pending_text);
                        }
                        continue;
                    }
                    if value["event"] == "result" && !acknowledged {
                        acknowledged = true;
                        begin(&updates, id, &pending_text);
                    }
                    if value["event"] == "step_update"
                        && value["step_update"]["step_type"] == "agent_response"
                        && !acknowledged
                    {
                        fail(&updates, id, "Agy output arrived before request acceptance.");
                        rpc.terminate().await;
                        break;
                    }
                    if observe(&value, id, &updates) {
                        if updates.borrow().status == "failed" {
                            rpc.terminate().await;
                            break;
                        }
                        active = None;
                    }
                }
                Err(reason) => {
                    if let Some(id) = active {
                        fail(&updates, id, &reason);
                    }
                    rpc.terminate().await;
                    break;
                }
            }
        }
    }
    let snapshot = updates.borrow().clone();
    if matches!(snapshot.status.as_str(), "starting" | "streaming" | "approvalRequired") {
        fail(&updates, snapshot.run_id, "Agy terminated before completion.");
    } else if snapshot.status == "stopping" {
        mutate(&updates, |s| s.status = "stopped".into());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profile_is_tool_free_and_existing_config_is_not_overwritten() {
        let root = std::env::temp_dir().join(format!("otto-agy-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        install_safe_agent(&root).unwrap();
        assert_eq!(std::fs::read_to_string(agent_file(&root)).unwrap(), AGENT_DEFINITION);
        std::fs::write(agent_file(&root), "different config").unwrap();
        assert!(install_safe_agent(&root).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn tool_permissions_are_checked_before_any_prompt() {
        let safe = json!({"event":"init","conversation_id":"conversation-1","init":{"agent":"otto-quick-ask","tools":["send_message"]}});
        assert_eq!(safe_init(&safe).unwrap(), "conversation-1");
        assert!(safe_init(&json!({"event":"init","conversation_id":"conversation-1","init":{"agent":"otto-quick-ask","tools":["write_to_file"]}})).is_err());
        assert!(safe_init(&json!({"event":"init","conversation_id":"conversation-1","init":{"agent":"default","tools":[]}})).is_err());
        assert!(safe_init(&json!({"event":"init","conversation_id":"conversation-1","init":{}})).is_err());
    }

    #[test]
    fn model_catalog_must_be_nonempty() {
        assert!(available_models(&json!([{"id":"gemini"}])));
        assert!(available_models(&json!({"models":[{"id":"gemini"}]})));
        assert!(!available_models(&json!({"models":[]})));
        assert!(!available_models(&json!({"message":"auth required"})));
    }

    #[test]
    fn result_does_not_accept_failure_or_empty_response() {
        let (tx, _) = watch::channel(Snapshot {
            run_id: 7, seq: 0, status: "streaming".into(), mode: "quickAsk".into(),
            provider: "agy".into(), cwd: String::new(), thread_id: None,
            messages: vec![ChatMessage { id: "7:assistant".into(), role: "assistant".into(), text: String::new() }],
            activity: None, approval: None, error: None,
        });
        assert!(observe(&json!({"event":"result","result":{"status":"SUCCESS","response":""}}), 7, &tx));
        assert_eq!(tx.borrow().status, "failed");

        let (done, _) = watch::channel(Snapshot {
            run_id: 8, seq: 0, status: "streaming".into(), mode: "quickAsk".into(),
            provider: "agy".into(), cwd: String::new(), thread_id: None,
            messages: vec![ChatMessage { id: "8:assistant".into(), role: "assistant".into(), text: String::new() }],
            activity: None, approval: None, error: None,
        });
        assert!(observe(&json!({"event":"result","result":{"status":"SUCCESS","response":"answer"}}), 8, &done));
        assert_eq!(done.borrow().status, "completed");
        assert_eq!(done.borrow().messages[0].text, "answer");
        assert!(!observe(&json!({"event":"result","result":{"status":"SUCCESS","response":"late"}}), 7, &done));
    }
}
