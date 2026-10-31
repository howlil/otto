mod policy;
mod providers;

use serde::Serialize;
use std::{path::PathBuf, sync::atomic::{AtomicU64, Ordering}};
use tauri::ipc::Channel;
use tokio::sync::{mpsc, watch, Mutex};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub role: String,
    pub text: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub run_id: u64,
    pub seq: u64,
    pub status: String,
    pub cwd: String,
    pub thread_id: Option<String>,
    pub messages: Vec<ChatMessage>,
    pub error: Option<String>,
}

pub enum Control {
    Ask { text: String, cwd: PathBuf, run_id: u64 },
    Stop,
}

pub struct AgentRuntime {
    updates: watch::Sender<Snapshot>,
    control: Mutex<Option<mpsc::Sender<Control>>>,
    next_run_id: AtomicU64,
}

impl AgentRuntime {
    pub fn new() -> Self {
        let cwd = std::env::current_dir()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default();
        let (updates, _) = watch::channel(Snapshot {
            run_id: 0,
            seq: 0,
            status: "idle".into(),
            cwd,
            thread_id: None,
            messages: Vec::new(),
            error: None,
        });
        Self { updates, control: Mutex::new(None), next_run_id: AtomicU64::new(0) }
    }

    pub fn snapshot(&self) -> Snapshot {
        self.updates.borrow().clone()
    }

    pub fn subscribe(&self, channel: Channel<Snapshot>) {
        let mut rx = self.updates.subscribe();
        tauri::async_runtime::spawn(async move {
            if channel.send(rx.borrow_and_update().clone()).is_err() { return; }
            while rx.changed().await.is_ok() {
                if channel.send(rx.borrow_and_update().clone()).is_err() { break; }
            }
        });
    }

    pub fn codex_installed(&self) -> bool {
        providers::codex::executable().is_some()
    }

    pub async fn ask(&self, text: String, cwd: String) -> Result<(), String> {
        let text = text.trim().to_owned();
        if text.is_empty() || text.len() > 12_000 {
            return Err("Enter a question (up to 12,000 bytes).".into());
        }
        let cwd = std::fs::canonicalize(cwd)
            .map_err(|_| "Working folder does not exist.".to_string())?;
        if !cwd.is_dir() { return Err("Working context must be a folder.".into()); }
        if !self.codex_installed() {
            return Err("Codex executable not found. Install Codex CLI, then retry.".into());
        }
        let mut guard = self.control.lock().await;
        let current = self.snapshot();
        if matches!(current.status.as_str(), "starting" | "streaming" | "stopping") {
            return Err("An answer is already running.".into());
        }
        if let Some(sender) = guard.as_ref().filter(|tx| !tx.is_closed()) {
            if PathBuf::from(&current.cwd) != cwd {
                return Err("Working context is fixed for this conversation. Restart Otto to change it.".into());
            }
            let run_id = self.next_run_id.fetch_add(1, Ordering::Relaxed) + 1;
            sender.try_send(Control::Ask { text, cwd, run_id })
                .map_err(|_| "Codex is busy. Try again.".to_string())?;
            mutate(&self.updates, |s| { s.run_id = run_id; s.status = "starting".into(); s.error = None; });
            return Ok(());
        }
        let run_id = self.next_run_id.fetch_add(1, Ordering::Relaxed) + 1;
        mutate(&self.updates, |s| {
            s.run_id = run_id;
            s.status = "starting".into();
            s.error = None;
            s.cwd = cwd.to_string_lossy().into_owned();
            s.thread_id = None;
            s.messages.clear();
        });
        let (tx, rx) = mpsc::channel(4);
        let updates = self.updates.clone();
        tauri::async_runtime::spawn(async move {
            providers::codex::run(rx, updates.clone(), Control::Ask { text, cwd, run_id }).await;
        });
        *guard = Some(tx);
        Ok(())
    }

    pub async fn stop(&self) -> Result<(), String> {
        let sender = self.control.lock().await.clone();
        if !matches!(self.snapshot().status.as_str(), "starting" | "streaming") {
            return Err("No active Codex turn.".into());
        }
        let sender = sender.ok_or("No active Codex process.")?;
        sender.try_send(Control::Stop).map_err(|_| "Codex is busy; retry Stop.".to_string())?;
        mutate(&self.updates, |s| s.status = "stopping".into());
        Ok(())
    }
}

pub(crate) fn mutate(updates: &watch::Sender<Snapshot>, action: impl FnOnce(&mut Snapshot)) {
    updates.send_modify(|snapshot| {
        action(snapshot);
        snapshot.seq = snapshot.seq.saturating_add(1);
    });
}

pub(crate) fn fail(updates: &watch::Sender<Snapshot>, run_id: u64, message: &str) {
    mutate(updates, |s| {
        if s.run_id == run_id && s.status != "stopped" && s.status != "completed" {
            s.status = "failed".into();
            s.error = Some(message.to_owned());
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn old_run_cannot_replace_new_terminal_state() {
        let (tx, _) = watch::channel(Snapshot {
            run_id: 2, seq: 4, status: "completed".into(), cwd: String::new(),
            thread_id: None, messages: vec![], error: None,
        });
        fail(&tx, 1, "late failure");
        assert_eq!(tx.borrow().status, "completed");
        assert_eq!(tx.borrow().error, None);
    }
}
