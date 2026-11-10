use super::Rpc;
use crate::agent::{Control, events::ProviderEvents};
use std::future::Future;
use tokio::sync::mpsc;

pub(super) async fn await_controlled<T, F>(
    controls: &mut mpsc::Receiver<Control>,
    operation: F,
) -> Result<Option<T>, String>
where
    F: Future<Output = Result<T, String>>,
{
    tokio::select! {
        biased;
        _ = controls.recv() => Ok(None),
        result = operation => result.map(Some),
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
