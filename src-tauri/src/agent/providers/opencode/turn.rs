use super::{
    readiness::{MAX_OUTPUT, executable, model_id, valid_variant},
    stream::Turn,
};
use crate::agent::providers::{read_bounded_line, transport::JsonlProcess};
use crate::agent::{
    CapturedImage, Control,
    events::{AgentEvent, ProviderEvents},
};
use serde_json::Value;
use std::{ffi::OsString, path::Path, sync::atomic::Ordering, time::Duration};
use tokio::{sync::mpsc, time::timeout};

fn valid_session_id(value: &str) -> bool {
    !value.is_empty()
        && !value.starts_with('-')
        && value.len() <= 256
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_".contains(&byte))
}

fn build_launch_args(
    session: Option<&str>,
    model: Option<&str>,
    variant: Option<&str>,
    image: Option<&Path>,
) -> Vec<OsString> {
    let mut args: Vec<OsString> = vec!["run".into(), "--format".into(), "json".into()];
    if let Some(id) = session.filter(|value| valid_session_id(value)) {
        args.push("--session".into());
        args.push(id.into());
    }
    if let Some(model) = model {
        args.push("--model".into());
        args.push(model.into());
    }
    if let Some(effort) = variant {
        args.push("--variant".into());
        args.push(effort.into());
    }
    if let Some(path) = image {
        args.push("-f".into());
        args.push(path.as_os_str().to_os_string());
    }
    args
}

async fn recv_cancel(controls: &mut mpsc::Receiver<Control>) -> Option<Control> {
    loop {
        match controls.recv().await {
            Some(Control::PermissionDecision { .. }) => continue,
            other => return other,
        }
    }
}

struct ExecuteRequest<'a> {
    run_id: u64,
    text: &'a str,
    display_text: &'a str,
    cwd: &'a Path,
    session: Option<&'a str>,
    model: Option<&'a str>,
    thinking_effort: Option<&'a str>,
    image: Option<&'a Path>,
}

async fn execute(
    events: &ProviderEvents,
    request: ExecuteRequest<'_>,
    active: &mut Option<JsonlProcess>,
) -> Result<Option<String>, String> {
    let ExecuteRequest {
        run_id,
        text,
        display_text,
        cwd,
        session,
        model,
        thinking_effort,
        image,
    } = request;
    let selected = match model {
        Some(id) => {
            if !model_id(id) {
                return Err(
                    "The selected OpenCode model is unavailable. Choose an available model.".into(),
                );
            }
            Some(id.to_owned())
        }
        None => None,
    };
    let variant = match thinking_effort.filter(|value| !value.is_empty()) {
        Some(effort) => {
            if !valid_variant(effort) {
                return Err("Selected thinking effort is not supported by OpenCode.".into());
            }
            Some(effort.to_owned())
        }
        None => None,
    };
    let binary =
        executable().ok_or("OpenCode is not installed. Install opencode-ai, then Retry.")?;
    let args = build_launch_args(session, selected.as_deref(), variant.as_deref(), image);
    let (process, _) = JsonlProcess::launch(
        "OpenCode",
        &binary,
        args,
        cwd,
        false,
        "OpenCode could not start.",
    )?;
    *active = Some(process);
    let process = active.as_mut().ok_or("OpenCode process is unavailable.")?;
    events.emit(AgentEvent::RuntimeChanged {
        run_id,
        model: selected,
        thinking_effort: variant,
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
    Ok(turn.session)
}

pub async fn run(mut controls: mpsc::Receiver<Control>, events: ProviderEvents, initial: Control) {
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
        let mut active = None;
        let mut close = None;
        let mut channel_closed = false;
        let outcome = tokio::select! {
            biased;
            control = recv_cancel(&mut controls) => {
                match control {
                    Some(Control::Close { claimed, finished })
                        if !finished.is_closed() && !claimed.swap(true, Ordering::SeqCst) =>
                    {
                        close = Some(finished);
                    }
                    None => channel_closed = true,
                    _ => {}
                }
                None
            }
            result = timeout(Duration::from_secs(120), execute(&events, ExecuteRequest {
                run_id,
                text: &text,
                display_text: &display_text,
                cwd: &cwd,
                session: session.as_deref(),
                model: model.as_deref(),
                thinking_effort: thinking_effort.as_deref(),
                image: capture.as_ref().map(CapturedImage::path),
            }, &mut active)) => {
                Some(result.unwrap_or_else(|_| Err("OpenCode answer timed out. Check connectivity or provider usage limits, then Retry.".into())))
            }
        };
        if let Some(process) = active.as_mut() {
            process.kill_now().await;
        }
        drop(active);
        drop(capture);
        match outcome {
            Some(Ok(next_session)) => {
                if next_session.is_some() {
                    session = next_session;
                }
                events.emit(AgentEvent::Completed { run_id });
            }
            Some(Err(reason)) => events.fail(run_id, &reason),
            None => events.stopped(run_id),
        }
        if let Some(finished) = close {
            let _ = finished.send(());
            return;
        }
        if channel_closed {
            return;
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
    use crate::agent::{ActivityKind, AgentRuntime, RunPhase};
    use serde_json::json;
    use tokio::sync::watch;

    #[test]
    fn opencode_launch_args_forward_session_model_variant_and_image_without_permission_overrides() {
        let image = Path::new("C:/temp/capture.png");
        let args = build_launch_args(
            Some("sess-42"),
            Some("openai/gpt-5.6"),
            Some("high"),
            Some(image),
        );
        let text: Vec<String> = args
            .iter()
            .map(|value| value.to_string_lossy().into_owned())
            .collect();
        assert_eq!(
            text,
            vec![
                "run",
                "--format",
                "json",
                "--session",
                "sess-42",
                "--model",
                "openai/gpt-5.6",
                "--variant",
                "high",
                "-f",
                "C:/temp/capture.png",
            ]
        );
        for forbidden in [
            "--permission-mode",
            "--dangerously-skip-permissions",
            "--allow-all",
            "--yolo",
        ] {
            assert!(!text.iter().any(|arg| arg == forbidden));
        }
        let invalid_session = build_launch_args(Some("--bad-flag"), None, None, None);
        assert_eq!(
            invalid_session,
            vec![OsString::from("run"), "--format".into(), "json".into()]
        );
    }

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
            &json!({"type":"step_finish","sessionID":"session-1","part":{"reason":"tool-calls"}}),
            7,
            &events,
        )
        .unwrap();
        assert!(!turn.finished);
        turn.observe(
            &json!({"type":"step_finish","sessionID":"session-1","part":{"reason":"stop"}}),
            7,
            &events,
        )
        .unwrap();
        assert!(turn.finished);
        assert_eq!(updates.borrow().status, RunPhase::Streaming);
        turn.observe(
            &json!({"type":"tool_use","sessionID":"session-1"}),
            7,
            &events,
        )
        .unwrap();
        for frame in [
            json!({"type":"text","sessionID":"session-1","part":{"id":"x".repeat(257),"text":"answer"}}),
            json!({"type":"text","sessionID":"x".repeat(257)}),
            json!({"type":"text","sessionID":"other"}),
            json!({"type":"error","sessionID":"session-1","error":{"data":{"message":"Unauthorized"}}}),
        ] {
            assert!(turn.observe(&frame, 7, &events).is_err());
        }
    }

    #[test]
    fn opencode_text_accumulator_clamps_to_max_assistant_text() {
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
        let big = "a".repeat(140_000);
        let frame =
            json!({"type":"text","sessionID":"session-1","part":{"id":"part-big","text":big}});
        turn.observe(&frame, 7, &events).unwrap();
        let snapshot = updates.borrow();
        let text = &snapshot.messages.last().unwrap().text;
        assert!(!text.is_empty());
        assert!(text.len() <= 128_000);
    }

    #[test]
    fn opencode_step_finish_emits_cumulative_usage_and_context_tokens() {
        let mut snapshot = AgentRuntime::new().snapshot();
        snapshot.run_id = 11;
        snapshot.status = RunPhase::Starting;
        let (updates, _) = watch::channel(snapshot);
        let events = ProviderEvents::new(updates.clone());
        events.emit(AgentEvent::TurnStarted {
            run_id: 11,
            text: "question".into(),
        });
        let mut turn = Turn::default();
        turn.observe(
            &json!({
                "type": "step_finish",
                "sessionID": "session-1",
                "part": {
                    "reason": "tool-calls",
                    "tokens": {
                        "input": 1000,
                        "output": 100,
                        "reasoning": 50,
                        "cache": { "read": 500, "write": 200 }
                    }
                }
            }),
            11,
            &events,
        )
        .unwrap();
        turn.observe(
            &json!({
                "type": "step_finish",
                "sessionID": "session-1",
                "part": {
                    "reason": "stop",
                    "tokens": {
                        "input": 1200,
                        "output": 250,
                        "reasoning": 80,
                        "cache": { "read": 1500, "write": 0 }
                    }
                }
            }),
            11,
            &events,
        )
        .unwrap();
        let usage = updates.borrow().usage.clone().expect("usage emitted");
        assert_eq!(usage.context_tokens, Some(2700));
        assert_eq!(usage.input_tokens, 2200);
        assert_eq!(usage.cached_input_tokens, 2200);
        assert_eq!(usage.output_tokens, 350);
        assert_eq!(usage.reasoning_output_tokens, Some(130));
        assert_eq!(usage.session_tokens, 4750);
    }

    #[test]
    fn opencode_reasoning_and_tool_frames_capture_details() {
        let mut snapshot = crate::agent::AgentRuntime::new().snapshot();
        snapshot.run_id = 2;
        snapshot.status = RunPhase::Starting;
        let (updates, _) = tokio::sync::watch::channel(snapshot);
        let events = ProviderEvents::new(updates.clone());
        let mut turn = Turn::default();
        turn.observe(
            &serde_json::json!({"sessionID":"s","type":"reasoning","part":{"id":"r1","text":"Inspect build\nCheck tests"}}),
            2,
            &events,
        )
        .unwrap();
        turn.observe(&serde_json::json!({"sessionID":"s","type":"tool_use","part":{"id":"p1","tool":"bash","state":{"title":"Run tests","status":"completed","input":{"command":"bun test"}}}}), 2, &events).unwrap();
        let list = updates.borrow().activity.clone();
        assert_eq!(list.len(), 2);
        assert!(list.iter().all(|item| item.done));
        assert_eq!(list[0].summary.as_deref(), Some("Inspect build"));
        assert!(list[0].detail.as_deref().unwrap().contains("Check tests"));
        assert_eq!(list[1].kind, ActivityKind::Command);
        assert_eq!(list[1].summary.as_deref(), Some("Run tests"));
        assert!(
            list[1]
                .detail
                .as_deref()
                .unwrap()
                .contains("command: bun test")
        );
    }
}
