use super::{
    admission::admit_session,
    client::{AcpClient, is_incoming_request},
    observe::{TurnState, observe_acp},
    permission::{AcpIncomingOutcome, AcpRequestContext, handle_incoming_request},
    readiness::{apply_runtime_options, model_config_id, thinking_config},
    spec::AcpSpec,
    wire::prompt_params,
};
use crate::agent::events::{AgentEvent, ProviderEvents};
use crate::agent::{CapturedImage, Control, RunPhase};
use serde_json::json;
use std::{path::Path, sync::atomic::Ordering, time::Duration};
use tokio::sync::mpsc;

const WARM_STANDBY_TIMEOUT: Duration = Duration::from_secs(60);
const IDLE_STANDBY_TIMEOUT: Duration = Duration::from_secs(180);

struct AcpSession {
    session_id: String,
    image_supported: bool,
    context_window: Option<i64>,
    model_cfg: Option<String>,
    thought_cfg: Option<String>,
    applied_model: Option<String>,
    applied_effort: Option<String>,
    session_announced: bool,
}

struct AcpAsk {
    text: String,
    display_text: String,
    cwd: std::path::PathBuf,
    run_id: u64,
    model: Option<String>,
    thinking_effort: Option<String>,
    capture: Option<CapturedImage>,
}

async fn start_acp_turn(
    name: &'static str,
    client: &mut AcpClient,
    session: &mut AcpSession,
    events: &ProviderEvents,
    session_cwd: &Path,
    ask: AcpAsk,
) -> Result<Option<TurnState>, ()> {
    if ask.cwd.as_path() != session_cwd {
        events.fail(
            ask.run_id,
            &format!("{name} context changed. Start a new session."),
        );
        return Ok(None);
    }
    if ask.capture.is_some() && !session.image_supported {
        events.fail(
            ask.run_id,
            &format!("{name} ACP runtime does not support image input."),
        );
        return Ok(None);
    }
    let model_changed = ask
        .model
        .as_deref()
        .filter(|value| !value.is_empty())
        .is_some_and(|requested| session.applied_model.as_deref() != Some(requested));
    let effort_changed = ask
        .thinking_effort
        .as_deref()
        .filter(|value| !value.is_empty())
        .is_some_and(|requested| session.applied_effort.as_deref() != Some(requested));
    if model_changed || effort_changed {
        if apply_runtime_options(
            client,
            &session.session_id,
            session.model_cfg.as_deref(),
            &mut session.thought_cfg,
            model_changed.then_some(ask.model.as_deref()).flatten(),
            ask.thinking_effort.as_deref(),
        )
        .await
        .is_err()
        {
            events.fail(
                ask.run_id,
                &format!("{name} could not apply the requested model or thinking effort."),
            );
            return Ok(None);
        }
        if model_changed {
            session.applied_model = ask.model.clone();
        }
        if effort_changed {
            session.applied_effort = session
                .thought_cfg
                .as_ref()
                .and(ask.thinking_effort.clone());
        }
        events.emit(AgentEvent::RuntimeChanged {
            run_id: ask.run_id,
            model: session.applied_model.clone(),
            thinking_effort: session.applied_effort.clone(),
        });
    }
    if !session.session_announced {
        events.emit(AgentEvent::SessionReady {
            run_id: ask.run_id,
            session_id: session.session_id.clone(),
        });
        session.session_announced = true;
    }
    let next_prompt =
        match prompt_params(&session.session_id, &ask.text, ask.capture.as_ref()).await {
            Ok(params) => params,
            Err(reason) => {
                events.fail(ask.run_id, &reason);
                return Ok(None);
            }
        };
    let next_id = match client.send_request("session/prompt", next_prompt).await {
        Ok(id) => id,
        Err(reason) => {
            events.fail(ask.run_id, &reason);
            client.terminate().await;
            return Err(());
        }
    };
    Ok(Some(TurnState::new(
        name,
        ask.run_id,
        next_id,
        ask.display_text,
        session.context_window,
    )))
}

pub(in crate::agent::providers) async fn run(
    spec: &'static AcpSpec,
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
            Some(AcpAsk {
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
    let name = spec.name;
    let mut client = match AcpClient::launch(spec, &cwd) {
        Ok(value) => value,
        Err(reason) => {
            if let Some(ask) = pending_ask {
                events.fail(ask.run_id, &reason);
            }
            return;
        }
    };
    let startup = {
        let startup_fut = async {
            let (init_result, session_result, context_window) = client.open_session(&cwd).await?;
            let admitted = admit_session(&init_result, &session_result)?;
            let model_cfg = model_config_id(&session_result);
            let mut thought_cfg = thinking_config(&session_result).map(|cfg| cfg.config_id);
            apply_runtime_options(
                &mut client,
                &admitted.session_id,
                model_cfg.as_deref(),
                &mut thought_cfg,
                init_model.as_deref(),
                init_effort.as_deref(),
            )
            .await?;
            let applied_effort = thought_cfg.as_ref().and(init_effort.clone());
            Ok::<_, String>(AcpSession {
                session_id: admitted.session_id,
                image_supported: admitted.image_input,
                context_window,
                model_cfg,
                thought_cfg,
                applied_model: init_model.clone(),
                applied_effort,
                session_announced: false,
            })
        };
        tokio::pin!(startup_fut);
        loop {
            tokio::select! {
                result = &mut startup_fut => break Some(result),
                action = controls.recv() => match action {
                    Some(Control::Stop) => {
                        if let Some(ask) = pending_ask.take() {
                            events.stopped(ask.run_id);
                        }
                        break None;
                    }
                    Some(Control::Close { claimed, finished })
                        if !finished.is_closed() && !claimed.swap(true, Ordering::SeqCst) =>
                    {
                        if let Some(ask) = pending_ask.take() {
                            events.stopped(ask.run_id);
                        }
                        let _ = finished.send(());
                        break None;
                    }
                    Some(Control::Ask {
                        text,
                        display_text,
                        cwd,
                        run_id,
                        model,
                        thinking_effort,
                        capture,
                    }) if pending_ask.is_none() => {
                        pending_ask = Some(AcpAsk {
                            text,
                            display_text,
                            cwd,
                            run_id,
                            model,
                            thinking_effort,
                            capture,
                        });
                    }
                    None => break None,
                    _ => {}
                }
            }
        }
    };
    let Some(startup) = startup else {
        client.terminate().await;
        return;
    };
    let mut session = match startup {
        Ok(value) => value,
        Err(reason) => {
            if let Some(ask) = pending_ask {
                events.fail(ask.run_id, &reason);
            }
            client.terminate().await;
            return;
        }
    };
    let mut active_turn = if let Some(ask) = pending_ask.take() {
        match start_acp_turn(name, &mut client, &mut session, &events, &cwd, ask).await {
            Ok(turn) => turn,
            Err(()) => return,
        }
    } else {
        None
    };

    loop {
        let standby = if session.session_announced {
            IDLE_STANDBY_TIMEOUT
        } else {
            WARM_STANDBY_TIMEOUT
        };
        let idle_deadline = tokio::time::sleep(standby);
        tokio::pin!(idle_deadline);
        tokio::select! {
            _ = &mut idle_deadline, if active_turn.is_none() => {
                client.terminate().await;
                break;
            }
            action = controls.recv() => match action {
                Some(Control::Stop) if active_turn.is_some() => {
                    if let Some(turn) = active_turn.take() {
                        let _ = client
                            .send_notification("session/cancel", json!({ "sessionId": session.session_id }))
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
                Some(Control::Ask { text, display_text, cwd: next_cwd, run_id, model, thinking_effort, capture }) if active_turn.is_none() => {
                    match start_acp_turn(
                        name,
                        &mut client,
                        &mut session,
                        &events,
                        &cwd,
                        AcpAsk {
                            text,
                            display_text,
                            cwd: next_cwd,
                            run_id,
                            model,
                            thinking_effort,
                            capture,
                        },
                    )
                    .await
                    {
                        Ok(turn) => active_turn = turn,
                        Err(()) => break,
                    }
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
                                        session_id: &session.session_id,
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
