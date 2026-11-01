use super::job::Job;
use crate::agent::events::{AgentEvent, ProviderEvents};
#[cfg(test)]
use crate::agent::{CaptureSnapshot, ChatMessage, Snapshot};
use crate::agent::{Control, ProviderReadiness};
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

const AGENT_NAME: &str = "otto-quick-ask";
const AGENT_DEFINITION: &str = "---\nname: otto-quick-ask\ndescription: Tool-free text answers from Otto.\nmainAgent: true\nsubagent: false\ntools: []\ncommandExecutionPolicy: \"off\"\ninheritMcp: false\ninheritCustomizations: false\n---\nAnswer the user's question without executing tools or modifying any files.\n";

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
    match std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&file)
    {
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
        let mut command = super::background_command(binary);
        command
            .args(launch_args())
            .current_dir(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        let mut child = command
            .spawn()
            .map_err(|_| "Cannot start Agy stream-json mode.")?;
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
    if tools
        .iter()
        .any(|tool| tool.as_str() != Some("send_message"))
    {
        return Err("Agy exposed tools outside Otto's Quick Ask policy.".into());
    }
    let Some(session) = frame["conversation_id"]
        .as_str()
        .filter(|value| !value.is_empty())
    else {
        return Err("Agy did not return a conversation identity.".into());
    };
    Ok(session.to_owned())
}

fn model_discovery_args() -> &'static [&'static str] {
    &["--output-format", "json", "models"]
}

fn available_models(value: &Value) -> bool {
    if value
        .get("status")
        .and_then(Value::as_str)
        .is_some_and(|status| status != "SUCCESS")
    {
        return false;
    }
    value
        .pointer("/command/data/models")
        .or_else(|| value.get("models"))
        .or_else(|| value.as_array().map(|_| value))
        .and_then(Value::as_array)
        .is_some_and(|models| !models.is_empty())
}

fn model_discovery_failure(stdout: &[u8], stderr: &[u8]) -> ProviderReadiness {
    let detail = format!(
        "{} {}",
        String::from_utf8_lossy(stdout),
        String::from_utf8_lossy(stderr)
    )
    .to_ascii_lowercase();
    if [
        "sign in",
        "sign-in",
        "not signed in",
        "log in",
        "login",
        "not authenticated",
        "authentication required",
        "unauthorized",
        "invalid credentials",
        "expired credentials",
    ]
    .iter()
    .any(|signal| detail.contains(signal))
    {
        ProviderReadiness::new(
            "authRequired",
            "Agy authentication is required.",
            "Sign in to Agy, then Retry.",
        )
    } else {
        ProviderReadiness::new(
            "unavailable",
            "Agy model discovery failed.",
            "Run agy --output-format json models in PowerShell, then Retry.",
        )
    }
}

pub async fn readiness(cwd: &PathBuf) -> ProviderReadiness {
    let Some(binary) = executable() else {
        return ProviderReadiness::new(
            "missing",
            "Agy CLI was not found.",
            "Install Agy, then Retry.",
        );
    };
    if let Err(reason) = ensure_profile() {
        return ProviderReadiness::new("unsupported", &reason, "Review Agy setup, then Retry.");
    }
    let mut command = super::background_command(binary);
    command
        .args(model_discovery_args())
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stderr(Stdio::piped())
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
        Ok(Ok(output)) => {
            return model_discovery_failure(&output.stdout, &output.stderr);
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

fn result_confirms_prompt(frame: &Value) -> bool {
    frame["event"] == "result" && frame["result"]["status"] == "SUCCESS"
}

fn begin(events: &ProviderEvents, id: u64, text: &str) {
    events.emit(AgentEvent::TurnStarted {
        run_id: id,
        text: text.to_owned(),
    });
}

fn observe(frame: &Value, id: u64, events: &ProviderEvents) -> bool {
    let snapshot = events.snapshot();
    if snapshot.run_id != id || !matches!(snapshot.status.as_str(), "starting" | "streaming") {
        return false;
    }
    if frame["event"] == "step_update" {
        let step = &frame["step_update"];
        if step["step_type"] == "tool" {
            events.fail(id, "Agy attempted an unsupported tool action.");
            return true;
        }
        if step["step_type"] == "agent_response"
            && let Some(delta) = step["text_delta"].as_str()
        {
            if snapshot.status == "starting" {
                events.fail(
                    id,
                    "Agy returned output before the request was acknowledged.",
                );
                return true;
            }
            events.emit(AgentEvent::TextDelta {
                run_id: id,
                delta: delta.to_owned(),
            });
        }
    }
    if frame["event"] == "result" {
        if frame["result"]["status"] != "SUCCESS" {
            events.fail(id, "Agy could not finish this request.");
            return true;
        }
        let response = frame["result"]["response"].as_str().unwrap_or("");
        if response.trim().is_empty() {
            events.fail(id, "Agy returned an empty answer.");
            return true;
        }
        events.emit(AgentEvent::TextFinal {
            run_id: id,
            text: response.to_owned(),
        });
        events.emit(AgentEvent::Completed { run_id: id });
        return true;
    }
    false
}

pub async fn run(mut controls: mpsc::Receiver<Control>, events: ProviderEvents, initial: Control) {
    let Control::Ask {
        text,
        cwd,
        run_id,
        capture: None,
        ..
    } = initial
    else {
        events.fail(
            events.snapshot().run_id,
            "Agy only supports tool-free text Quick Ask.",
        );
        return;
    };
    if let Err(reason) = ensure_profile() {
        events.fail(run_id, &reason);
        return;
    }
    let mut rpc = match Rpc::launch(&cwd) {
        Ok(value) => value,
        Err(reason) => {
            events.fail(run_id, &reason);
            return;
        }
    };
    let init = tokio::select! {
        init = timeout(Duration::from_secs(20), rpc.read()) => init,
        action = controls.recv() => {
            if matches!(action, Some(Control::Stop)) {
                events.stopped(run_id);
            } else {
                events.fail(run_id, "Agy startup interrupted.");
            }
            rpc.terminate().await;
            return;
        }
    };
    let session = match init {
        Ok(Ok(frame)) => match safe_init(&frame) {
            Ok(session) => session,
            Err(reason) => {
                events.fail(run_id, &reason);
                rpc.terminate().await;
                return;
            }
        },
        _ => {
            events.fail(
                run_id,
                "Agy startup did not confirm tool-free capabilities.",
            );
            rpc.terminate().await;
            return;
        }
    };
    events.emit(AgentEvent::SessionReady {
        run_id,
        session_id: session,
    });
    if rpc.send(&text).await.is_err() {
        events.fail(run_id, "Agy rejected the prompt.");
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
                        events.stopped(id);
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
                Some(Control::Ask {text, cwd, run_id, capture: None, ..}) if active.is_none() => {
                    if cwd.as_path() != Path::new(&events.snapshot().cwd) {
                        events.fail(run_id, "Agy context changed. Start a new session.");
                        continue;
                    }
                    if rpc.send(&text).await.is_err() {
                        events.fail(run_id, "Agy follow-up could not start.");
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
                            begin(&events, id, &pending_text);
                        }
                        continue;
                    }
                    if result_confirms_prompt(&value) && !acknowledged {
                        acknowledged = true;
                        begin(&events, id, &pending_text);
                    }
                    if value["event"] == "step_update"
                        && value["step_update"]["step_type"] == "agent_response"
                        && !acknowledged
                    {
                        events.fail(id, "Agy output arrived before request acceptance.");
                        rpc.terminate().await;
                        break;
                    }
                    if observe(&value, id, &events) {
                        if events.snapshot().status == "failed" {
                            rpc.terminate().await;
                            break;
                        }
                        active = None;
                    }
                }
                Err(reason) => {
                    if let Some(id) = active {
                        events.fail(id, &reason);
                    }
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
        events.fail(snapshot.run_id, "Agy terminated before completion.");
    } else if snapshot.status == "stopping" {
        events.stopped(snapshot.run_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn tool_permissions_are_checked_before_any_prompt() {
        let safe = json!({"event":"init","conversation_id":"conversation-1","init":{"agent":"otto-quick-ask","tools":["send_message"]}});
        assert_eq!(safe_init(&safe).unwrap(), "conversation-1");
        assert!(safe_init(&json!({"event":"init","conversation_id":"conversation-1","init":{"agent":"otto-quick-ask","tools":["write_to_file"]}})).is_err());
        assert!(safe_init(&json!({"event":"init","conversation_id":"conversation-1","init":{"agent":"default","tools":[]}})).is_err());
        assert!(
            safe_init(&json!({"event":"init","conversation_id":"conversation-1","init":{}}))
                .is_err()
        );
    }

    #[test]
    fn model_catalog_must_be_nonempty() {
        assert!(available_models(&json!([{"id":"gemini"}])));
        assert!(available_models(&json!({"models":[{"id":"gemini"}]})));
        assert!(available_models(&json!({
            "conversation_id": "",
            "status": "SUCCESS",
            "command": {
                "name": "models",
                "data": {
                    "models": [
                        {"id": "gemini-4-argon-medium", "label": "Gemini 4 Argon (Medium)"},
                        {"id": "claude-opus-5-5-high", "label": "Claude Opus 5.5 (High)"}
                    ]
                }
            }
        })));
        assert!(!available_models(&json!({"models":[]})));
        assert!(!available_models(
            &json!({"status":"ERROR","command":{"data":{"models":[{"id":"gemini"}]}}})
        ));
        assert!(!available_models(&json!({"message":"auth required"})));
    }

    #[test]
    fn model_discovery_uses_supported_global_flag_order() {
        assert_eq!(
            model_discovery_args(),
            &["--output-format", "json", "models"]
        );
    }

    #[test]
    fn model_discovery_does_not_misclassify_cli_errors_as_sign_in() {
        assert_eq!(
            model_discovery_failure(b"", b"error: unexpected argument --output-format").status,
            "unavailable"
        );
        assert_eq!(
            model_discovery_failure(b"", b"please sign in to continue").status,
            "authRequired"
        );
        assert_eq!(
            model_discovery_failure(b"login required", b"").status,
            "authRequired"
        );
    }

    #[test]
    fn failed_result_before_user_input_does_not_acknowledge_prompt() {
        assert!(!result_confirms_prompt(
            &json!({"event":"result","result":{"status":"ERROR","response":""}})
        ));
        assert!(result_confirms_prompt(
            &json!({"event":"result","result":{"status":"SUCCESS","response":"done"}})
        ));
        let (tx, _) = watch::channel(Snapshot {
            run_id: 9,
            seq: 0,
            status: "starting".into(),
            mode: "quickAsk".into(),
            provider: "agy".into(),
            cwd: String::new(),
            thread_id: None,
            model: None,
            thinking_effort: None,
            usage: None,
            messages: vec![],
            activity: None,
            approval: None,
            capture: CaptureSnapshot::default(),
            error: None,
        });
        let tx_events = ProviderEvents::new(tx.clone());
        assert!(observe(
            &json!({"event":"result","result":{"status":"ERROR","response":""}}),
            9,
            &tx_events
        ));
        assert_eq!(tx.borrow().status, "failed");
        assert!(tx.borrow().messages.is_empty());
    }

    #[test]
    fn result_does_not_accept_failure_or_empty_response() {
        let (tx, _) = watch::channel(Snapshot {
            run_id: 7,
            seq: 0,
            status: "streaming".into(),
            mode: "quickAsk".into(),
            provider: "agy".into(),
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
        let tx_events = ProviderEvents::new(tx.clone());
        assert!(observe(
            &json!({"event":"result","result":{"status":"SUCCESS","response":""}}),
            7,
            &tx_events
        ));
        assert_eq!(tx.borrow().status, "failed");

        let (done, _) = watch::channel(Snapshot {
            run_id: 8,
            seq: 0,
            status: "streaming".into(),
            mode: "quickAsk".into(),
            provider: "agy".into(),
            cwd: String::new(),
            thread_id: None,
            model: None,
            thinking_effort: None,
            usage: None,
            messages: vec![ChatMessage {
                id: "8:assistant".into(),
                role: "assistant".into(),
                text: String::new(),
            }],
            activity: None,
            approval: None,
            capture: CaptureSnapshot::default(),
            error: None,
        });
        let done_events = ProviderEvents::new(done.clone());
        assert!(observe(
            &json!({"event":"result","result":{"status":"SUCCESS","response":"answer"}}),
            8,
            &done_events
        ));
        assert_eq!(done.borrow().status, "completed");
        assert_eq!(done.borrow().messages[0].text, "answer");
        assert!(!observe(
            &json!({"event":"result","result":{"status":"SUCCESS","response":"late"}}),
            7,
            &done_events
        ));
    }
}
