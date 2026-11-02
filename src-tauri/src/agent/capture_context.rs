use super::{AgentRuntime, CapturedImage};
use tauri::Manager;

pub(crate) fn dispatch<F>(app: &tauri::AppHandle, capture: F) -> Result<(), String>
where
    F: FnOnce() -> Result<CapturedImage, String> + Send + 'static,
{
    let runtime = app.state::<AgentRuntime>();
    let (request_id, reservation) = runtime.begin_capture()?;
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let runtime = handle.state::<AgentRuntime>();
        if let Err(reason) = runtime
            .capture_hotkey(request_id, reservation, capture)
            .await
        {
            runtime.capture_error_for(request_id, &reason);
        }
    });
    Ok(())
}

pub(crate) fn report_error(app: &tauri::AppHandle, reason: &str) {
    app.state::<AgentRuntime>().capture_error(reason);
}
