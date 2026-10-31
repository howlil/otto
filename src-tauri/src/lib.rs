mod agent;
mod commands;

use tauri::{Manager, PhysicalPosition};

pub fn run() {
    tauri::Builder::default()
        .manage(agent::AgentRuntime::new())
        .invoke_handler(tauri::generate_handler![
            commands::agent_snapshot,
            commands::agent_codex_installed,
            commands::agent_subscribe,
            commands::agent_ask,
            commands::agent_stop,
            commands::notch_set_surface,
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main")
                && let Some(monitor) = window.current_monitor()?
            {
                let size = window.outer_size()?;
                let bounds = monitor.size();
                let origin = monitor.position();
                window.set_position(PhysicalPosition::new(
                    origin.x + (bounds.width.saturating_sub(size.width) / 2) as i32,
                    origin.y + 12,
                ))?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to start Otto");
}
