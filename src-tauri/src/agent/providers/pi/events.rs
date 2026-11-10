use crate::agent::providers::authentication_required;
use crate::agent::{
    RunPhase,
    events::{AgentEvent, ProviderEvents},
};
use serde_json::Value;

#[derive(Default)]
pub(super) struct TurnObserver {
    failure: Option<&'static str>,
    final_answer: bool,
}

fn failure_message(detail: &str) -> &'static str {
    if authentication_required(detail) || detail.to_ascii_lowercase().contains("api key") {
        "Pi needs authentication. Sign in to the selected provider in Pi, then Retry."
    } else if [
        "429",
        "rate limit",
        "usage limit",
        "quota",
        "insufficient credit",
    ]
    .iter()
    .any(|signal| detail.to_ascii_lowercase().contains(signal))
    {
        "Pi reached the provider's usage limit. Check quota or choose another model, then Retry."
    } else {
        "Pi could not finish the answer. Check the selected model and retry."
    }
}

impl TurnObserver {
    pub(super) fn observe(&mut self, frame: &Value, id: u64, events: &ProviderEvents) -> bool {
        let snapshot = events.snapshot();
        if snapshot.run_id != id || snapshot.status != RunPhase::Streaming {
            return false;
        }
        match frame["type"].as_str() {
            Some("message_start") if frame["message"]["role"] == "assistant" => {
                self.failure = None;
                self.final_answer = false;
                events.emit(AgentEvent::TextFinal {
                    run_id: id,
                    text: String::new(),
                });
            }
            Some("message_update") if frame["assistantMessageEvent"]["type"] == "text_delta" => {
                if let Some(delta) = frame["assistantMessageEvent"]["delta"].as_str() {
                    events.emit(AgentEvent::TextDelta {
                        run_id: id,
                        delta: delta.into(),
                    });
                }
            }
            Some("message_end") if frame["message"]["role"] == "assistant" => {
                self.message_end(&frame["message"], id, events)
            }
            Some("auto_retry_end") if frame["success"] == false => {
                self.failure = Some(failure_message(
                    frame["finalError"].as_str().unwrap_or_default(),
                ));
            }
            Some("agent_settled") => {
                if frame["aborted"] == true {
                    events.fail(id, "Pi aborted the request.");
                } else if let Some(reason) = self.failure {
                    events.fail(id, reason);
                } else if !self.final_answer
                    || snapshot.messages.last().is_none_or(|message| {
                        message.role != "assistant" || message.text.trim().is_empty()
                    })
                {
                    events.fail(id, "Pi finished without an answer.");
                } else {
                    events.emit(AgentEvent::Completed { run_id: id });
                }
                return true;
            }
            _ => {}
        }
        false
    }

    fn message_end(&mut self, message: &Value, id: u64, events: &ProviderEvents) {
        if matches!(message["stopReason"].as_str(), Some("error" | "aborted")) {
            self.failure = Some(failure_message(
                message["errorMessage"].as_str().unwrap_or_default(),
            ));
            self.final_answer = false;
            return;
        }
        if let Some(parts) = message["content"].as_array() {
            let answer: String = parts
                .iter()
                .filter(|part| part["type"] == "text")
                .filter_map(|part| part["text"].as_str())
                .collect();
            self.failure = None;
            self.final_answer = true;
            events.emit(AgentEvent::TextFinal {
                run_id: id,
                text: answer,
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::AgentRuntime;
    use serde_json::json;
    use tokio::sync::watch;

    fn state() -> (
        watch::Sender<crate::agent::Snapshot>,
        ProviderEvents,
        TurnObserver,
    ) {
        let mut snapshot = AgentRuntime::new().snapshot();
        snapshot.run_id = 7;
        snapshot.status = RunPhase::Starting;
        let (updates, _) = watch::channel(snapshot);
        let events = ProviderEvents::new(updates.clone());
        events.emit(AgentEvent::TurnStarted {
            run_id: 7,
            text: "question".into(),
        });
        (updates, events, TurnObserver::default())
    }

    #[test]
    fn usage_limit_reports_actionable_recovery_without_provider_details() {
        assert!(
            failure_message("429 You reached your usage limit secret-token")
                .contains("Check quota")
        );
        assert!(
            !failure_message("429 You reached your usage limit secret-token")
                .contains("secret-token")
        );
    }

    #[test]
    fn transient_failure_can_recover_before_settlement() {
        let (updates, events, mut observer) = state();
        assert!(!observer.observe(&json!({"type":"message_end","message":{"role":"assistant","stopReason":"error","errorMessage":"529 overloaded"}}), 7, &events));
        assert_eq!(updates.borrow().status, RunPhase::Streaming);
        assert!(!observer.observe(&json!({"type":"agent_end","willRetry":true}), 7, &events));
        observer.observe(
            &json!({"type":"message_start","message":{"role":"assistant"}}),
            7,
            &events,
        );
        observer.observe(&json!({"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"partial"}}), 7, &events);
        observer.observe(&json!({"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"recovered"}]}}), 7, &events);
        assert!(!observer.observe(&json!({"type":"agent_settled"}), 6, &events));
        assert!(observer.observe(&json!({"type":"agent_settled","aborted":false}), 7, &events));
        assert_eq!(updates.borrow().status, RunPhase::Completed);
        assert_eq!(updates.borrow().messages.last().unwrap().text, "recovered");
        observer.observe(&json!({"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"late"}}), 7, &events);
        assert_eq!(updates.borrow().messages.last().unwrap().text, "recovered");
    }

    #[test]
    fn final_auth_failure_waits_for_settlement_and_explains_recovery() {
        let (updates, events, mut observer) = state();
        observer.observe(&json!({"type":"message_end","message":{"role":"assistant","stopReason":"error","errorMessage":"401 Unauthorized secret-token-value"}}), 7, &events);
        assert_eq!(updates.borrow().status, RunPhase::Streaming);
        observer.observe(&json!({"type":"agent_settled","aborted":false}), 7, &events);
        assert_eq!(updates.borrow().status, RunPhase::Failed);
        let error = updates.borrow().error.clone().unwrap();
        assert!(error.contains("authentication"));
        assert!(!error.contains("secret-token-value"));
    }

    #[test]
    fn retry_clears_previous_partial_and_never_completes_unfinished_output() {
        let (updates, events, mut observer) = state();
        observer.observe(&json!({"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"old partial"}}), 7, &events);
        observer.observe(
            &json!({"type":"message_start","message":{"role":"assistant"}}),
            7,
            &events,
        );
        assert!(updates.borrow().messages.last().unwrap().text.is_empty());
        observer.observe(&json!({"type":"agent_settled","aborted":false}), 7, &events);
        assert_eq!(updates.borrow().status, RunPhase::Failed);
    }
}
