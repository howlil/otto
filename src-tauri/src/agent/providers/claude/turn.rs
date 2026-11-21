use super::{
    process::{PersistentClaude, bounded_line_error, prepare_input_payload},
    readiness::{valid_claude_effort, valid_claude_model_id},
    stream::{MAX_FRAME_BYTES, TURN_IDLE_TIMEOUT, TurnStream, failure_message},
};
use crate::agent::events::{AgentEvent, ProviderEvents};
use crate::agent::providers::read_bounded_line;
use crate::agent::{CapturedImage, Control};
use serde_json::Value;
use std::{path::Path, sync::atomic::Ordering, time::Duration};
use tokio::{sync::mpsc, time::timeout};

const IDLE_STANDBY_TIMEOUT: Duration = Duration::from_secs(300);

enum TurnOutcome {
    Completed {
        session_id: Option<String>,
        keep_alive: bool,
    },
    Failed(Option<String>),
    Stopped(Option<String>),
    Closed,
}

struct TurnRequest<'a> {
    run_id: u64,
    text: &'a str,
    display_text: &'a str,
    cwd: &'a Path,
    session: Option<&'a str>,
    model: Option<&'a str>,
    thinking_effort: Option<&'a str>,
    capture: Option<&'a CapturedImage>,
}

async fn send_payload_with_recovery(
    live: &mut Option<PersistentClaude>,
    cwd: &Path,
    session: Option<&str>,
    model: Option<&str>,
    effort: Option<&str>,
    payload: Vec<u8>,
) -> Result<(), String> {
    let reused = live
        .as_ref()
        .is_some_and(|existing| existing.matches(cwd, model, effort));
    if !reused && let Some(mut stale) = live.take() {
        stale.terminate().await;
    }
    if live.is_none() {
        *live = Some(PersistentClaude::spawn(cwd, session, model, effort)?);
    }
    let send_result = live
        .as_mut()
        .ok_or("Claude Code process is unavailable.")?
        .process
        .send_line(payload.clone(), "Claude Code input disconnected.")
        .await;
    if send_result.is_ok() {
        return Ok(());
    }
    if let Some(mut dead) = live.take() {
        dead.terminate().await;
    }
    if !reused {
        return send_result;
    }
    *live = Some(PersistentClaude::spawn(cwd, session, model, effort)?);
    let retry = live
        .as_mut()
        .ok_or("Claude Code process is unavailable.")?
        .process
        .send_line(payload, "Claude Code input disconnected.")
        .await;
    if retry.is_err()
        && let Some(mut dead) = live.take()
    {
        dead.terminate().await;
    }
    retry
}

async fn run_turn(
    live: &mut Option<PersistentClaude>,
    controls: &mut mpsc::Receiver<Control>,
    events: &ProviderEvents,
    request: TurnRequest<'_>,
) -> TurnOutcome {
    let TurnRequest {
        run_id,
        text,
        display_text,
        cwd,
        session,
        model,
        thinking_effort,
        capture,
    } = request;
    let selected_model = match model.filter(|value| !value.is_empty()) {
        Some(value) if valid_claude_model_id(value) => Some(value.to_owned()),
        Some(_) => {
            events.fail(
                run_id,
                "The selected Claude Code model is unavailable. Choose an available model.",
            );
            return TurnOutcome::Failed(session.map(str::to_owned));
        }
        None => None,
    };
    let selected_effort = match thinking_effort.filter(|value| !value.is_empty()) {
        Some(value) if valid_claude_effort(value) => Some(value.to_owned()),
        Some(_) => {
            events.fail(
                run_id,
                "Selected thinking effort is not supported by Claude Code.",
            );
            return TurnOutcome::Failed(session.map(str::to_owned));
        }
        None => None,
    };
    let payload = match prepare_input_payload(text, capture).await {
        Ok(payload) => payload,
        Err(reason) => {
            events.fail(run_id, &reason);
            return TurnOutcome::Failed(session.map(str::to_owned));
        }
    };
    if let Err(reason) = send_payload_with_recovery(
        live,
        cwd,
        session,
        selected_model.as_deref(),
        selected_effort.as_deref(),
        payload,
    )
    .await
    {
        events.fail(run_id, &reason);
        return TurnOutcome::Failed(session.map(str::to_owned));
    }
    events.emit(AgentEvent::RuntimeChanged {
        run_id,
        model: selected_model,
        thinking_effort: selected_effort,
    });
    events.emit(AgentEvent::TurnStarted {
        run_id,
        text: display_text.to_owned(),
    });
    let mut stream = TurnStream::default();
    loop {
        let Some(active) = live.as_mut() else {
            return TurnOutcome::Failed(stream.session_id);
        };
        tokio::select! {
            control = controls.recv() => match control {
                Some(Control::Stop) => {
                    if let Some(mut running) = live.take() {
                        running.terminate().await;
                    }
                    events.stopped(run_id);
                    return TurnOutcome::Stopped(stream.session_id);
                }
                Some(Control::Close { claimed, finished }) => {
                    if finished.is_closed() || claimed.swap(true, Ordering::SeqCst) {
                        continue;
                    }
                    if let Some(mut running) = live.take() {
                        running.terminate().await;
                    }
                    let _ = finished.send(());
                    return TurnOutcome::Closed;
                }
                Some(Control::Ask { run_id: next_run_id, .. }) => {
                    if let Some(mut running) = live.take() {
                        running.terminate().await;
                    }
                    events.fail(next_run_id, "Claude Code was still processing the previous request. Retry this prompt.");
                    return TurnOutcome::Failed(stream.session_id);
                }
                Some(Control::PermissionDecision { .. } | Control::Warm { .. }) => {}
                None => {
                    if let Some(mut running) = live.take() {
                        running.terminate().await;
                    }
                    return TurnOutcome::Closed;
                }
            },
            line = timeout(TURN_IDLE_TIMEOUT, read_bounded_line(active.process.reader(), MAX_FRAME_BYTES)) => match line {
                Err(_) => {
                    if let Some(mut running) = live.take() {
                        running.terminate().await;
                    }
                    events.fail(run_id, "Claude Code stopped responding. Check connectivity, then retry.");
                    return TurnOutcome::Failed(stream.session_id);
                }
                Ok(Err(error)) => {
                    if let Some(mut running) = live.take() {
                        running.terminate().await;
                    }
                    events.fail(run_id, bounded_line_error(error));
                    return TurnOutcome::Failed(stream.session_id);
                }
                Ok(Ok(Some(line))) => {
                    let frame = match serde_json::from_str::<Value>(&line) {
                        Ok(frame) => frame,
                        Err(_) => {
                            if let Some(mut running) = live.take() {
                                running.terminate().await;
                            }
                            events.fail(run_id, "Claude Code returned an invalid stream event.");
                            return TurnOutcome::Failed(stream.session_id);
                        }
                    };
                    if let Err(reason) = stream.observe(&frame, run_id, events) {
                        if let Some(mut running) = live.take() {
                            running.terminate().await;
                        }
                        events.fail(run_id, &reason);
                        return TurnOutcome::Failed(stream.session_id);
                    }
                    if stream.result_seen {
                        let session_id = stream.session_id.clone();
                        match stream.finish(run_id, events) {
                            Ok(session_id) => {
                                return TurnOutcome::Completed {
                                    session_id,
                                    keep_alive: true,
                                };
                            }
                            Err(reason) => {
                                if let Some(mut running) = live.take() {
                                    running.terminate().await;
                                }
                                events.fail(run_id, &reason);
                                return TurnOutcome::Failed(session_id);
                            }
                        }
                    }
                }
                Ok(Ok(None)) => {
                    let exited_ok = timeout(Duration::from_secs(5), active.process.wait_success())
                        .await
                        .ok()
                        .and_then(Result::ok)
                        .is_some();
                    if let Some(mut running) = live.take() {
                        running.terminate().await;
                    }
                    if !exited_ok {
                        let error = stream
                            .failure
                            .as_deref()
                            .map(failure_message)
                            .unwrap_or("Claude Code could not complete the request. Check its native configuration, then retry.");
                        events.fail(run_id, error);
                        return TurnOutcome::Failed(stream.session_id);
                    }
                    let session_id = stream.session_id.clone();
                    match stream.finish(run_id, events) {
                        Ok(session_id) => {
                            return TurnOutcome::Completed {
                                session_id,
                                keep_alive: false,
                            };
                        }
                        Err(reason) => {
                            events.fail(run_id, &reason);
                            return TurnOutcome::Failed(session_id);
                        }
                    }
                }
            }
        }
    }
}

pub(in crate::agent::providers) async fn run(
    mut controls: mpsc::Receiver<Control>,
    events: ProviderEvents,
    initial: Control,
) {
    let mut live: Option<PersistentClaude> = None;
    let mut session: Option<String> = None;
    let mut next: Option<Control> = match initial {
        Control::Warm {
            cwd,
            model,
            thinking_effort,
        } => {
            let valid_model = model
                .as_deref()
                .filter(|value| valid_claude_model_id(value));
            let valid_effort = thinking_effort
                .as_deref()
                .filter(|value| valid_claude_effort(value));
            if let Ok(started) = PersistentClaude::spawn(&cwd, None, valid_model, valid_effort) {
                live = Some(started);
            }
            None
        }
        ask @ Control::Ask { .. } => Some(ask),
        _ => return,
    };

    loop {
        if let Some(Control::Ask {
            text,
            display_text,
            cwd,
            run_id,
            model,
            thinking_effort,
            capture,
        }) = next.take()
        {
            match run_turn(
                &mut live,
                &mut controls,
                &events,
                TurnRequest {
                    run_id,
                    text: &text,
                    display_text: &display_text,
                    cwd: &cwd,
                    session: session.as_deref(),
                    model: model.as_deref(),
                    thinking_effort: thinking_effort.as_deref(),
                    capture: capture.as_ref(),
                },
            )
            .await
            {
                TurnOutcome::Completed {
                    session_id,
                    keep_alive,
                } => {
                    if session_id.is_some() {
                        session = session_id;
                    }
                    if !keep_alive && let Some(mut dead) = live.take() {
                        dead.terminate().await;
                    }
                }
                TurnOutcome::Failed(next_session) | TurnOutcome::Stopped(next_session) => {
                    if next_session.is_some() {
                        session = next_session;
                    }
                }
                TurnOutcome::Closed => return,
            }
        }
        let idle_wait = timeout(IDLE_STANDBY_TIMEOUT, controls.recv()).await;
        match idle_wait {
            Ok(Some(next_control @ Control::Ask { .. })) => {
                next = Some(next_control);
            }
            Ok(Some(Control::Close { claimed, finished })) => {
                if finished.is_closed() || claimed.swap(true, Ordering::SeqCst) {
                    continue;
                }
                if let Some(mut running) = live.take() {
                    running.terminate().await;
                }
                let _ = finished.send(());
                return;
            }
            Ok(Some(Control::Stop)) => {
                events.stopped(events.snapshot().run_id);
            }
            Ok(Some(Control::PermissionDecision { .. } | Control::Warm { .. })) => {}
            Ok(None) | Err(_) => {
                if let Some(mut running) = live.take() {
                    running.terminate().await;
                }
                return;
            }
        }
    }
}
