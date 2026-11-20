use super::{
    readiness::{executable, valid_claude_effort, valid_claude_model_id},
    stream::{MAX_FRAME_BYTES, TURN_IDLE_TIMEOUT, TurnStream, failure_message, valid_session_id},
};
use crate::agent::events::{AgentEvent, ProviderEvents};
use crate::agent::providers::{
    BoundedLineError, encode_png_capture, read_bounded_line, transport::JsonlProcess,
};
use crate::agent::{CapturedImage, Control};
use serde_json::{Value, json};
use std::{path::Path, sync::atomic::Ordering, time::Duration};
use tokio::{sync::mpsc, time::timeout};

fn launch_args(
    session: Option<&str>,
    model: Option<&str>,
    thinking_effort: Option<&str>,
    has_image: bool,
) -> Vec<String> {
    let mut args = vec![
        "-p".into(),
        "--input-format".into(),
        if has_image { "stream-json" } else { "text" }.into(),
        "--output-format".into(),
        "stream-json".into(),
        "--verbose".into(),
        "--include-partial-messages".into(),
    ];
    if let Some(session) = session {
        args.extend(["--resume".into(), session.into()]);
    }
    if let Some(model) = model {
        args.extend(["--model".into(), model.into()]);
    }
    if let Some(effort) = thinking_effort {
        args.extend(["--effort".into(), effort.into()]);
    }
    args
}

fn multimodal_user_frame(text: &str, base64_png: &str) -> Value {
    json!({
        "type": "user",
        "message": {
            "role": "user",
            "content": [
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": "image/png",
                        "data": base64_png
                    }
                },
                {
                    "type": "text",
                    "text": text
                }
            ]
        }
    })
}

async fn prepare_input_payload(
    text: &str,
    capture: Option<&CapturedImage>,
) -> Result<Vec<u8>, String> {
    let Some(image) = capture else {
        return Ok(text.as_bytes().to_vec());
    };
    let path = image.path().to_owned();
    let encoded = tokio::task::spawn_blocking(move || encode_png_capture(&path))
        .await
        .map_err(|_| "Image preparation was interrupted.".to_string())??;
    serde_json::to_vec(&multimodal_user_frame(text, &encoded))
        .map_err(|_| "Could not encode the Claude Code image request.".to_string())
}

enum TurnOutcome {
    Completed(Option<String>),
    Failed(Option<String>),
    Stopped(Option<String>),
    Closed,
}

fn bounded_line_error(error: BoundedLineError) -> &'static str {
    match error {
        BoundedLineError::TooLarge => "Claude Code response exceeded the frame limit.",
        BoundedLineError::InvalidUtf8 => "Claude Code returned invalid text.",
        BoundedLineError::Read => "Claude Code output failed.",
    }
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

async fn run_turn(
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
    let Some(binary) = executable() else {
        events.fail(run_id, "Claude Code was not found in PATH.");
        return TurnOutcome::Failed(session.map(str::to_owned));
    };
    let args = launch_args(
        session.filter(|id| valid_session_id(id)),
        selected_model.as_deref(),
        selected_effort.as_deref(),
        capture.is_some(),
    );
    let (mut process, _) = match JsonlProcess::launch(
        "Claude Code",
        &binary,
        args,
        cwd,
        false,
        "Claude Code could not start.",
    ) {
        Ok(process) => process,
        Err(reason) => {
            events.fail(run_id, &reason);
            return TurnOutcome::Failed(session.map(str::to_owned));
        }
    };
    if let Err(reason) = process
        .send_line(payload, "Claude Code input disconnected.")
        .await
    {
        process.terminate_tree().await;
        events.fail(run_id, &reason);
        return TurnOutcome::Failed(session.map(str::to_owned));
    }
    process.close_input();
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
        tokio::select! {
            control = controls.recv() => match control {
                Some(Control::Stop) => {
                    process.terminate_tree().await;
                    events.stopped(run_id);
                    return TurnOutcome::Stopped(stream.session_id);
                }
                Some(Control::Close { claimed, finished }) => {
                    if finished.is_closed() || claimed.swap(true, Ordering::SeqCst) {
                        continue;
                    }
                    process.terminate_tree().await;
                    let _ = finished.send(());
                    return TurnOutcome::Closed;
                }
                Some(Control::Ask { run_id: next_run_id, .. }) => {
                    process.terminate_tree().await;
                    events.fail(next_run_id, "Claude Code was still processing the previous request. Retry this prompt.");
                    return TurnOutcome::Failed(stream.session_id);
                }
                Some(Control::PermissionDecision { .. }) => {}
                None => {
                    process.terminate_tree().await;
                    return TurnOutcome::Closed;
                }
            },
            line = timeout(TURN_IDLE_TIMEOUT, read_bounded_line(process.reader(), MAX_FRAME_BYTES)) => match line {
                Err(_) => {
                    process.terminate_tree().await;
                    events.fail(run_id, "Claude Code stopped responding. Check connectivity, then retry.");
                    return TurnOutcome::Failed(stream.session_id);
                }
                Ok(Err(error)) => {
                    process.terminate_tree().await;
                    events.fail(run_id, bounded_line_error(error));
                    return TurnOutcome::Failed(stream.session_id);
                }
                Ok(Ok(Some(line))) => {
                    let frame = match serde_json::from_str::<Value>(&line) {
                        Ok(frame) => frame,
                        Err(_) => {
                            process.terminate_tree().await;
                            events.fail(run_id, "Claude Code returned an invalid stream event.");
                            return TurnOutcome::Failed(stream.session_id);
                        }
                    };
                    if let Err(reason) = stream.observe(&frame, run_id, events) {
                        process.terminate_tree().await;
                        events.fail(run_id, &reason);
                        return TurnOutcome::Failed(stream.session_id);
                    }
                }
                Ok(Ok(None)) => {
                    match timeout(Duration::from_secs(5), process.wait_success()).await {
                        Ok(Ok(())) => {}
                        Ok(Err(_)) => {
                            let error = stream.failure.as_deref().map(failure_message)
                                .unwrap_or("Claude Code could not complete the request. Check its native configuration, then retry.");
                            events.fail(run_id, error);
                            return TurnOutcome::Failed(stream.session_id);
                        }
                        Err(_) => {
                            process.terminate_tree().await;
                            events.fail(run_id, "Claude Code did not exit after finishing its response.");
                            return TurnOutcome::Failed(stream.session_id);
                        }
                    }
                    let session_id = stream.session_id.clone();
                    match stream.finish(run_id, events) {
                        Ok(session_id) => return TurnOutcome::Completed(session_id),
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
    let mut next = Some(initial);
    let mut session: Option<String> = None;
    while let Some(Control::Ask {
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
            TurnOutcome::Completed(next_session) | TurnOutcome::Failed(next_session) => {
                if next_session.is_some() {
                    session = next_session;
                }
            }
            TurnOutcome::Stopped(next_session) => {
                if next_session.is_some() {
                    session = next_session;
                }
            }
            TurnOutcome::Closed => return,
        }
        loop {
            match controls.recv().await {
                Some(next_control @ Control::Ask { .. }) => {
                    next = Some(next_control);
                    break;
                }
                Some(Control::Close { claimed, finished }) => {
                    if finished.is_closed() || claimed.swap(true, Ordering::SeqCst) {
                        continue;
                    }
                    let _ = finished.send(());
                    return;
                }
                Some(Control::Stop) => events.stopped(events.snapshot().run_id),
                Some(Control::PermissionDecision { .. }) => {}
                None => return,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_launch_args_forward_model_and_effort_without_tool_or_permission_overrides() {
        let args = launch_args(
            Some("sess-1"),
            Some("claude-sonnet-5-5"),
            Some("high"),
            false,
        );
        assert_eq!(
            args,
            vec![
                "-p",
                "--input-format",
                "text",
                "--output-format",
                "stream-json",
                "--verbose",
                "--include-partial-messages",
                "--resume",
                "sess-1",
                "--model",
                "claude-sonnet-5-5",
                "--effort",
                "high",
            ]
        );
        for forbidden in [
            "--tools",
            "--allowedTools",
            "--disallowedTools",
            "--permission-mode",
            "--dangerously-skip-permissions",
            "--bare",
        ] {
            assert!(!args.iter().any(|arg| arg == forbidden));
        }
    }

    #[test]
    fn claude_multimodal_launch_args_and_payload_use_stream_json_without_permission_overrides() {
        let args = launch_args(Some("sess-2"), Some("claude-opus-5-5"), Some("max"), true);
        assert_eq!(args[0], "-p");
        assert_eq!(args[1], "--input-format");
        assert_eq!(args[2], "stream-json");
        assert!(args.contains(&"--resume".to_string()));
        assert!(args.contains(&"sess-2".to_string()));
        for forbidden in [
            "--tools",
            "--allowedTools",
            "--disallowedTools",
            "--permission-mode",
            "--dangerously-skip-permissions",
        ] {
            assert!(!args.iter().any(|arg| arg == forbidden));
        }
        let frame = multimodal_user_frame("Solve problem 3", "iVBORw0KGgo=");
        assert_eq!(frame["type"], "user");
        assert_eq!(frame["message"]["role"], "user");
        assert_eq!(frame["message"]["content"][0]["type"], "image");
        assert_eq!(frame["message"]["content"][0]["source"]["type"], "base64");
        assert_eq!(
            frame["message"]["content"][0]["source"]["media_type"],
            "image/png"
        );
        assert_eq!(
            frame["message"]["content"][0]["source"]["data"],
            "iVBORw0KGgo="
        );
        assert_eq!(frame["message"]["content"][1]["type"], "text");
        assert_eq!(frame["message"]["content"][1]["text"], "Solve problem 3");
    }
}
