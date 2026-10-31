use crate::agent::{AgentRuntime, Snapshot};
use tauri::{LogicalSize, PhysicalPosition, State, WebviewWindow, ipc::Channel};

#[tauri::command]
pub fn agent_snapshot(runtime: State<'_, AgentRuntime>) -> Snapshot {
    runtime.snapshot()
}

#[tauri::command]
pub fn agent_codex_installed(runtime: State<'_, AgentRuntime>) -> bool {
    runtime.codex_installed()
}

#[tauri::command]
pub fn agent_subscribe(runtime: State<'_, AgentRuntime>, on_event: Channel<Snapshot>) {
    runtime.subscribe(on_event);
}

#[tauri::command]
pub async fn agent_ask(
    runtime: State<'_, AgentRuntime>,
    text: String,
    cwd: String,
) -> Result<(), String> {
    runtime.ask(text, cwd).await
}

#[tauri::command]
pub async fn agent_stop(runtime: State<'_, AgentRuntime>) -> Result<(), String> {
    runtime.stop().await
}

#[tauri::command]
pub fn notch_set_surface(window: WebviewWindow, surface: String) -> Result<(), String> {
    let (width, height) = match surface.as_str() {
        "idle" => (92_u32, 42_u32),
        "agentCompact" => (228, 50),
        "home" => (452, 148),
        "agent" => (526, 326),
        _ => return Err("Invalid notch surface.".into()),
    };
    window
        .set_size(LogicalSize::new(width as f64, height as f64))
        .map_err(|_| "Cannot resize the notch.")?;
    if let Some(monitor) = window
        .current_monitor()
        .map_err(|_| "Monitor unavailable.")?
    {
        let bounds = monitor.size();
        let origin = monitor.position();
        let scale = window.scale_factor().map_err(|_| "DPI unavailable.")?;
        let physical_width = (width as f64 * scale).round() as i32;
        let x = origin.x + ((bounds.width as i32 - physical_width) / 2);
        window
            .set_position(PhysicalPosition::new(x, origin.y + 12))
            .map_err(|_| "Cannot position the notch.")?;
    }
    Ok(())
}
