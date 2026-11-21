use super::{
    client::{is_incoming_request, permission_message, rpc_error_message},
    wire::{begin, tool_details, tool_kind, usage_snapshot},
};
use crate::agent::events::{AgentEvent, ProviderEvents};
use crate::agent::{ActivityDetails, ActivityKind, RunPhase, UsageSnapshot};
use serde_json::Value;

pub(super) struct TurnState {
    name: &'static str,
    pub(super) run_id: u64,
    prompt_id: u64,
    display_text: String,
    acknowledged: bool,
    accumulated: String,
    context_tokens: Option<i64>,
    model_context_window: Option<i64>,
    thinking: Option<String>,
    thinking_count: u32,
}

impl TurnState {
    pub(super) fn new(
        name: &'static str,
        run_id: u64,
        prompt_id: u64,
        display_text: impl Into<String>,
        model_context_window: Option<i64>,
    ) -> Self {
        Self {
            name,
            run_id,
            prompt_id,
            display_text: display_text.into(),
            acknowledged: false,
            accumulated: String::new(),
            context_tokens: None,
            model_context_window,
            thinking: None,
            thinking_count: 0,
        }
    }

    fn finish_thinking(&mut self, events: &ProviderEvents) {
        if let Some(activity) = self.thinking.take() {
            events.activity_finished(self.run_id, &activity);
        }
    }

    pub(super) fn ensure_started(&mut self, events: &ProviderEvents) {
        if !self.acknowledged {
            self.acknowledged = true;
            begin(events, self.run_id, &self.display_text);
        }
    }
}

pub(super) fn observe_acp(frame: &Value, turn: &mut TurnState, events: &ProviderEvents) -> bool {
    let snapshot = events.snapshot();
    if snapshot.run_id != turn.run_id
        || !matches!(snapshot.status, RunPhase::Starting | RunPhase::Streaming)
    {
        return false;
    }
    if is_incoming_request(frame) {
        events.fail(turn.run_id, &permission_message(turn.name));
        return true;
    }
    if frame["method"] == "session/update" {
        let update = &frame["params"]["update"];
        match update["sessionUpdate"].as_str() {
            Some("usage_update") => {
                if let Some(used) = update["used"].as_i64().filter(|count| *count >= 0) {
                    turn.context_tokens = Some(used);
                }
                if let Some(size) = update["size"].as_i64().filter(|count| *count > 0) {
                    turn.model_context_window = Some(size);
                }
                if turn.context_tokens.is_some() || turn.model_context_window.is_some() {
                    let existing = events.snapshot().usage.unwrap_or(UsageSnapshot {
                        context_tokens: None,
                        session_tokens: 0,
                        input_tokens: 0,
                        cached_input_tokens: 0,
                        output_tokens: 0,
                        reasoning_output_tokens: None,
                        model_context_window: None,
                    });
                    events.emit(AgentEvent::UsageUpdated {
                        run_id: turn.run_id,
                        usage: UsageSnapshot {
                            context_tokens: turn.context_tokens.or(existing.context_tokens),
                            model_context_window: turn
                                .model_context_window
                                .or(existing.model_context_window),
                            ..existing
                        },
                    });
                }
            }
            Some("user_message_chunk") => {
                turn.ensure_started(events);
            }
            Some("agent_thought_chunk") => {
                let activity = turn.thinking.clone().unwrap_or_else(|| {
                    turn.thinking_count = turn.thinking_count.saturating_add(1);
                    let created = format!("thinking:{}", turn.thinking_count);
                    events.activity_started(
                        turn.run_id,
                        &created,
                        ActivityKind::Thinking,
                        ActivityDetails::default(),
                    );
                    turn.thinking = Some(created.clone());
                    created
                });
                if let Some(chunk) = update["content"]["text"].as_str() {
                    events.activity_detail_delta(turn.run_id, &activity, chunk);
                }
            }
            Some("tool_call") => {
                turn.finish_thinking(events);
                if let Some(call) = update["toolCallId"].as_str() {
                    let kind = tool_kind(update["kind"].as_str().unwrap_or_default());
                    let details = tool_details(update);
                    events.activity_started(turn.run_id, call, kind, details);
                    if matches!(update["status"].as_str(), Some("completed" | "failed")) {
                        events.activity_finished(turn.run_id, call);
                    }
                }
            }
            Some("tool_call_update") => {
                if let Some(call) = update["toolCallId"].as_str() {
                    let details = tool_details(update);
                    if details.summary.is_some() || details.detail.is_some() {
                        events.activity_updated(turn.run_id, call, details);
                    }
                    if matches!(update["status"].as_str(), Some("completed" | "failed")) {
                        events.activity_finished(turn.run_id, call);
                    }
                }
            }
            Some("agent_message_chunk") => {
                turn.finish_thinking(events);
                if update["content"]["type"] == "text"
                    && let Some(delta) = update["content"]["text"].as_str()
                {
                    turn.ensure_started(events);
                    turn.accumulated.push_str(delta);
                    events.emit(AgentEvent::TextDelta {
                        run_id: turn.run_id,
                        delta: delta.to_owned(),
                    });
                }
            }
            _ => {}
        }
        return false;
    }
    if frame["id"] == turn.prompt_id {
        if let Some(error) = frame.get("error") {
            events.fail(turn.run_id, &rpc_error_message(turn.name, error));
            return true;
        }
        let result = &frame["result"];
        if result["stopReason"] == "cancelled" {
            events.stopped(turn.run_id);
            return true;
        }
        if turn.accumulated.trim().is_empty() {
            events.fail(
                turn.run_id,
                &format!("{} returned an empty answer.", turn.name),
            );
            return true;
        }
        turn.ensure_started(events);
        if let Some(usage) = usage_snapshot(
            &result["usage"],
            turn.context_tokens,
            turn.model_context_window,
        ) {
            events.emit(AgentEvent::UsageUpdated {
                run_id: turn.run_id,
                usage,
            });
        }
        events.emit(AgentEvent::TextFinal {
            run_id: turn.run_id,
            text: std::mem::take(&mut turn.accumulated),
        });
        events.emit(AgentEvent::Completed {
            run_id: turn.run_id,
        });
        return true;
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::AgentRuntime;
    use serde_json::json;

    #[test]
    fn acp_thought_and_tool_updates_capture_details() {
        let mut snapshot = AgentRuntime::new().snapshot();
        snapshot.run_id = 6;
        snapshot.status = RunPhase::Starting;
        let (updates, _) = tokio::sync::watch::channel(snapshot);
        let events = ProviderEvents::new(updates.clone());
        let mut turn = TurnState::new("Agy", 6, 1, "question", None);
        let update = |body: Value| json!({"method":"session/update","params":{"update":body}});
        for frame in [
            update(
                json!({"sessionUpdate":"agent_thought_chunk","content":{"type":"text","text":"Checking files\n"}}),
            ),
            update(
                json!({"sessionUpdate":"agent_thought_chunk","content":{"type":"text","text":"Need ActivityTrail"}}),
            ),
            update(
                json!({"sessionUpdate":"tool_call","toolCallId":"c1","kind":"search","title":"Search ActivityTrail","status":"in_progress","locations":[{"path":"src/App.tsx","line":12}]}),
            ),
        ] {
            observe_acp(&frame, &mut turn, &events);
        }
        let list = updates.borrow().activity.clone();
        assert_eq!(list.len(), 2);
        assert!(list[0].done && !list[1].done);
        assert_eq!(list[0].summary.as_deref(), Some("Checking files"));
        assert!(
            list[0]
                .detail
                .as_deref()
                .unwrap()
                .contains("Need ActivityTrail")
        );
        assert_eq!(list[1].kind, ActivityKind::Search);
        assert_eq!(list[1].summary.as_deref(), Some("Search ActivityTrail"));
        assert!(
            list[1]
                .detail
                .as_deref()
                .unwrap()
                .contains("src/App.tsx:12")
        );
        observe_acp(
            &update(
                json!({"sessionUpdate":"tool_call_update","toolCallId":"c1","status":"completed","rawInput":{"query":"ActivityTrail"}}),
            ),
            &mut turn,
            &events,
        );
        let updated = updates.borrow().activity[1].clone();
        assert!(updated.done);
        assert!(
            updated
                .detail
                .as_deref()
                .unwrap()
                .contains("query: ActivityTrail")
        );
    }
}
