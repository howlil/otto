use super::rpc::Rpc;
use crate::agent::{Control, events::ProviderEvents};
use std::{future::Future, sync::atomic::Ordering};
use tokio::sync::{mpsc, oneshot};

pub(super) enum Controlled<T> {
    Done(T),
    Cancelled(Option<oneshot::Sender<()>>),
}

pub(super) async fn recv_non_permission(controls: &mut mpsc::Receiver<Control>) -> Option<Control> {
    loop {
        match controls.recv().await {
            Some(Control::PermissionDecision { .. } | Control::Warm { .. }) => continue,
            other => return other,
        }
    }
}

pub(super) async fn await_controlled<T, F>(
    controls: &mut mpsc::Receiver<Control>,
    operation: F,
) -> Result<Controlled<T>, String>
where
    F: Future<Output = Result<T, String>>,
{
    tokio::select! {
        biased;
        control = recv_non_permission(controls) => {
            let close_ack = match control {
                Some(Control::Close { claimed, finished })
                    if !finished.is_closed() && !claimed.swap(true, Ordering::SeqCst) =>
                {
                    Some(finished)
                }
                _ => None,
            };
            Ok(Controlled::Cancelled(close_ack))
        }
        result = operation => result.map(Controlled::Done),
    }
}

pub(super) async fn finish_cancelled(
    rpc: &mut Rpc,
    controls: &mut mpsc::Receiver<Control>,
    events: &ProviderEvents,
    run_id: u64,
    close_ack: Option<oneshot::Sender<()>>,
) {
    stop_process(rpc, controls, events, run_id).await;
    if let Some(finished) = close_ack {
        let _ = finished.send(());
    }
}

pub(super) async fn stop_process(
    rpc: &mut Rpc,
    controls: &mut mpsc::Receiver<Control>,
    events: &ProviderEvents,
    run_id: u64,
) {
    controls.close();
    rpc.terminate().await;
    events.stopped(run_id);
}
