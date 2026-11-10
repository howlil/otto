use super::{AGENT, MAX_OUTPUT, Profile, probe};
use crate::agent::providers::{
    authentication_required, read_bounded_line, transport::JsonlProcess,
};
use crate::agent::{
    Control,
    events::{AgentEvent, ProviderEvents},
};
use serde_json::Value;
use std::{collections::HashSet, sync::atomic::Ordering, time::Duration};
use tokio::{sync::mpsc, time::timeout};

#[derive(Default)]
struct Turn {
    session: Option<String>,
    parts: HashSet<String>,
    bytes: usize,
    finished: bool,
}

impl Turn {
    fn observe(
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
        self.session = Some(session.into());
        match frame["type"].as_str() {
            Some("step_start") => { self.finished = false; Ok(()) },
            Some("reasoning") => Ok(()),
            Some("text") => self.text(&frame["part"], run_id, events),
            Some("step_finish") if frame["part"]["reason"] == "stop" => { self.finished = true; Ok(()) },
            Some("error") => {
                let detail = frame["error"]["data"]["message"].as_str().unwrap_or_default();
                if authentication_required(detail) || detail.to_ascii_lowercase().contains("api key") {
                    Err("OpenCode needs authentication. Run opencode auth login, then Retry.".into())
                } else if ["429", "usage limit", "rate limit", "quota", "insufficient credit"].iter().any(|signal| detail.to_ascii_lowercase().contains(signal)) {
                    Err("OpenCode reached the provider's usage limit. Check quota or choose another model, then Retry.".into())
                } else { Err("OpenCode could not finish the answer. Check the selected model and retry.".into()) }
            }
            _ => Err("OpenCode requested a tool or returned an unsupported chat event. The request was stopped.".into()),
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
        events.emit(AgentEvent::TextDelta {
            run_id,
            delta: text.into(),
        });
        Ok(())
    }
}

async fn execute(
    events: &ProviderEvents,
    run_id: u64,
    text: &str,
    display_text: &str,
    model: Option<&str>,
    active: &mut Option<JsonlProcess>,
    profile: &mut Option<Profile>,
) -> Result<(), String> {
    let (verified, _, selected) = probe(model).await?;
    let process = verified.launch(&[
        "run", "--format", "json", "--agent", AGENT, "--model", &selected,
    ])?;
    *profile = Some(verified);
    *active = Some(process);
    let process = active.as_mut().ok_or("OpenCode process is unavailable.")?;
    events.emit(AgentEvent::RuntimeChanged {
        run_id,
        model: Some(selected),
        thinking_effort: None,
    });
    events.emit(AgentEvent::TurnStarted {
        run_id,
        text: display_text.into(),
    });
    process
        .send_line(
            text.as_bytes().to_vec(),
            "OpenCode disconnected before receiving the question.",
        )
        .await?;
    process.close_input();
    let mut turn = Turn::default();
    while let Some(line) = read_bounded_line(process.reader(), MAX_OUTPUT)
        .await
        .map_err(|_| "OpenCode returned an invalid or oversized event.")?
    {
        let frame: Value =
            serde_json::from_str(&line).map_err(|_| "OpenCode returned an invalid chat event.")?;
        turn.observe(&frame, run_id, events)?;
    }
    process.wait_success().await?;
    if !turn.finished {
        return Err("OpenCode disconnected before finishing the answer.".into());
    }
    Ok(())
}

pub async fn run(mut controls: mpsc::Receiver<Control>, events: ProviderEvents, initial: Control) {
    let Control::Ask {
        text,
        display_text,
        run_id,
        model,
        thinking_effort,
        capture,
        ..
    } = initial
    else {
        events.fail(events.snapshot().run_id, "OpenCode requires a question.");
        return;
    };
    if capture.is_some() || thinking_effort.is_some() {
        events.fail(
            run_id,
            "OpenCode supports text chat without thinking-effort overrides.",
        );
        return;
    }
    let mut active = None;
    let mut profile = None;
    let mut close = None;
    let outcome = tokio::select! {
        biased;
        control = controls.recv() => {
            if let Some(Control::Close { claimed, finished }) = control
                && !claimed.swap(true, Ordering::SeqCst) { close = Some(finished); }
            None
        },
        result = timeout(Duration::from_secs(120), execute(&events, run_id, &text, &display_text, model.as_deref(), &mut active, &mut profile)) => {
            Some(result.unwrap_or_else(|_| Err("OpenCode answer timed out. Check connectivity or provider usage limits, then Retry.".into())))
        }
    };
    if let Some(process) = active.as_mut() {
        process.kill_now().await;
    }
    drop(active);
    drop(profile);
    drop(controls);
    match outcome {
        Some(Ok(())) => events.emit(AgentEvent::Completed { run_id }),
        Some(Err(reason)) => events.fail(run_id, &reason),
        None => events.stopped(run_id),
    }
    if let Some(finished) = close {
        let _ = finished.send(());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::{AgentRuntime, RunPhase};
    use serde_json::json;
    use tokio::sync::watch;

    #[test]
    fn protocol_deduplicates_parts_and_does_not_complete_at_step_finish() {
        let mut snapshot = AgentRuntime::new().snapshot();
        snapshot.run_id = 7;
        snapshot.status = RunPhase::Starting;
        let (updates, _) = watch::channel(snapshot);
        let events = ProviderEvents::new(updates.clone());
        events.emit(AgentEvent::TurnStarted {
            run_id: 7,
            text: "question".into(),
        });
        let mut turn = Turn::default();
        let text =
            json!({"type":"text","sessionID":"session-1","part":{"id":"part-1","text":"answer"}});
        turn.observe(&text, 7, &events).unwrap();
        turn.observe(&text, 7, &events).unwrap();
        assert_eq!(updates.borrow().messages.last().unwrap().text, "answer");
        turn.observe(
            &json!({"type":"step_finish","sessionID":"session-1","part":{"reason":"stop"}}),
            7,
            &events,
        )
        .unwrap();
        assert!(turn.finished);
        assert_eq!(updates.borrow().status, RunPhase::Streaming);
        for frame in [
            json!({"type":"tool_use","sessionID":"session-1"}),
            json!({"type":"text","sessionID":"session-1","part":{"id":"x".repeat(257),"text":"answer"}}),
            json!({"type":"text","sessionID":"x".repeat(257)}),
            json!({"type":"text","sessionID":"other"}),
            json!({"type":"step_finish","sessionID":"session-1","part":{"reason":"tool-calls"}}),
            json!({"type":"error","sessionID":"session-1","error":{"data":{"message":"Unauthorized"}}}),
        ] {
            assert!(turn.observe(&frame, 7, &events).is_err());
        }
    }
}
