use super::readiness::MAX_OUTPUT;
use crate::agent::activity::{describe_thinking, describe_tool};
use crate::agent::providers::authentication_required;
use crate::agent::{
    ActivityDetails, ActivityKind, MAX_ASSISTANT_TEXT, UsageSnapshot,
    events::{AgentEvent, ProviderEvents},
};
use serde_json::Value;
use std::collections::HashSet;

#[derive(Default)]
pub(super) struct Turn {
    pub(super) session: Option<String>,
    parts: HashSet<String>,
    bytes: usize,
    emitted: usize,
    input_tokens: i64,
    cached_input_tokens: i64,
    output_tokens: i64,
    reasoning_output_tokens: i64,
    pub(super) finished: bool,
}

impl Turn {
    pub(super) fn observe(
        &mut self,
        frame: &Value,
        run_id: u64,
        events: &ProviderEvents,
    ) -> Result<(), String> {
        let session = frame["sessionID"]
            .as_str()
            .filter(|id| !id.is_empty() && id.len() <= 256)
            .ok_or("OpenCode omitted its session identity.")?;
        if self
            .session
            .as_deref()
            .is_some_and(|previous| previous != session)
        {
            return Err("OpenCode returned a different session.".into());
        }
        if self.session.is_none() {
            self.session = Some(session.into());
            events.emit(AgentEvent::SessionReady {
                run_id,
                session_id: session.into(),
            });
        }
        match frame["type"].as_str() {
            Some("step_start") => {
                self.finished = false;
                Ok(())
            }
            Some("reasoning") => {
                let details = frame["part"]["text"]
                    .as_str()
                    .map(describe_thinking)
                    .unwrap_or_default();
                self.record_activity(
                    &frame["part"],
                    ActivityKind::Thinking,
                    details,
                    true,
                    run_id,
                    events,
                );
                Ok(())
            }
            Some("tool_use") => {
                let part = &frame["part"];
                let tool = part["tool"].as_str().unwrap_or_default();
                let kind = ActivityKind::from_tool(tool);
                let title = part["state"]["title"].as_str();
                let input = part["state"].get("input");
                let details = describe_tool(tool, title, input, &[]);
                let done = !matches!(
                    part["state"]["status"].as_str(),
                    Some("pending" | "running")
                );
                self.record_activity(part, kind, details, done, run_id, events);
                Ok(())
            }
            Some("text") => self.text(&frame["part"], run_id, events),
            Some("step_finish") => {
                self.record_step_usage(&frame["part"], run_id, events);
                if frame["part"]["reason"] == "stop" {
                    self.finished = true;
                }
                Ok(())
            }
            Some("error") => {
                let detail = frame["error"]["data"]["message"]
                    .as_str()
                    .unwrap_or_default();
                Err(error_message(detail).into())
            }
            _ => Ok(()),
        }
    }

    fn record_activity(
        &self,
        part: &Value,
        kind: ActivityKind,
        details: ActivityDetails,
        done: bool,
        run_id: u64,
        events: &ProviderEvents,
    ) {
        if let Some(id) = part["id"].as_str() {
            events.activity_started(run_id, id, kind, details);
            if done {
                events.activity_finished(run_id, id);
            }
        }
    }

    fn text(&mut self, part: &Value, run_id: u64, events: &ProviderEvents) -> Result<(), String> {
        let id = part["id"]
            .as_str()
            .filter(|id| !id.is_empty() && id.len() <= 256)
            .ok_or("OpenCode omitted its answer identity.")?;
        if self.parts.contains(id) {
            return Ok(());
        }
        let text = part["text"]
            .as_str()
            .ok_or("OpenCode returned invalid answer text.")?;
        self.bytes = self.bytes.saturating_add(text.len());
        if self.bytes > MAX_OUTPUT || self.parts.len() >= 4096 {
            return Err("OpenCode answer exceeded its limit.".into());
        }
        self.parts.insert(id.into());
        let remaining = MAX_ASSISTANT_TEXT.saturating_sub(self.emitted);
        if remaining == 0 {
            return Ok(());
        }
        let mut end = text.len().min(remaining);
        while end > 0 && !text.is_char_boundary(end) {
            end -= 1;
        }
        if end == 0 {
            return Ok(());
        }
        let delta = &text[..end];
        self.emitted = self.emitted.saturating_add(delta.len());
        events.emit(AgentEvent::TextDelta {
            run_id,
            delta: delta.into(),
        });
        Ok(())
    }

    fn record_step_usage(&mut self, part: &Value, run_id: u64, events: &ProviderEvents) {
        let Some(tokens) = part.get("tokens").and_then(Value::as_object) else {
            return;
        };
        let non_negative = |value: Option<&Value>| {
            value
                .and_then(Value::as_i64)
                .filter(|count| *count >= 0)
                .unwrap_or(0)
        };
        let step_input = non_negative(tokens.get("input"));
        let step_output = non_negative(tokens.get("output"));
        let step_reasoning = non_negative(tokens.get("reasoning"));
        let cache = tokens.get("cache").and_then(Value::as_object);
        let step_cached = non_negative(cache.and_then(|c| c.get("read")))
            .saturating_add(non_negative(cache.and_then(|c| c.get("write"))));
        let step_context = step_input.saturating_add(step_cached);
        self.input_tokens = self.input_tokens.saturating_add(step_input);
        self.cached_input_tokens = self.cached_input_tokens.saturating_add(step_cached);
        self.output_tokens = self.output_tokens.saturating_add(step_output);
        self.reasoning_output_tokens = self.reasoning_output_tokens.saturating_add(step_reasoning);
        let session_tokens = self
            .input_tokens
            .saturating_add(self.cached_input_tokens)
            .saturating_add(self.output_tokens);
        let model_context_window = events
            .snapshot()
            .usage
            .and_then(|existing| existing.model_context_window);
        events.emit(AgentEvent::UsageUpdated {
            run_id,
            usage: UsageSnapshot {
                context_tokens: (step_context > 0).then_some(step_context),
                session_tokens,
                input_tokens: self.input_tokens,
                cached_input_tokens: self.cached_input_tokens,
                output_tokens: self.output_tokens,
                reasoning_output_tokens: (self.reasoning_output_tokens > 0)
                    .then_some(self.reasoning_output_tokens),
                model_context_window,
            },
        });
    }
}

fn error_message(detail: &str) -> &'static str {
    let lower = detail.to_ascii_lowercase();
    if authentication_required(detail) || lower.contains("api key") {
        "OpenCode needs authentication. Run opencode auth login, then Retry."
    } else if ["permission", "approval"]
        .iter()
        .any(|signal| lower.contains(signal))
    {
        "OpenCode requested a permission decision that Otto cannot display. Review OpenCode's native permission settings, then retry."
    } else if [
        "429",
        "usage limit",
        "rate limit",
        "quota",
        "insufficient credit",
    ]
    .iter()
    .any(|signal| lower.contains(signal))
    {
        "OpenCode reached the provider's usage limit. Check quota or choose another model, then Retry."
    } else if ["model", "not found", "unsupported"]
        .iter()
        .any(|signal| lower.contains(signal))
    {
        "The selected OpenCode model is unavailable. Choose another model, then Retry."
    } else if [
        "timeout",
        "timed out",
        "network",
        "connection",
        "econn",
        "dns",
    ]
    .iter()
    .any(|signal| lower.contains(signal))
    {
        "OpenCode could not reach its service. Check your internet connection, then Retry."
    } else {
        "OpenCode could not finish the answer. Check the selected model and retry."
    }
}
