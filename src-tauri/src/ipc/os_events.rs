use crate::os_events::{OsEventRuntime, OsEventView};
use std::sync::Arc;
use tauri::{State, ipc::Channel};

#[tauri::command]
pub fn os_events_subscribe(
    runtime: State<'_, Arc<OsEventRuntime>>,
    on_event: Channel<OsEventView>,
) -> u64 {
    runtime.subscribe(on_event)
}

#[tauri::command]
pub fn os_events_unsubscribe(runtime: State<'_, Arc<OsEventRuntime>>, subscription_id: u64) {
    runtime.unsubscribe(subscription_id);
}

#[tauri::command]
pub fn os_events_set_enabled(runtime: State<'_, Arc<OsEventRuntime>>, enabled: bool) {
    runtime.set_enabled(enabled);
}
