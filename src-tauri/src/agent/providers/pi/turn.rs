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

pub(in crate::agent::providers) async fn run(
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
        events.fail(events.snapshot().run_id, "Pi only supports text chat.");
        return;
    };
    let mut rpc = match Rpc::launch(&cwd) {
        Ok(rpc) => rpc,
        Err(reason) => {
            events.fail(run_id, &reason);
            return;
        }
    };

    let configured = await_controlled(
        &mut controls,
        rpc.configure(model.as_deref(), thinking_effort.as_deref()),
    )
    .await;
    let (active_model, active_thinking, image_input, session) = match configured {
        Ok(Controlled::Done(configured)) => configured,
        Ok(Controlled::Cancelled(ack)) => {
            finish_cancelled(&mut rpc, &mut controls, &events, run_id, ack).await;
            return;
        }
        Err(reason) => {
            events.fail(run_id, &reason);
            rpc.terminate().await;
            return;
        }
    };
    events.emit(AgentEvent::RuntimeChanged {
        run_id,
        model: Some(active_model),
        thinking_effort: active_thinking,
    });
    if capture.is_some() && !image_input {
        events.fail(run_id, "The selected Pi model cannot accept screenshots.");
        rpc.terminate().await;
        return;
    }
    events.emit(AgentEvent::SessionReady {
        run_id,
        session_id: session,
    });
    let mut active_capture = capture;
    let prepared = await_controlled(
        &mut controls,
        prompt_command(run_id, &text, active_capture.as_ref()),
    )
    .await;
    let request = match prepared {
        Ok(Controlled::Done(request)) => request,
        Ok(Controlled::Cancelled(ack)) => {
            finish_cancelled(&mut rpc, &mut controls, &events, run_id, ack).await;
            return;
        }
        Err(reason) => {
            events.fail(run_id, &reason);
            rpc.terminate().await;
            return;
        }
    };
    match await_controlled(&mut controls, rpc.send(request)).await {
        Ok(Controlled::Done(())) => {}
        Ok(Controlled::Cancelled(ack)) => {
            finish_cancelled(&mut rpc, &mut controls, &events, run_id, ack).await;
            return;
        }
        Err(_) => {
            events.fail(run_id, "Cannot submit the Pi request.");
            rpc.terminate().await;
            return;
        }
    }
    let mut pending_display_text = display_text;
    let mut active = Some(run_id);
    let mut acknowledged = false;
    let mut settled: Option<Value> = None;
    let mut buffered: Vec<Value> = Vec::new();
    let mut observer = TurnObserver::default();
    loop {
        tokio::select! {
            control = controls.recv() => match control {
                Some(Control::Stop) if active.is_some() => {
                    let _ = timeout(Duration::from_secs(1), rpc.send(json!({"type":"abort"}))).await;
                    if let Some(id) = active {
                        stop_process(&mut rpc, &mut controls, &events, id).await;
                    }
                    break;
                }
                Some(Control::Close {claimed, finished}) => {
                    if finished.is_closed() || claimed.swap(true, Ordering::SeqCst) { continue; }
                    rpc.terminate().await;
                    let _ = finished.send(());
                    break;
                }
                Some(Control::Ask {text, display_text, cwd, run_id, model, thinking_effort, capture}) if active.is_none() => {
                    if cwd.as_path() != Path::new(&events.snapshot().cwd) {
                        events.fail(run_id, "Pi context changed. Start a new session.");
                        continue;
                    }
                    let configured = await_controlled(
                        &mut controls,
                        rpc.configure(model.as_deref(), thinking_effort.as_deref()),
                    )
                    .await;
                    let (active_model, active_thinking, selected_images, _) = match configured {
                        Ok(Controlled::Done(configured)) => configured,
                        Ok(Controlled::Cancelled(ack)) => {
                            finish_cancelled(&mut rpc, &mut controls, &events, run_id, ack).await;
                            break;
                        }
                        Err(reason) => {
                            events.fail(run_id, &reason);
                            continue;
                        }
                    };
                    if capture.is_some() && !selected_images {
                        events.fail(run_id, "The selected Pi model cannot accept screenshots.");
                        continue;
                    }
                    events.emit(AgentEvent::RuntimeChanged {
                        run_id,
                        model: Some(active_model),
                        thinking_effort: active_thinking,
                    });
                    let prepared = await_controlled(
                        &mut controls,
                        prompt_command(run_id, &text, capture.as_ref()),
                    )
                    .await;
                    let request = match prepared {
                        Ok(Controlled::Done(request)) => request,
                        Ok(Controlled::Cancelled(ack)) => {
                            finish_cancelled(&mut rpc, &mut controls, &events, run_id, ack).await;
                            break;
                        }
                        Err(reason) => {
                            events.fail(run_id, &reason);
                            continue;
                        }
                    };
                    match await_controlled(&mut controls, rpc.send(request)).await {
                        Ok(Controlled::Done(())) => {}
                        Ok(Controlled::Cancelled(ack)) => {
                            finish_cancelled(&mut rpc, &mut controls, &events, run_id, ack).await;
                            break;
                        }
                        Err(reason) => {
                            events.fail(run_id, &reason);
                            rpc.terminate().await;
                            break;
                        }
                    }
                    active_capture = capture;
                    pending_display_text = display_text;
                    active = Some(run_id);
                    acknowledged = false;
                    settled = None;
                    buffered.clear();
                    observer = TurnObserver::default();
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
                        },
                        Ok(false) => {},
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
