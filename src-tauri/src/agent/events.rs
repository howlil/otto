use super::{
    ActivityDetails, ActivityKind, CaptureSnapshot, PendingPermissionSnapshot, ProviderRateLimit,
    RunPhase, Snapshot, UsageSnapshot, activity, conversation, now_millis,
};
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
    RateLimitsUpdated {
        run_id: u64,
        rate_limits: Vec<ProviderRateLimit>,
    },
    ActivityStarted {
        run_id: u64,
        id: String,
        kind: ActivityKind,
        details: ActivityDetails,
    },
    ActivityUpdated {
        run_id: u64,
        id: String,
        details: ActivityDetails,
    },
    ActivityDetailDelta {
        run_id: u64,
        id: String,
        delta: String,
    },
    ActivityFinished {
        run_id: u64,
        id: String,
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
    PermissionRequested {
        run_id: u64,
        request: PendingPermissionSnapshot,
    },
    PermissionCleared {
        run_id: u64,
        request_id: Option<String>,
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
    retain_session: bool,
}

impl ProviderEvents {
    pub fn new(updates: watch::Sender<Snapshot>) -> Self {
        Self {
            updates,
            retain_session: true,
        }
    }

    pub fn new_ephemeral(updates: watch::Sender<Snapshot>) -> Self {
        Self {
            updates,
            retain_session: false,
        }
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

    pub fn activity_started(
        &self,
        run_id: u64,
        id: &str,
        kind: ActivityKind,
        details: ActivityDetails,
    ) {
        self.emit(AgentEvent::ActivityStarted {
            run_id,
            id: id.to_owned(),
            kind,
            details,
        });
    }

    pub fn activity_updated(&self, run_id: u64, id: &str, details: ActivityDetails) {
        self.emit(AgentEvent::ActivityUpdated {
            run_id,
            id: id.to_owned(),
            details,
        });
    }

    pub fn activity_detail_delta(&self, run_id: u64, id: &str, delta: &str) {
        self.emit(AgentEvent::ActivityDetailDelta {
            run_id,
            id: id.to_owned(),
            delta: delta.to_owned(),
        });
    }

    pub fn activity_finished(&self, run_id: u64, id: &str) {
        self.emit(AgentEvent::ActivityFinished {
            run_id,
            id: id.to_owned(),
        });
    }

    pub fn stopped(&self, run_id: u64) {
        self.emit(AgentEvent::Stopped { run_id });
    }

    pub fn permission_requested(&self, run_id: u64, request: PendingPermissionSnapshot) {
        self.emit(AgentEvent::PermissionRequested { run_id, request });
    }

    pub fn permission_cleared(&self, run_id: u64, request_id: Option<String>) {
        self.emit(AgentEvent::PermissionCleared { run_id, request_id });
    }

    pub fn emit(&self, event: AgentEvent) {
        if !self.retain_session && matches!(event, AgentEvent::SessionReady { .. }) {
            return;
        }
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
            if state.run_id == run_id
                && matches!(state.status, RunPhase::Starting | RunPhase::Streaming) =>
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
        AgentEvent::RateLimitsUpdated {
            run_id,
            rate_limits,
        } if state.run_id == run_id
            && !matches!(
                state.status,
                RunPhase::Completed | RunPhase::Stopped | RunPhase::Failed
            ) =>
        {
            return merge_rate_limits(&mut state.rate_limits, rate_limits);
        }
        AgentEvent::ActivityStarted {
            run_id,
            id,
            kind,
            details,
        } if state.run_id == run_id
            && matches!(state.status, RunPhase::Starting | RunPhase::Streaming) =>
        {
            return activity::start(&mut state.activity, &id, kind, &details);
        }
        AgentEvent::ActivityUpdated {
            run_id,
            id,
            details,
        } if state.run_id == run_id
            && matches!(state.status, RunPhase::Starting | RunPhase::Streaming) =>
        {
            return activity::update(&mut state.activity, &id, &details);
        }
        AgentEvent::ActivityDetailDelta { run_id, id, delta }
            if state.run_id == run_id
                && matches!(state.status, RunPhase::Starting | RunPhase::Streaming) =>
        {
            return activity::append_detail(&mut state.activity, &id, &delta);
        }
        AgentEvent::ActivityFinished { run_id, id }
            if state.run_id == run_id
                && matches!(state.status, RunPhase::Starting | RunPhase::Streaming) =>
        {
            return activity::finish(&mut state.activity, &id);
        }
        AgentEvent::TurnStarted { run_id, text }
            if state.run_id == run_id && state.status == RunPhase::Starting =>
        {
            state.status = RunPhase::Streaming;
            state.error = None;
            conversation::start_turn(&mut state.messages, run_id, text);
        }
        AgentEvent::TextDelta { run_id, delta }
            if state.run_id == run_id && state.status == RunPhase::Streaming =>
        {
            let changed = conversation::append_delta(&mut state.messages, run_id, &delta);
            if changed && !delta.is_empty() {
                mark_first_token(state, run_id);
            }
            return changed;
        }
        AgentEvent::TextFinal { run_id, text }
            if state.run_id == run_id && state.status == RunPhase::Streaming =>
        {
            let changed = conversation::set_final(&mut state.messages, run_id, &text);
            if changed && !text.trim().is_empty() {
                mark_first_token(state, run_id);
            }
            return changed;
        }
        AgentEvent::PermissionRequested { run_id, request }
            if state.run_id == run_id
                && matches!(state.status, RunPhase::Starting | RunPhase::Streaming) =>
        {
            if state.pending_permission.as_ref() == Some(&request) {
                return false;
            }
            state.pending_permission = Some(request);
        }
        AgentEvent::PermissionCleared { run_id, request_id } if state.run_id == run_id => {
            let should_clear = match (&state.pending_permission, &request_id) {
                (None, _) => false,
                (Some(_), None) => true,
                (Some(current), Some(target)) => &current.request_id == target,
            };
            if !should_clear {
                return false;
            }
            state.pending_permission = None;
        }
        AgentEvent::Completed { run_id }
            if state.run_id == run_id
                && matches!(state.status, RunPhase::Streaming | RunPhase::Stopping) =>
        {
            state.pending_permission = None;
            if state.status == RunPhase::Stopping {
                state.status = RunPhase::Stopped;
                state.capture = CaptureSnapshot::default();
                state.queued_followup = None;
                mark_turn_finished(state, run_id);
                return true;
            }
            if conversation::has_answer(&state.messages, run_id) {
                state.status = RunPhase::Completed;
                activity::finish_all(&mut state.activity);
                mark_turn_finished(state, run_id);
            } else {
                state.status = RunPhase::Failed;
                state.queued_followup = None;
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
            state.pending_permission = None;
            state.queued_followup = None;
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
            state.pending_permission = None;
            state.queued_followup = None;
            state.capture = CaptureSnapshot::default();
            mark_turn_finished(state, run_id);
        }
        _ => return false,
    }
    true
}

fn mark_first_token(state: &mut Snapshot, run_id: u64) {
    if let Some(timing) = state.turn_timing.as_mut()
        && timing.run_id == run_id
        && timing.first_token_ms.is_none()
    {
        timing.first_token_ms = Some(now_millis().saturating_sub(timing.started_at_ms));
    }
}

fn mark_turn_finished(state: &mut Snapshot, run_id: u64) {
    if let Some(timing) = state.turn_timing.as_mut()
        && timing.run_id == run_id
        && timing.total_ms.is_none()
    {
        let elapsed = now_millis().saturating_sub(timing.started_at_ms);
        if timing.first_token_ms.is_none() {
            timing.first_token_ms = Some(elapsed);
        }
        timing.total_ms = Some(elapsed);
    }
}

fn merge_rate_limits(
    existing: &mut Vec<ProviderRateLimit>,
    incoming: Vec<ProviderRateLimit>,
) -> bool {
    if incoming.is_empty() {
        return false;
    }
    let mut changed = false;
    for limit in incoming {
        if let Some(slot) = existing.iter_mut().find(|item| item.id == limit.id) {
            if *slot != limit {
                *slot = limit;
                changed = true;
            }
        } else if existing.len() < 32 {
            existing.push(limit);
            changed = true;
        }
    }
    changed
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
            rate_limits: Vec::new(),
            messages: Vec::new(),
            activity: Vec::new(),
            capture: CaptureSnapshot::default(),
            queued_followup: None,
            pending_permission: None,
            turn_timing: None,
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
    fn unrelated_or_oversized_text_events_do_not_modify_transcript_or_sequence() {
        let (updates, events) = state(8);
        updates.send_modify(|state| {
            state.status = RunPhase::Streaming;
            state.messages = vec![super::super::ChatMessage {
                id: "7:assistant".into(),
                role: "assistant".into(),
                text: "Previous answer".into(),
            }];
        });
        let sequence = updates.borrow().seq;
        events.emit(AgentEvent::TextDelta {
            run_id: 8,
            delta: "wrong turn".into(),
        });
        events.emit(AgentEvent::TextFinal {
            run_id: 8,
            text: "wrong final".into(),
        });
        assert_eq!(updates.borrow().messages[0].text, "Previous answer");
        assert_eq!(updates.borrow().seq, sequence);

        events.emit(AgentEvent::Completed { run_id: 8 });
        assert_eq!(updates.borrow().status, RunPhase::Failed);

        let (updates, events) = state(9);
        events.emit(AgentEvent::TurnStarted {
            run_id: 9,
            text: "Question".into(),
        });
        let sequence = updates.borrow().seq;
        events.emit(AgentEvent::TextDelta {
            run_id: 9,
            delta: "x".repeat(128_001),
        });
        assert_eq!(updates.borrow().messages[1].text, "");
        assert_eq!(updates.borrow().seq, sequence);
        events.emit(AgentEvent::TextFinal {
            run_id: 9,
            text: "Valid final".into(),
        });
        events.emit(AgentEvent::Completed { run_id: 9 });
        assert_eq!(updates.borrow().status, RunPhase::Completed);
        assert_eq!(updates.borrow().messages[1].text, "Valid final");
    }

    #[test]
    fn provider_failures_are_representable_as_ui_state() {
        let (updates, events) = state(11);
        events.emit(AgentEvent::Failed {
            run_id: 11,
            message: "Provider failed.".into(),
        });
        assert_eq!(updates.borrow().status, RunPhase::Failed);
        assert_eq!(updates.borrow().error.as_deref(), Some("Provider failed."));
    }

    #[test]
    fn activity_is_run_scoped_deduplicated_and_ignored_after_a_terminal_state() {
        let (updates, events) = state(5);
        events.activity_started(
            5,
            "a",
            ActivityKind::Search,
            ActivityDetails {
                summary: Some("query".into()),
                detail: None,
            },
        );
        events.activity_started(
            5,
            "a",
            ActivityKind::Search,
            ActivityDetails {
                summary: Some("query".into()),
                detail: None,
            },
        );
        events.activity_started(4, "stale", ActivityKind::Read, ActivityDetails::default());
        events.activity_detail_delta(5, "a", "full detail");
        events.activity_finished(5, "a");
        let sequence = updates.borrow().seq;
        events.activity_finished(5, "a");
        assert_eq!(updates.borrow().seq, sequence);
        assert_eq!(updates.borrow().activity.len(), 1);
        assert!(updates.borrow().activity[0].done);
        assert_eq!(
            updates.borrow().activity[0].summary.as_deref(),
            Some("query")
        );
        assert_eq!(
            updates.borrow().activity[0].detail.as_deref(),
            Some("full detail")
        );
        events.emit(AgentEvent::Failed {
            run_id: 5,
            message: "x".into(),
        });
        events.activity_started(5, "late", ActivityKind::Read, ActivityDetails::default());
        assert_eq!(updates.borrow().activity.len(), 1);
    }

    #[test]
    fn completion_marks_open_activities_done() {
        let (updates, events) = state(6);
        events.emit(AgentEvent::TurnStarted {
            run_id: 6,
            text: "hi".into(),
        });
        events.activity_started(6, "t1", ActivityKind::Thinking, ActivityDetails::default());
        events.emit(AgentEvent::TextFinal {
            run_id: 6,
            text: "done".into(),
        });
        events.emit(AgentEvent::Completed { run_id: 6 });
        assert_eq!(updates.borrow().status, RunPhase::Completed);
        assert!(updates.borrow().activity[0].done);
    }

    #[test]
    fn rate_limits_updated_merges_by_id_and_ignores_stale_or_terminal_runs() {
        let (updates, events) = state(8);
        events.emit(AgentEvent::RateLimitsUpdated {
            run_id: 8,
            rate_limits: vec![ProviderRateLimit {
                id: "codex:codex:primary".into(),
                label: "5h limit".into(),
                window: "5h".into(),
                used_percent: 20,
                remaining_percent: 80,
                resets_at: None,
                group: None,
            }],
        });
        events.emit(AgentEvent::RateLimitsUpdated {
            run_id: 8,
            rate_limits: vec![
                ProviderRateLimit {
                    id: "codex:codex:primary".into(),
                    label: "5h limit".into(),
                    window: "5h".into(),
                    used_percent: 35,
                    remaining_percent: 65,
                    resets_at: None,
                    group: None,
                },
                ProviderRateLimit {
                    id: "codex:codex:secondary".into(),
                    label: "Weekly limit".into(),
                    window: "weekly".into(),
                    used_percent: 12,
                    remaining_percent: 88,
                    resets_at: None,
                    group: None,
                },
            ],
        });
        assert_eq!(updates.borrow().rate_limits.len(), 2);
        assert_eq!(updates.borrow().rate_limits[0].used_percent, 35);
        assert_eq!(updates.borrow().rate_limits[1].window, "weekly");
        events.emit(AgentEvent::RateLimitsUpdated {
            run_id: 7,
            rate_limits: vec![ProviderRateLimit {
                id: "stale".into(),
                label: "Stale".into(),
                window: "5h".into(),
                used_percent: 99,
                remaining_percent: 1,
                resets_at: None,
                group: None,
            }],
        });
        assert_eq!(updates.borrow().rate_limits.len(), 2);
    }

    #[test]
    fn turn_timing_records_first_token_and_completion_elapsed_ms() {
        let (updates, events) = state(15);
        updates.send_modify(|s| {
            s.turn_timing = Some(super::super::TurnTiming {
                run_id: 15,
                started_at_ms: now_millis().saturating_sub(25),
                first_token_ms: None,
                total_ms: None,
            });
        });
        events.emit(AgentEvent::TurnStarted {
            run_id: 15,
            text: "hy".into(),
        });
        events.emit(AgentEvent::TextDelta {
            run_id: 15,
            delta: "Hi!".into(),
        });
        let first = updates
            .borrow()
            .turn_timing
            .as_ref()
            .and_then(|t| t.first_token_ms);
        assert!(first.is_some());
        events.emit(AgentEvent::Completed { run_id: 15 });
        let timing = updates.borrow().turn_timing.clone().expect("timing kept");
        assert_eq!(timing.first_token_ms, first);
        assert!(timing.total_ms.is_some_and(|total| total >= first.unwrap()));
    }
}
