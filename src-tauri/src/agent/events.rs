use super::{CaptureSnapshot, ChatMessage, RunPhase, Snapshot, UsageSnapshot};
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
        self.updates.send_if_modified(|state| {
            let changed = reduce(state, event);
            if changed {
                state.seq = state.seq.saturating_add(1);
            }
            changed
        });
    }
}

fn reduce(state: &mut Snapshot, event: AgentEvent) -> bool {
    match event {
        AgentEvent::SessionReady { run_id, session_id }
            if state.run_id == run_id && state.status == RunPhase::Starting =>
        {
            state.thread_id = Some(session_id);
        }
        AgentEvent::RuntimeChanged {
            run_id,
            model,
            thinking_effort,
        } if state.run_id == run_id
            && !matches!(
                state.status,
                RunPhase::Completed | RunPhase::Stopped | RunPhase::Failed
            ) =>
        {
            state.model = model;
            state.thinking_effort = thinking_effort;
        }
        AgentEvent::UsageUpdated { run_id, usage }
            if state.run_id == run_id
                && !matches!(
                    state.status,
                    RunPhase::Completed | RunPhase::Stopped | RunPhase::Failed
                ) =>
        {
            state.usage = Some(usage);
        }
        AgentEvent::TurnStarted { run_id, text }
            if state.run_id == run_id && state.status == RunPhase::Starting =>
        {
            state.status = RunPhase::Streaming;
            state.error = None;
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
            if state.run_id == run_id && state.status == RunPhase::Streaming =>
        {
            if let Some(message) = state.messages.last_mut().filter(|m| m.role == "assistant")
                && message.text.len().saturating_add(delta.len()) <= 128_000
            {
                message.text.push_str(&delta);
            }
        }
        AgentEvent::TextFinal { run_id, text }
            if state.run_id == run_id && state.status == RunPhase::Streaming =>
        {
            if let Some(message) = state.messages.last_mut().filter(|m| m.role == "assistant") {
                message.text = text.chars().take(128_000).collect();
            }
        }
        AgentEvent::Completed { run_id }
            if state.run_id == run_id
                && matches!(state.status, RunPhase::Streaming | RunPhase::Stopping) =>
        {
            if state.status == RunPhase::Stopping {
                state.status = RunPhase::Stopped;
                state.capture = CaptureSnapshot::default();
                return true;
            }
            if state
                .messages
                .last()
                .is_some_and(|m| m.role == "assistant" && !m.text.trim().is_empty())
            {
                state.status = RunPhase::Completed;
            } else {
                state.status = RunPhase::Failed;
                state.error = Some("Provider finished without an answer.".into());
            }
            state.capture = CaptureSnapshot::default();
        }
        AgentEvent::Failed { run_id, message }
            if state.run_id == run_id
                && !matches!(
                    state.status,
                    RunPhase::Completed | RunPhase::Stopped | RunPhase::Failed
                ) =>
        {
            if state.status == RunPhase::Stopping {
                state.status = RunPhase::Stopped;
            } else {
                state.status = RunPhase::Failed;
                state.error = Some(message);
            }
            state.capture = CaptureSnapshot::default();
        }
        AgentEvent::Stopped { run_id }
            if state.run_id == run_id
                && !matches!(
                    state.status,
                    RunPhase::Completed | RunPhase::Stopped | RunPhase::Failed
                ) =>
        {
            state.status = RunPhase::Stopped;
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
            status: RunPhase::Starting,
            provider: "pi".into(),
            cwd: String::new(),
            conversation_id: String::new(),
            thread_id: None,
            model: None,
            thinking_effort: None,
            usage: None,
            messages: Vec::new(),
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
        assert_eq!(result.status, RunPhase::Completed);
        assert_eq!(result.thread_id.as_deref(), Some("s1"));
        assert_eq!(result.messages[1].text, "final");
        assert_eq!(result.capture.phase, "idle");
        assert_eq!(result.seq, final_seq);
    }

    #[test]
    fn stale_events_do_not_notify_watch_subscribers() {
        let (updates, _) = state(7);
        let mut receiver = updates.subscribe();
        receiver.borrow_and_update();
        let events = ProviderEvents::new(updates.clone());
        events.emit(AgentEvent::Failed {
            run_id: 6,
            message: "stale".into(),
        });
        assert!(!receiver.has_changed().unwrap());
        events.emit(AgentEvent::SessionReady {
            run_id: 7,
            session_id: "s1".into(),
        });
        assert!(receiver.has_changed().unwrap());
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
        assert_eq!(updates.borrow().status, RunPhase::Stopped);

        let (updates, events) = state(4);
        events.emit(AgentEvent::TurnStarted {
            run_id: 4,
            text: "hi".into(),
        });
        events.emit(AgentEvent::Completed { run_id: 4 });
        assert_eq!(updates.borrow().status, RunPhase::Failed);
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
        assert_eq!(updates.borrow().status, RunPhase::Failed);
        assert!(updates.borrow().messages.is_empty());
    }

    #[test]
    fn unsupported_provider_events_are_not_representable_as_ui_state() {
        let (updates, events) = state(11);
        events.emit(AgentEvent::Failed {
            run_id: 11,
            message: "Provider attempted an unsupported tool action.".into(),
        });
        assert_eq!(updates.borrow().status, RunPhase::Failed);
        assert_eq!(
            updates.borrow().error.as_deref(),
            Some("Provider attempted an unsupported tool action.")
        );
    }
}
