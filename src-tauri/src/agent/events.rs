use super::session::{PendingApproval, ToolActivity};
use super::{CaptureSnapshot, ChatMessage, Snapshot, UsageSnapshot};
use tokio::sync::watch;

pub enum AgentEvent {
    SessionReady {
        run_id: u64,
        session_id: String,
    },
    RuntimeChanged {
        run_id: u64,
        model: Option<String>,
        thinking_effort: Option<String>,
    },
    UsageUpdated {
        run_id: u64,
        usage: UsageSnapshot,
    },
    TurnStarted {
        run_id: u64,
        text: String,
    },
    TextDelta {
        run_id: u64,
        delta: String,
    },
    TextFinal {
        run_id: u64,
        text: String,
    },
    ActivityChanged {
        run_id: u64,
        activity: ToolActivity,
    },
    ApprovalRequested {
        run_id: u64,
        approval: PendingApproval,
    },
    ApprovalResolved {
        run_id: u64,
        approval_id: String,
    },
    Completed {
        run_id: u64,
    },
    Failed {
        run_id: u64,
        message: String,
    },
    Stopped {
        run_id: u64,
    },
}

pub struct ProviderEvents {
    updates: watch::Sender<Snapshot>,
}

impl ProviderEvents {
    pub fn new(updates: watch::Sender<Snapshot>) -> Self {
        Self { updates }
    }

    pub fn snapshot(&self) -> Snapshot {
        self.updates.borrow().clone()
    }

    pub fn fail(&self, run_id: u64, message: &str) {
        self.emit(AgentEvent::Failed {
            run_id,
            message: message.to_owned(),
        });
    }

    pub fn stopped(&self, run_id: u64) {
        self.emit(AgentEvent::Stopped { run_id });
    }

    pub fn emit(&self, event: AgentEvent) {
        self.updates.send_modify(|state| {
            if reduce(state, event) {
                state.seq = state.seq.saturating_add(1);
            }
        });
    }
}

fn reduce(state: &mut Snapshot, event: AgentEvent) -> bool {
    match event {
        AgentEvent::SessionReady { run_id, session_id }
            if state.run_id == run_id
                && matches!(state.status.as_str(), "starting" | "approvalRequired") =>
        {
            state.thread_id = Some(session_id);
        }
        AgentEvent::RuntimeChanged {
            run_id,
            model,
            thinking_effort,
        } if state.run_id == run_id
            && !matches!(state.status.as_str(), "completed" | "stopped" | "failed") =>
        {
            state.model = model;
            state.thinking_effort = thinking_effort;
        }
        AgentEvent::UsageUpdated { run_id, usage }
            if state.run_id == run_id
                && !matches!(state.status.as_str(), "completed" | "stopped" | "failed") =>
        {
            state.usage = Some(usage);
        }
        AgentEvent::TurnStarted { run_id, text }
            if state.run_id == run_id
                && matches!(state.status.as_str(), "starting" | "approvalRequired") =>
        {
            if state.status != "approvalRequired" {
                state.status = "streaming".into();
            }
            state.error = None;
            state.activity = None;
            state.messages.push(ChatMessage {
                id: format!("{run_id}:user"),
                role: "user".into(),
                text,
            });
            state.messages.push(ChatMessage {
                id: format!("{run_id}:assistant"),
                role: "assistant".into(),
                text: String::new(),
            });
            if state.messages.len() > 24 {
                state.messages.drain(0..2);
            }
        }
        AgentEvent::TextDelta { run_id, delta }
            if state.run_id == run_id && state.status == "streaming" =>
        {
            state.activity = None;
            if let Some(message) = state.messages.last_mut().filter(|m| m.role == "assistant")
                && message.text.len().saturating_add(delta.len()) <= 128_000
            {
                message.text.push_str(&delta);
            }
        }
        AgentEvent::TextFinal { run_id, text }
            if state.run_id == run_id && state.status == "streaming" =>
        {
            state.activity = None;
            if let Some(message) = state.messages.last_mut().filter(|m| m.role == "assistant") {
                message.text = text.chars().take(128_000).collect();
            }
        }
        AgentEvent::ActivityChanged { run_id, activity }
            if state.run_id == run_id
                && state.status == "streaming"
                && state.mode == "agentSession" =>
        {
            state.activity = Some(activity);
        }
        AgentEvent::ApprovalRequested { run_id, approval }
            if state.run_id == run_id
                && approval.run_id == run_id
                && state.mode == "agentSession"
                && state
                    .approval
                    .as_ref()
                    .is_none_or(|p| p.approval_id == approval.approval_id)
                && matches!(
                    state.status.as_str(),
                    "starting" | "streaming" | "approvalRequired"
                ) =>
        {
            state.status = "approvalRequired".into();
            state.activity = None;
            state.approval = Some(approval);
        }
        AgentEvent::ApprovalResolved {
            run_id,
            approval_id,
        } if state.run_id == run_id
            && state.status == "approvalRequired"
            && state
                .approval
                .as_ref()
                .is_some_and(|a| a.approval_id == approval_id) =>
        {
            state.approval = None;
            state.status = if state.messages.last().is_some_and(|m| m.role == "assistant") {
                "streaming"
            } else {
                "starting"
            }
            .into();
        }
        AgentEvent::Completed { run_id }
            if state.run_id == run_id
                && matches!(
                    state.status.as_str(),
                    "streaming" | "stopping" | "approvalRequired"
                ) =>
        {
            if state.status == "approvalRequired" {
                state.status = "failed".into();
                state.error = Some("Provider completed with unresolved approval.".into());
                state.approval = None;
                state.activity = None;
                state.capture = CaptureSnapshot::default();
                return true;
            }
            if state.status == "stopping" {
                state.status = "stopped".into();
                state.activity = None;
                state.approval = None;
                state.capture = CaptureSnapshot::default();
                return true;
            }
            if state
                .messages
                .last()
                .is_some_and(|m| m.role == "assistant" && !m.text.trim().is_empty())
            {
                state.status = "completed".into();
                state.activity = None;
            } else {
                state.status = "failed".into();
                state.error = Some("Provider finished without an answer.".into());
            }
            state.approval = None;
            state.capture = CaptureSnapshot::default();
        }
        AgentEvent::Failed { run_id, message }
            if state.run_id == run_id
                && !matches!(state.status.as_str(), "completed" | "stopped" | "failed") =>
        {
            if state.status == "stopping" {
                state.status = "stopped".into();
            } else {
                state.status = "failed".into();
                state.error = Some(message);
            }
            state.activity = None;
            state.approval = None;
            state.capture = CaptureSnapshot::default();
        }
        AgentEvent::Stopped { run_id }
            if state.run_id == run_id
                && !matches!(state.status.as_str(), "completed" | "stopped" | "failed") =>
        {
            state.status = "stopped".into();
            state.activity = None;
            state.approval = None;
            state.capture = CaptureSnapshot::default();
        }
        _ => return false,
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state(run_id: u64) -> (watch::Sender<Snapshot>, ProviderEvents) {
        let (updates, _) = watch::channel(Snapshot {
            run_id,
            seq: 0,
            status: "starting".into(),
            mode: "quickAsk".into(),
            provider: "pi".into(),
            cwd: String::new(),
            thread_id: None,
            model: None,
            thinking_effort: None,
            usage: None,
            messages: Vec::new(),
            activity: None,
            approval: None,
            capture: CaptureSnapshot::default(),
            error: None,
        });
        (updates.clone(), ProviderEvents::new(updates))
    }

    #[test]
    fn adapter_events_have_one_owner_and_reject_stale_or_terminal_changes() {
        let (updates, events) = state(7);
        events.emit(AgentEvent::SessionReady {
            run_id: 7,
            session_id: "s1".into(),
        });
        events.emit(AgentEvent::TurnStarted {
            run_id: 7,
            text: "hello".into(),
        });
        events.emit(AgentEvent::TextDelta {
            run_id: 7,
            delta: "partial".into(),
        });
        events.emit(AgentEvent::TextFinal {
            run_id: 7,
            text: "final".into(),
        });
        updates.send_modify(|state| state.capture.phase = "analyzing".into());
        events.emit(AgentEvent::Completed { run_id: 7 });
        let final_seq = updates.borrow().seq;
        events.emit(AgentEvent::TextDelta {
            run_id: 7,
            delta: "late".into(),
        });
        events.emit(AgentEvent::Failed {
            run_id: 6,
            message: "stale".into(),
        });
        events.emit(AgentEvent::Stopped { run_id: 7 });
        let result = updates.borrow();
        assert_eq!(result.status, "completed");
        assert_eq!(result.thread_id.as_deref(), Some("s1"));
        assert_eq!(result.messages[1].text, "final");
        assert_eq!(result.capture.phase, "idle");
        assert_eq!(result.seq, final_seq);
    }

    #[test]
    fn stop_prevents_late_completion_and_empty_completion_is_failure() {
        let (updates, events) = state(3);
        events.emit(AgentEvent::TurnStarted {
            run_id: 3,
            text: "hi".into(),
        });
        events.emit(AgentEvent::Stopped { run_id: 3 });
        events.emit(AgentEvent::TextDelta {
            run_id: 3,
            delta: "late".into(),
        });
        events.emit(AgentEvent::Completed { run_id: 3 });
        assert_eq!(updates.borrow().status, "stopped");
        assert!(updates.borrow().messages[1].text.is_empty());

        let (updates, events) = state(4);
        events.emit(AgentEvent::TurnStarted {
            run_id: 4,
            text: "hi".into(),
        });
        events.emit(AgentEvent::Completed { run_id: 4 });
        assert_eq!(updates.borrow().status, "failed");
        assert_eq!(
            updates.borrow().error.as_deref(),
            Some("Provider finished without an answer.")
        );
    }

    #[test]
    fn failed_and_stopped_runs_cannot_be_resurrected() {
        let (updates, events) = state(2);
        events.emit(AgentEvent::Failed {
            run_id: 2,
            message: "disconnected".into(),
        });
        events.emit(AgentEvent::TurnStarted {
            run_id: 2,
            text: "late".into(),
        });
        assert_eq!(updates.borrow().status, "failed");
        assert!(updates.borrow().messages.is_empty());
    }

    fn approval(run_id: u64, id: &str) -> PendingApproval {
        PendingApproval {
            approval_id: id.into(),
            run_id,
            kind: "command".into(),
            title: "Execute".into(),
            detail: "cargo test".into(),
            reason: None,
        }
    }

    #[test]
    fn approval_before_turn_ack_stays_visible_and_resolves_to_streaming() {
        let (updates, events) = state(13);
        updates.send_modify(|s| s.mode = "agentSession".into());
        events.emit(AgentEvent::ApprovalRequested {
            run_id: 13,
            approval: approval(13, "ok"),
        });
        assert_eq!(updates.borrow().status, "approvalRequired");
        events.emit(AgentEvent::TurnStarted {
            run_id: 13,
            text: "test".into(),
        });
        assert_eq!(updates.borrow().status, "approvalRequired");
        events.emit(AgentEvent::ApprovalResolved {
            run_id: 13,
            approval_id: "stale".into(),
        });
        assert_eq!(updates.borrow().status, "approvalRequired");
        events.emit(AgentEvent::ApprovalResolved {
            run_id: 13,
            approval_id: "ok".into(),
        });
        assert_eq!(updates.borrow().status, "streaming");
        assert!(updates.borrow().approval.is_none());
    }

    #[test]
    fn quick_ask_and_stale_run_cannot_publish_privileged_activity() {
        let (updates, events) = state(22);
        events.emit(AgentEvent::ApprovalRequested {
            run_id: 22,
            approval: approval(22, "unsafe"),
        });
        events.emit(AgentEvent::ActivityChanged {
            run_id: 22,
            activity: ToolActivity {
                kind: "command".into(),
                summary: "write".into(),
            },
        });
        assert!(updates.borrow().approval.is_none());
        assert!(updates.borrow().activity.is_none());
        updates.send_modify(|s| s.mode = "agentSession".into());
        events.emit(AgentEvent::ApprovalRequested {
            run_id: 21,
            approval: approval(21, "stale"),
        });
        assert!(updates.borrow().approval.is_none());
    }

    #[test]
    fn stop_race_wins_over_completion_even_with_final_answer() {
        let (updates, events) = state(31);
        events.emit(AgentEvent::TurnStarted {
            run_id: 31,
            text: "hello".into(),
        });
        events.emit(AgentEvent::TextFinal {
            run_id: 31,
            text: "answer".into(),
        });
        updates.send_modify(|s| s.status = "stopping".into());
        events.emit(AgentEvent::Completed { run_id: 31 });
        assert_eq!(updates.borrow().status, "stopped");
        events.emit(AgentEvent::ApprovalRequested {
            run_id: 31,
            approval: approval(31, "late"),
        });
        assert!(updates.borrow().approval.is_none());
    }
    #[test]
    fn unresolved_approval_cannot_be_overridden_or_complete_as_success() {
        let (updates, events) = state(41);
        updates.send_modify(|s| s.mode = "agentSession".into());
        events.emit(AgentEvent::ApprovalRequested {
            run_id: 41,
            approval: approval(41, "first"),
        });
        events.emit(AgentEvent::ApprovalRequested {
            run_id: 41,
            approval: approval(41, "second"),
        });
        assert_eq!(
            updates.borrow().approval.as_ref().unwrap().approval_id,
            "first"
        );
        events.emit(AgentEvent::Completed { run_id: 41 });
        assert_eq!(updates.borrow().status, "failed");
        assert!(updates.borrow().approval.is_none());
    }
}
