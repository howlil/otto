use super::{
    admission::admit_session,
    client::{AcpClient, is_incoming_request, permission_message, rpc_error_message},
    permission::{AcpIncomingOutcome, AcpRequestContext, handle_incoming_request},
    readiness::{apply_runtime_options, model_config_id, thinking_config},
    spec::AcpSpec,
    wire::{begin, prompt_params, tool_details, tool_kind, usage_snapshot},
};
use crate::agent::events::{AgentEvent, ProviderEvents};
use crate::agent::{ActivityDetails, ActivityKind, Control, RunPhase, UsageSnapshot};
use serde_json::{Value, json};
use std::{path::Path, sync::atomic::Ordering};
use tokio::sync::mpsc;

pub(super) struct TurnState<'a> {
    name: &'static str,
    run_id: u64,
    prompt_id: u64,
    display_text: &'a str,
    acknowledged: bool,
    accumulated: String,
    context_tokens: Option<i64>,
    model_context_window: Option<i64>,
    thinking: Option<String>,
    thinking_count: u32,
}

impl<'a> TurnState<'a> {
    pub(super) fn new(
        name: &'static str,
        run_id: u64,
        prompt_id: u64,
        display_text: &'a str,
        model_context_window: Option<i64>,
    ) -> Self {
        Self {
            name,
            run_id,
            prompt_id,
            display_text,
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
            begin(events, self.run_id, self.display_text);
        }
    }
}

pub(super) fn observe_acp(
    frame: &Value,
    turn: &mut TurnState<'_>,
    events: &ProviderEvents,
) -> bool {
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

pub(in crate::agent::providers) async fn run(
    spec: &'static AcpSpec,
    mut controls: mpsc::Receiver<Control>,
    events: ProviderEvents,
    initial: Control,
) {
    let Control::Ask {
        text,
        display_text,
        cwd,
        run_id,
        model,
        thinking_effort,
        capture,
    } = initial
    else {
        return;
    };
    let name = spec.name;
    let mut client = match AcpClient::launch(spec, &cwd) {
        Ok(value) => value,
        Err(reason) => {
            events.fail(run_id, &reason);
            return;
        }
    };
    let startup = tokio::select! {
        result = async {
            let (init_result, session_result, context_window) = client.open_session(&cwd).await?;
            let admitted = admit_session(&init_result, &session_result)?;
            if capture.is_some() && !admitted.image_input {
                return Err(format!("{name} ACP runtime does not support image input."));
            }
            let model_cfg = model_config_id(&session_result);
            let mut thought_cfg = thinking_config(&session_result).map(|cfg| cfg.config_id);
            apply_runtime_options(
                &mut client,
                &admitted.session_id,
                model_cfg.as_deref(),
                &mut thought_cfg,
                model.as_deref(),
                thinking_effort.as_deref(),
            )
            .await?;
            Ok::<_, String>((
                admitted.session_id,
                admitted.image_input,
                context_window,
                model_cfg,
                thought_cfg,
            ))
        } => result,
        action = controls.recv() => {
            client.terminate().await;
            match action {
                Some(Control::Stop) => events.stopped(run_id),
                Some(Control::Close { claimed, finished })
                    if !finished.is_closed() && !claimed.swap(true, Ordering::SeqCst) =>
                {
                    events.stopped(run_id);
                    let _ = finished.send(());
                }
                _ => events.fail(run_id, &format!("{name} startup interrupted.")),
            }
            return;
        }
    };
    let (session_id, image_supported, known_context_window, model_cfg, mut thought_cfg) =
        match startup {
            Ok(value) => value,
            Err(reason) => {
                events.fail(run_id, &reason);
                client.terminate().await;
                return;
            }
        };
    events.emit(AgentEvent::SessionReady {
        run_id,
        session_id: session_id.clone(),
    });
    let prompt = match prompt_params(&session_id, &text, capture.as_ref()).await {
        Ok(params) => params,
        Err(reason) => {
            events.fail(run_id, &reason);
            client.terminate().await;
            return;
        }
    };
    let prompt_id = match client.send_request("session/prompt", prompt).await {
        Ok(id) => id,
        Err(reason) => {
            events.fail(run_id, &reason);
            client.terminate().await;
            return;
        }
    };
    let mut active_display = display_text;
    let mut active_turn = Some(TurnState::new(
        name,
        run_id,
        prompt_id,
        &active_display,
        known_context_window,
    ));
    loop {
        tokio::select! {
            action = controls.recv() => match action {
                Some(Control::Stop) if active_turn.is_some() => {
                    if let Some(turn) = active_turn.take() {
                        let _ = client
                            .send_notification("session/cancel", json!({ "sessionId": session_id }))
                            .await;
                        events.stopped(turn.run_id);
                    }
                    client.terminate().await;
                    break;
                }
                Some(Control::Close { claimed, finished }) => {
                    if finished.is_closed() || claimed.swap(true, Ordering::SeqCst) { continue; }
                    client.terminate().await;
                    let _ = finished.send(());
                    break;
                }
                Some(Control::Ask { text, display_text, cwd, run_id, model, thinking_effort, capture }) if active_turn.is_none() => {
                    if cwd.as_path() != Path::new(&events.snapshot().cwd) {
                        events.fail(run_id, &format!("{name} context changed. Start a new session."));
                        continue;
                    }
                    if capture.is_some() && !image_supported {
                        events.fail(run_id, &format!("{name} ACP runtime does not support image input."));
                        continue;
                    }
                    let current = events.snapshot();
                    let model_changed = model
                        .as_deref()
                        .filter(|value| !value.is_empty())
                        .is_some_and(|requested| current.model.as_deref() != Some(requested));
                    let effort_changed = thinking_effort
                        .as_deref()
                        .filter(|value| !value.is_empty())
                        .is_some_and(|requested| current.thinking_effort.as_deref() != Some(requested));
                    if model_changed || effort_changed {
                        if apply_runtime_options(
                            &mut client,
                            &session_id,
                            model_cfg.as_deref(),
                            &mut thought_cfg,
                            model_changed.then_some(model.as_deref()).flatten(),
                            thinking_effort.as_deref(),
                        )
                        .await
                        .is_err()
                        {
                            events.fail(run_id, &format!("{name} could not apply the requested model or thinking effort."));
                            continue;
                        }
                        events.emit(AgentEvent::RuntimeChanged {
                            run_id,
                            model: model.or(current.model),
                            thinking_effort: thought_cfg.as_ref().and(thinking_effort),
                        });
                    }
                    let next_prompt = match prompt_params(&session_id, &text, capture.as_ref()).await {
                        Ok(params) => params,
                        Err(reason) => {
                            events.fail(run_id, &reason);
                            continue;
                        }
                    };
                    let next_id = match client.send_request("session/prompt", next_prompt).await {
                        Ok(id) => id,
                        Err(_) => {
                            events.fail(run_id, &format!("{name} follow-up could not start."));
                            client.terminate().await;
                            break;
                        }
                    };
                    active_display = display_text;
                    active_turn = Some(TurnState::new(name, run_id, next_id, &active_display, known_context_window));
                }
                Some(Control::Stop) => {
                    let snapshot = events.snapshot();
                    if matches!(snapshot.status, RunPhase::Starting | RunPhase::Stopping) {
                        events.stopped(snapshot.run_id);
                    }
                }
                None => { client.terminate().await; break; }
                _ => {}
            },
            frame = async {
                if active_turn.is_some() {
                    client.read_turn().await
                } else {
                    client.read_frame().await
                }
            } => match frame {
                Ok(value) => {
                    if is_incoming_request(&value) {
                        if let Some(turn) = active_turn.as_ref() {
                            if matches!(
                                handle_incoming_request(
                                    &mut client,
                                    &mut controls,
                                    &events,
                                    AcpRequestContext {
                                        name,
                                        session_id: &session_id,
                                        run_id: turn.run_id,
                                    },
                                    &value,
                                )
                                .await,
                                AcpIncomingOutcome::Terminate
                            ) {
                                break;
                            }
                        } else {
                            let _ = client
                                .send_raw(&crate::agent::permission::unsupported_host_request_reply(
                                    &value["id"],
                                ))
                                .await;
                        }
                        continue;
                    }
                    let Some(turn) = active_turn.as_mut() else { continue; };
                    if observe_acp(&value, turn, &events) {
                        if events.snapshot().status == RunPhase::Failed {
                            client.terminate().await;
                            break;
                        }
                        active_turn = None;
                    }
                }
                Err(reason) => {
                    if let Some(turn) = active_turn.take() {
                        events.fail(turn.run_id, &reason);
                    }
                    client.terminate().await;
                    break;
                }
            }
        }
    }
    let snapshot = events.snapshot();
    if matches!(snapshot.status, RunPhase::Starting | RunPhase::Streaming) {
        events.fail(
            snapshot.run_id,
            &format!("{name} terminated before completion."),
        );
    } else if snapshot.status == RunPhase::Stopping {
        events.stopped(snapshot.run_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::AgentRuntime;

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
