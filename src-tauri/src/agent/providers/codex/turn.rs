use super::{
    events::handle_event,
    permission::{IncomingOutcome, handle_incoming_request},
    requests,
    rpc::{MAX_RPC_FRAME_BYTES, Rpc, bounded_line_error},
};
use crate::agent::events::{AgentEvent, ProviderEvents};
use crate::agent::permission::unsupported_host_request_reply;
use crate::agent::providers::read_bounded_line;
use crate::agent::{CapturedImage, Control, RunPhase};
use serde_json::{Value, json};
use std::{sync::atomic::Ordering, time::Duration};
use tokio::{sync::mpsc, time::timeout};

const WARM_STANDBY_TIMEOUT: Duration = Duration::from_secs(60);
const IDLE_STANDBY_TIMEOUT: Duration = Duration::from_secs(180);

struct TurnLaunch<'a> {
    thread: &'a str,
    text: &'a str,
    display_text: &'a str,
    model: Option<&'a str>,
    thinking_effort: Option<&'a str>,
    capture: Option<CapturedImage>,
    run_id: u64,
}

struct ActiveTurn {
    run_id: u64,
    turn_id: String,
    _capture: Option<CapturedImage>,
}

async fn begin_turn(
    rpc: &mut Rpc,
    launch: &TurnLaunch<'_>,
    updates: &ProviderEvents,
    controls: Option<&mut mpsc::Receiver<Control>>,
) -> Result<Option<(String, Vec<Value>)>, String> {
    let response = rpc
        .request_controlled(
            "turn/start",
            requests::turn_start_with_image(
                launch.thread,
                launch.text,
                launch.model,
                launch.thinking_effort,
                launch.capture.as_ref().map(|image| image.path()),
            ),
            controls,
        )
        .await?;
    let Some((result, buffered)) = response else {
        return Ok(None);
    };
    let turn = result
        .pointer("/turn/id")
        .and_then(Value::as_str)
        .ok_or("Codex returned no turn ID.")?
        .to_owned();
    updates.emit(AgentEvent::RuntimeChanged {
        run_id: launch.run_id,
        model: result["turn"]["model"]
            .as_str()
            .map(str::to_owned)
            .or_else(|| launch.model.map(str::to_owned)),
        thinking_effort: result["turn"]["reasoningEffort"]
            .as_str()
            .map(str::to_owned)
            .or_else(|| launch.thinking_effort.map(str::to_owned)),
    });
    updates.emit(AgentEvent::TurnStarted {
        run_id: launch.run_id,
        text: launch.display_text.to_owned(),
    });
    Ok(Some((turn, buffered)))
}

async fn start_active_turn(
    rpc: &mut Rpc,
    controls: &mut mpsc::Receiver<Control>,
    updates: &ProviderEvents,
    launch: TurnLaunch<'_>,
) -> Result<Option<ActiveTurn>, bool> {
    let started = begin_turn(rpc, &launch, updates, Some(controls)).await;
    let TurnLaunch {
        thread,
        capture,
        run_id,
        ..
    } = launch;
    let (turn_id, buffered) = match started {
        Ok(Some(value)) => value,
        Ok(None) => {
            updates.stopped(run_id);
            rpc.terminate().await;
            return Err(true);
        }
        Err(error) => {
            updates.fail(run_id, &error);
            rpc.terminate().await;
            return Err(true);
        }
    };
    for msg in buffered {
        if handle_event(&msg, thread, &turn_id, run_id, updates) {
            drop(capture);
            if updates.snapshot().status == RunPhase::Failed {
                rpc.terminate().await;
                return Err(true);
            }
            return Ok(None);
        }
    }
    Ok(Some(ActiveTurn {
        run_id,
        turn_id,
        _capture: capture,
    }))
}

pub(in crate::agent::providers) async fn run(
    mut controls: mpsc::Receiver<Control>,
    updates: ProviderEvents,
    initial: Control,
) {
    let (cwd, init_model, init_effort, mut pending_ask) = match initial {
        Control::Warm {
            cwd,
            model,
            thinking_effort,
        } => (cwd, model, thinking_effort, None),
        Control::Ask {
            text,
            display_text,
            cwd,
            run_id,
            model,
            thinking_effort,
            capture,
        } => (
            cwd.clone(),
            model.clone(),
            thinking_effort.clone(),
            Some(Control::Ask {
                text,
                display_text,
                cwd,
                run_id,
                model,
                thinking_effort,
                capture,
            }),
        ),
        _ => return,
    };
    let mut rpc = match Rpc::launch(&cwd) {
        Ok(rpc) => rpc,
        Err(e) => {
            if let Some(Control::Ask { run_id, .. }) = pending_ask {
                updates.fail(run_id, &e);
            }
            return;
        }
    };

    let result = {
        let init_fut = async {
            rpc.request(
                "initialize",
                json!({ "clientInfo": { "name": "otto", "title": "Otto", "version": env!("CARGO_PKG_VERSION") } }),
            )
            .await?;
            rpc.send(json!({ "method": "initialized", "params": {} }))
                .await?;
            let (thread_response, _) = rpc
                .request(
                    "thread/start",
                    requests::thread_start(
                        &cwd.to_string_lossy(),
                        init_model.as_deref(),
                        init_effort.as_deref(),
                    ),
                )
                .await?;
            let thread = thread_response
                .pointer("/thread/id")
                .and_then(Value::as_str)
                .ok_or("Codex returned no thread ID.")?
                .to_owned();
            Ok::<_, String>(thread)
        };
        tokio::pin!(init_fut);
        loop {
            tokio::select! {
                result = &mut init_fut => break Some(result),
                command = controls.recv() => match command {
                    Some(Control::Close { claimed, finished })
                        if !finished.is_closed() && !claimed.swap(true, Ordering::SeqCst) =>
                    {
                        if let Some(Control::Ask { run_id, .. }) = pending_ask.take() {
                            updates.stopped(run_id);
                        }
                        let _ = finished.send(());
                        break None;
                    }
                    Some(Control::Stop) => {
                        if let Some(Control::Ask { run_id, .. }) = pending_ask.take() {
                            updates.stopped(run_id);
                        }
                        break None;
                    }
                    Some(ask @ Control::Ask { .. }) if pending_ask.is_none() => {
                        pending_ask = Some(ask);
                    }
                    None => break None,
                    _ => {}
                }
            }
        }
    };
    let Some(result) = result else {
        rpc.terminate().await;
        return;
    };
    let thread = match result {
        Ok(thread) => thread,
        Err(error) => {
            if let Some(Control::Ask { run_id, .. }) = pending_ask {
                updates.fail(run_id, &error);
            }
            rpc.terminate().await;
            return;
        }
    };

    let mut session_announced = false;
    let mut active_turn: Option<ActiveTurn> = None;
    if let Some(Control::Ask {
        text,
        display_text,
        cwd: next_cwd,
        run_id,
        model,
        thinking_effort,
        capture,
    }) = pending_ask.take()
    {
        if next_cwd.as_path() != cwd.as_path() {
            updates.fail(run_id, "Codex context changed. Start a new session.");
            rpc.terminate().await;
            return;
        }
        updates.emit(AgentEvent::SessionReady {
            run_id,
            session_id: thread.clone(),
        });
        session_announced = true;
        match start_active_turn(
            &mut rpc,
            &mut controls,
            &updates,
            TurnLaunch {
                thread: &thread,
                text: &text,
                display_text: &display_text,
                model: model.as_deref(),
                thinking_effort: thinking_effort.as_deref(),
                capture,
                run_id,
            },
        )
        .await
        {
            Ok(turn) => active_turn = turn,
            Err(_) => return,
        }
    }

    loop {
        let standby = if session_announced {
            IDLE_STANDBY_TIMEOUT
        } else {
            WARM_STANDBY_TIMEOUT
        };
        let idle_deadline = tokio::time::sleep(standby);
        tokio::pin!(idle_deadline);
        tokio::select! {
            _ = &mut idle_deadline, if active_turn.is_none() => {
                rpc.terminate().await;
                break;
            }
            command = controls.recv() => match command {
                Some(Control::Close { claimed, finished }) => {
                    if finished.is_closed() || claimed.swap(true, Ordering::SeqCst) {
                        continue;
                    }
                    rpc.terminate().await;
                    let _ = finished.send(());
                    break;
                }
                Some(Control::Stop) => {
                    if let Some(turn) = active_turn.take() {
                        let _ = timeout(
                            Duration::from_secs(5),
                            rpc.request(
                                "turn/interrupt",
                                json!({ "threadId": thread, "turnId": turn.turn_id }),
                            ),
                        )
                        .await;
                        updates.stopped(turn.run_id);
                        rpc.terminate().await;
                        break;
                    }
                    let state = updates.snapshot();
                    if matches!(state.status, RunPhase::Starting | RunPhase::Stopping) {
                        updates.stopped(state.run_id);
                    }
                }
                Some(Control::Ask {
                    text,
                    display_text,
                    cwd: next_cwd,
                    run_id,
                    model,
                    thinking_effort,
                    capture,
                }) if active_turn.is_none() => {
                    if next_cwd.as_path() != cwd.as_path() {
                        updates.fail(run_id, "Codex context changed. Start a new session.");
                        continue;
                    }
                    if !session_announced {
                        updates.emit(AgentEvent::SessionReady {
                            run_id,
                            session_id: thread.clone(),
                        });
                        session_announced = true;
                    }
                    match start_active_turn(
                        &mut rpc,
                        &mut controls,
                        &updates,
                        TurnLaunch {
                            thread: &thread,
                            text: &text,
                            display_text: &display_text,
                            model: model.as_deref(),
                            thinking_effort: thinking_effort.as_deref(),
                            capture,
                            run_id,
                        },
                    )
                    .await
                    {
                        Ok(next) => active_turn = next,
                        Err(_) => break,
                    }
                }
                None => {
                    rpc.terminate().await;
                    break;
                }
                _ => {}
            },
            line = read_bounded_line(rpc.process.reader(), MAX_RPC_FRAME_BYTES) => match line {
                Ok(Some(line)) => {
                    let Ok(msg) = serde_json::from_str::<Value>(&line) else {
                        if let Some(turn) = active_turn.take() {
                            updates.fail(turn.run_id, "Invalid Codex stream.");
                        }
                        rpc.terminate().await;
                        break;
                    };
                    if msg.get("method").is_some() && msg.get("id").is_some() {
                        if let Some(turn) = active_turn.as_ref() {
                            if matches!(
                                handle_incoming_request(
                                    &mut rpc,
                                    &mut controls,
                                    &updates,
                                    &thread,
                                    turn.run_id,
                                    &turn.turn_id,
                                    &msg,
                                )
                                .await,
                                IncomingOutcome::Terminate
                            ) {
                                break;
                            }
                        } else {
                            let _ = rpc.send(unsupported_host_request_reply(&msg["id"])).await;
                        }
                    } else if let Some(turn) = active_turn.as_ref()
                        && handle_event(&msg, &thread, &turn.turn_id, turn.run_id, &updates)
                    {
                        active_turn = None;
                        if updates.snapshot().status == RunPhase::Failed {
                            rpc.terminate().await;
                            break;
                        }
                    }
                }
                Ok(None) => {
                    if let Some(turn) = active_turn.take() {
                        updates.fail(turn.run_id, "Codex disconnected.");
                    }
                    break;
                }
                Err(error) => {
                    if let Some(turn) = active_turn.take() {
                        updates.fail(turn.run_id, bounded_line_error(error));
                    }
                    rpc.terminate().await;
                    break;
                }
            }
        }
    }

    let state = updates.snapshot();
    match state.status {
        RunPhase::Starting | RunPhase::Streaming => updates.fail(
            state.run_id,
            "Codex connection closed before the answer finished.",
        ),
        RunPhase::Stopping => updates.stopped(state.run_id),
        _ => {}
    }
}
