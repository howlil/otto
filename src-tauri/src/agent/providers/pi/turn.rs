use super::{
    cancellation::{
        Controlled, await_controlled, finish_cancelled, recv_non_permission, stop_process,
    },
    events::TurnObserver,
    readiness::usage_snapshot,
    rpc::Rpc,
};
use crate::agent::events::{AgentEvent, ProviderEvents};
use crate::agent::providers::encode_png_capture;
use crate::agent::{CapturedImage, Control, RunPhase};
use serde_json::{Value, json};
use std::{path::Path, sync::atomic::Ordering, time::Duration};
use tokio::{sync::mpsc, time::timeout};

const IDLE_STANDBY_TIMEOUT: Duration = Duration::from_secs(300);

pub(super) async fn prompt_command(
    run_id: u64,
    text: &str,
    capture: Option<&CapturedImage>,
) -> Result<Value, String> {
    let mut request = json!({"type":"prompt","id":format!("otto-{run_id}"),"message":text});
    if let Some(image) = capture {
        let path = image.path().to_owned();
        let encoded = tokio::task::spawn_blocking(move || encode_png_capture(&path))
            .await
            .map_err(|_| "Image preparation was interrupted.".to_string())??;
        request["images"] = json!([{"type":"image","data":encoded,"mimeType":"image/png"}]);
    }
    Ok(request)
}

pub(super) fn accepted_prompt(frame: &Value, run_id: u64) -> Result<bool, String> {
    if frame["type"] != "response" || frame["id"] != format!("otto-{run_id}") {
        return Ok(false);
    }
    if frame["command"] != "prompt"
        || frame["success"] != true
        || (!frame["data"]["disposition"].is_null() && frame["data"]["disposition"] != "started")
    {
        return Err("Pi rejected the requested turn.".into());
    }
    Ok(true)
}

fn begin(display_text: &str, run_id: u64, events: &ProviderEvents) {
    events.emit(AgentEvent::TurnStarted {
        run_id,
        text: display_text.to_owned(),
    });
}

struct PiSession {
    model: String,
    thinking: Option<String>,
    image_input: bool,
    session_id: String,
    session_announced: bool,
}

struct PiAsk {
    text: String,
    display_text: String,
    cwd: std::path::PathBuf,
    run_id: u64,
    model: Option<String>,
    thinking_effort: Option<String>,
    capture: Option<CapturedImage>,
}

impl PiAsk {
    fn from_control(control: Control) -> Option<Self> {
        match control {
            Control::Ask {
                text,
                display_text,
                cwd,
                run_id,
                model,
                thinking_effort,
                capture,
            } => Some(Self {
                text,
                display_text,
                cwd,
                run_id,
                model,
                thinking_effort,
                capture,
            }),
            _ => None,
        }
    }
}

struct StartedPiTurn {
    run_id: u64,
    display_text: String,
    capture: Option<CapturedImage>,
}

enum StartOutcome {
    Started(StartedPiTurn),
    Rejected,
    Terminate,
}

async fn start_pi_turn(
    rpc: &mut Rpc,
    controls: &mut mpsc::Receiver<Control>,
    events: &ProviderEvents,
    session: &mut PiSession,
    session_cwd: &Path,
    ask: PiAsk,
) -> StartOutcome {
    if ask.cwd.as_path() != session_cwd {
        events.fail(ask.run_id, "Pi context changed. Start a new session.");
        return StartOutcome::Rejected;
    }
    let needs_configure = ask
        .model
        .as_deref()
        .is_some_and(|requested| requested != session.model)
        || ask
            .thinking_effort
            .as_deref()
            .is_some_and(|requested| session.thinking.as_deref() != Some(requested));
    if needs_configure {
        let configured = await_controlled(
            controls,
            rpc.configure(ask.model.as_deref(), ask.thinking_effort.as_deref()),
        )
        .await;
        match configured {
            Ok(Controlled::Done((active_model, active_thinking, selected_images, _))) => {
                session.model = active_model;
                session.thinking = active_thinking;
                session.image_input = selected_images;
            }
            Ok(Controlled::Cancelled(ack)) => {
                finish_cancelled(rpc, controls, events, ask.run_id, ack).await;
                return StartOutcome::Terminate;
            }
            Err(reason) => {
                events.fail(ask.run_id, &reason);
                return StartOutcome::Rejected;
            }
        }
    }
    if ask.capture.is_some() && !session.image_input {
        events.fail(
            ask.run_id,
            "The selected Pi model cannot accept screenshots.",
        );
        return StartOutcome::Rejected;
    }
    events.emit(AgentEvent::RuntimeChanged {
        run_id: ask.run_id,
        model: Some(session.model.clone()),
        thinking_effort: session.thinking.clone(),
    });
    if !session.session_announced {
        events.emit(AgentEvent::SessionReady {
            run_id: ask.run_id,
            session_id: session.session_id.clone(),
        });
        session.session_announced = true;
    }
    let prepared = await_controlled(
        controls,
        prompt_command(ask.run_id, &ask.text, ask.capture.as_ref()),
    )
    .await;
    let request = match prepared {
        Ok(Controlled::Done(request)) => request,
        Ok(Controlled::Cancelled(ack)) => {
            finish_cancelled(rpc, controls, events, ask.run_id, ack).await;
            return StartOutcome::Terminate;
        }
        Err(reason) => {
            events.fail(ask.run_id, &reason);
            return StartOutcome::Rejected;
        }
    };
    match await_controlled(controls, rpc.send(request)).await {
        Ok(Controlled::Done(())) => StartOutcome::Started(StartedPiTurn {
            run_id: ask.run_id,
            display_text: ask.display_text,
            capture: ask.capture,
        }),
        Ok(Controlled::Cancelled(ack)) => {
            finish_cancelled(rpc, controls, events, ask.run_id, ack).await;
            StartOutcome::Terminate
        }
        Err(reason) => {
            events.fail(ask.run_id, &reason);
            rpc.terminate().await;
            StartOutcome::Terminate
        }
    }
}

pub(in crate::agent::providers) async fn run(
    mut controls: mpsc::Receiver<Control>,
    events: ProviderEvents,
    initial: Control,
) {
    let (cwd, init_model, init_effort, mut pending_ask) = match initial {
        Control::Warm {
            cwd,
            model,
            thinking_effort,
        } => (cwd, model, thinking_effort, None),
        other => match PiAsk::from_control(other) {
            Some(ask) => (
                ask.cwd.clone(),
                ask.model.clone(),
                ask.thinking_effort.clone(),
                Some(ask),
            ),
            None => return,
        },
    };
    let mut rpc = match Rpc::launch(&cwd) {
        Ok(rpc) => rpc,
        Err(reason) => {
            if let Some(ask) = pending_ask {
                events.fail(ask.run_id, &reason);
            }
            return;
        }
    };
    let configured = {
        let configure_fut = rpc.configure(init_model.as_deref(), init_effort.as_deref());
        tokio::pin!(configure_fut);
        loop {
            tokio::select! {
                result = &mut configure_fut => break Some(result),
                control = controls.recv() => match control {
                    Some(Control::Close { claimed, finished })
                        if !finished.is_closed() && !claimed.swap(true, Ordering::SeqCst) =>
                    {
                        if let Some(ask) = pending_ask.take() {
                            events.stopped(ask.run_id);
                        }
                        let _ = finished.send(());
                        break None;
                    }
                    Some(Control::Stop) => {
                        if let Some(ask) = pending_ask.take() {
                            events.stopped(ask.run_id);
                        }
                        break None;
                    }
                    Some(control @ Control::Ask { .. }) if pending_ask.is_none() => {
                        pending_ask = PiAsk::from_control(control);
                    }
                    None => break None,
                    _ => {}
                }
            }
        }
    };
    let Some(configured) = configured else {
        controls.close();
        rpc.terminate().await;
        return;
    };
    let mut session = match configured {
        Ok((model, thinking, image_input, session_id)) => PiSession {
            model,
            thinking,
            image_input,
            session_id,
            session_announced: false,
        },
        Err(reason) => {
            if let Some(ask) = pending_ask {
                events.fail(ask.run_id, &reason);
            }
            rpc.terminate().await;
            return;
        }
    };

    let mut active_capture: Option<CapturedImage> = None;
    let mut pending_display_text = String::new();
    let mut active: Option<u64> = None;
    let mut acknowledged = false;
    let mut settled: Option<Value> = None;
    let mut buffered: Vec<Value> = Vec::new();
    let mut observer = TurnObserver::default();

    if let Some(ask) = pending_ask.take() {
        match start_pi_turn(&mut rpc, &mut controls, &events, &mut session, &cwd, ask).await {
            StartOutcome::Started(turn) => {
                active = Some(turn.run_id);
                pending_display_text = turn.display_text;
                active_capture = turn.capture;
            }
            StartOutcome::Rejected => {}
            StartOutcome::Terminate => return,
        }
    }

    loop {
        let idle_deadline = tokio::time::sleep(IDLE_STANDBY_TIMEOUT);
        tokio::pin!(idle_deadline);
        tokio::select! {
            _ = &mut idle_deadline, if active.is_none() => {
                rpc.terminate().await;
                break;
            }
            control = controls.recv() => match control {
                Some(Control::Stop) if active.is_some() => {
                    let _ = timeout(Duration::from_secs(1), rpc.send(json!({"type":"abort"}))).await;
                    if let Some(id) = active {
                        stop_process(&mut rpc, &mut controls, &events, id).await;
                    }
                    break;
                }
                Some(Control::Close { claimed, finished }) => {
                    if finished.is_closed() || claimed.swap(true, Ordering::SeqCst) { continue; }
                    rpc.terminate().await;
                    let _ = finished.send(());
                    break;
                }
                Some(control @ Control::Ask { .. }) if active.is_none() => {
                    let Some(ask) = PiAsk::from_control(control) else {
                        continue;
                    };
                    match start_pi_turn(&mut rpc, &mut controls, &events, &mut session, &cwd, ask)
                        .await
                    {
                        StartOutcome::Started(turn) => {
                            active_capture = turn.capture;
                            pending_display_text = turn.display_text;
                            active = Some(turn.run_id);
                            acknowledged = false;
                            settled = None;
                            buffered.clear();
                            observer = TurnObserver::default();
                        }
                        StartOutcome::Rejected => {}
                        StartOutcome::Terminate => break,
                    }
                }
                Some(Control::Stop) => {
                    let snapshot = events.snapshot();
                    if matches!(snapshot.status, RunPhase::Starting | RunPhase::Stopping) {
                        events.stopped(snapshot.run_id);
                    }
                }
                None => { rpc.terminate().await; break; }
                _ => {}
            },
            frame = async {
                if active.is_some() {
                    rpc.read_turn().await
                } else {
                    rpc.read().await
                }
            } => match frame {
                Ok(value) => {
                    let Some(id) = active else { continue; };
                    match accepted_prompt(&value, id) {
                        Ok(true) => {
                            if acknowledged {
                                events.fail(id, "Pi duplicated the prompt acknowledgement.");
                                rpc.terminate().await;
                                break;
                            }
                            acknowledged = true;
                            begin(&pending_display_text, id, &events);
                            for event in buffered.drain(..) {
                                observer.observe(&event, id, &events);
                            }
                        }
                        Ok(false) => {}
                        Err(reason) => { events.fail(id, &reason); rpc.terminate().await; break; }
                    }
                    if value["type"] == "agent_settled" {
                        settled = Some(value);
                    } else if matches!(
                        value["type"].as_str(),
                        Some(
                            "message_start"
                                | "message_update"
                                | "message_end"
                                | "auto_retry_end"
                                | "tool_execution_start"
                                | "tool_execution_end"
                        )
                    ) {
                        if acknowledged {
                            observer.observe(&value, id, &events);
                        } else if buffered.len() < 256 {
                            buffered.push(value);
                        } else {
                            events.fail(id, "Pi sent excessive output before acknowledgement.");
                            rpc.terminate().await;
                            break;
                        }
                    }
                    if acknowledged && let Some(settlement) = settled.take() {
                        if settlement["aborted"] != true {
                            let stats = tokio::select! {
                                result = timeout(
                                    Duration::from_secs(2),
                                    rpc.request(json!({"type":"get_session_stats"}))
                                ) => result.ok().and_then(Result::ok),
                                control = recv_non_permission(&mut controls) => {
                                    let close_ack = match control {
                                        Some(Control::Close { claimed, finished })
                                            if !finished.is_closed()
                                                && !claimed.swap(true, Ordering::SeqCst) =>
                                        {
                                            Some(finished)
                                        }
                                        _ => None,
                                    };
                                    stop_process(&mut rpc, &mut controls, &events, id).await;
                                    if let Some(finished) = close_ack {
                                        let _ = finished.send(());
                                    }
                                    break;
                                }
                            };
                            if let Some(usage) = stats.as_ref().and_then(usage_snapshot) {
                                events.emit(AgentEvent::UsageUpdated { run_id: id, usage });
                            }
                        }
                        observer.observe(&settlement, id, &events);
                        active = None;
                        drop(active_capture.take());
                    }
                }
                Err(reason) => {
                    if let Some(id) = active { events.fail(id, &reason); }
                    rpc.terminate().await;
                    break;
                }
            }
        }
    }
    let snapshot = events.snapshot();
    if matches!(snapshot.status, RunPhase::Starting | RunPhase::Streaming) {
        events.fail(snapshot.run_id, "Pi exited before completing the answer.");
    } else if snapshot.status == RunPhase::Stopping {
        events.stopped(snapshot.run_id);
    }
}
