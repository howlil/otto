use super::rpc::Rpc;
use crate::agent::events::ProviderEvents;
use crate::agent::permission::{
    PERMISSION_TIMEOUT, codex_permission_reply, codex_permission_request,
    unsupported_host_request_reply,
};
use crate::agent::{Control, PermissionDecision};
use serde_json::{Value, json};
use std::{sync::atomic::Ordering, time::Duration};
use tokio::{sync::mpsc, time::timeout};

pub(super) enum IncomingOutcome {
    Continue,
    Terminate,
}

pub(super) async fn handle_incoming_request(
    rpc: &mut Rpc,
    controls: &mut mpsc::Receiver<Control>,
    updates: &ProviderEvents,
    thread: &str,
    run_id: u64,
    turn_id: &str,
    msg: &Value,
) -> IncomingOutcome {
    let Some(prompt) = codex_permission_request(run_id, msg) else {
        let _ = rpc.send(unsupported_host_request_reply(&msg["id"])).await;
        return IncomingOutcome::Continue;
    };
    let expected_id = prompt.request_id.clone();
    updates.permission_requested(run_id, prompt);
    let decision = timeout(PERMISSION_TIMEOUT, async {
        loop {
            match controls.recv().await {
                Some(Control::PermissionDecision {
                    request_id,
                    decision,
                }) if request_id == expected_id => {
                    return Ok(decision);
                }
                Some(Control::PermissionDecision { .. } | Control::Warm { .. }) => continue,
                Some(Control::Stop) => return Err(None),
                Some(Control::Close { claimed, finished }) => {
                    if finished.is_closed() || claimed.swap(true, Ordering::SeqCst) {
                        continue;
                    }
                    return Err(Some(finished));
                }
                None => return Err(None),
                Some(Control::Ask { .. }) => continue,
            }
        }
    })
    .await;
    updates.permission_cleared(run_id, Some(expected_id));
    match decision {
        Ok(Ok(choice)) => {
            if rpc
                .send(codex_permission_reply(&msg["id"], choice))
                .await
                .is_err()
            {
                updates.fail(run_id, "Codex disconnected while awaiting permission.");
                rpc.terminate().await;
                return IncomingOutcome::Terminate;
            }
            IncomingOutcome::Continue
        }
        Err(_) => {
            let _ = rpc
                .send(codex_permission_reply(
                    &msg["id"],
                    PermissionDecision::Decline,
                ))
                .await;
            IncomingOutcome::Continue
        }
        Ok(Err(finished)) => {
            let _ = rpc
                .send(codex_permission_reply(
                    &msg["id"],
                    PermissionDecision::Decline,
                ))
                .await;
            let _ = timeout(
                Duration::from_secs(3),
                rpc.request(
                    "turn/interrupt",
                    json!({ "threadId": thread, "turnId": turn_id }),
                ),
            )
            .await;
            updates.stopped(run_id);
            rpc.terminate().await;
            if let Some(ack) = finished {
                let _ = ack.send(());
            }
            IncomingOutcome::Terminate
        }
    }
}
