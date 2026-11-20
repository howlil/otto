use super::client::AcpClient;
use crate::agent::events::ProviderEvents;
use crate::agent::permission::{
    PERMISSION_TIMEOUT, acp_permission_reply, acp_permission_request,
    unsupported_host_request_reply,
};
use crate::agent::{Control, PermissionDecision};
use serde_json::{Value, json};
use std::sync::atomic::Ordering;
use tokio::{sync::mpsc, time::timeout};

pub(super) enum AcpIncomingOutcome {
    Continue,
    Terminate,
}

pub(super) struct AcpRequestContext<'a> {
    pub(super) name: &'static str,
    pub(super) session_id: &'a str,
    pub(super) run_id: u64,
}

pub(super) async fn handle_incoming_request(
    client: &mut AcpClient,
    controls: &mut mpsc::Receiver<Control>,
    events: &ProviderEvents,
    context: AcpRequestContext<'_>,
    frame: &Value,
) -> AcpIncomingOutcome {
    let AcpRequestContext {
        name,
        session_id,
        run_id,
    } = context;
    let Some(prompt) = acp_permission_request(name, run_id, frame) else {
        let _ = client
            .send_raw(&unsupported_host_request_reply(&frame["id"]))
            .await;
        return AcpIncomingOutcome::Continue;
    };
    let expected_id = prompt.snapshot.request_id.clone();
    events.permission_requested(run_id, prompt.snapshot);
    let decision = timeout(PERMISSION_TIMEOUT, async {
        loop {
            match controls.recv().await {
                Some(Control::PermissionDecision {
                    request_id,
                    decision,
                }) if request_id == expected_id => return Ok(decision),
                Some(Control::PermissionDecision { .. }) => continue,
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
    events.permission_cleared(run_id, Some(expected_id));
    match decision {
        Ok(Ok(choice)) => {
            let reply = acp_permission_reply(
                &frame["id"],
                choice,
                prompt.allow_option_id.as_deref(),
                prompt.reject_option_id.as_deref(),
            );
            if client.send_raw(&reply).await.is_err() {
                events.fail(
                    run_id,
                    &format!("{name} disconnected while awaiting permission."),
                );
                client.terminate().await;
                return AcpIncomingOutcome::Terminate;
            }
            AcpIncomingOutcome::Continue
        }
        Err(_) => {
            let reply = acp_permission_reply(
                &frame["id"],
                PermissionDecision::Decline,
                prompt.allow_option_id.as_deref(),
                prompt.reject_option_id.as_deref(),
            );
            let _ = client.send_raw(&reply).await;
            AcpIncomingOutcome::Continue
        }
        Ok(Err(finished)) => {
            let reply = acp_permission_reply(&frame["id"], PermissionDecision::Decline, None, None);
            let _ = client.send_raw(&reply).await;
            let _ = client
                .send_notification("session/cancel", json!({ "sessionId": session_id }))
                .await;
            events.stopped(run_id);
            client.terminate().await;
            if let Some(ack) = finished {
                let _ = ack.send(());
            }
            AcpIncomingOutcome::Terminate
        }
    }
}
