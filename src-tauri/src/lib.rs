mod agent;
mod commands;
#[cfg(windows)]
mod windows;

use tauri::{Manager, PhysicalPosition};

pub fn run() {
    tauri::Builder::default()
        .manage(commands::NotchMotion::default())
        .invoke_handler(tauri::generate_handler![
            commands::agent_snapshot,
            commands::agent_codex_installed,
            commands::agent_codex_readiness,
            commands::agent_provider_readiness,
            commands::agent_subscribe,
            commands::agent_unsubscribe,
            commands::agent_ask,
            commands::agent_decide_approval,
            commands::agent_stop,
            commands::agent_new_session,
            commands::agent_configure_capture_shortcut,
            commands::agent_configure_capture_source,
            commands::agent_capture_target_title,
            commands::notch_set_surface,
        ])
        .setup(|app| {
            let agent = match app.path().app_local_data_dir() {
                Ok(path) => agent::AgentRuntime::persistent(path.join("agent-active.marker")),
                Err(_) => agent::AgentRuntime::new(),
            };
            agent.start_recovery_observer();
            app.manage(agent);
            #[cfg(windows)]
            app.manage(windows::capture::start_hotkey(app.handle().clone()));
            if let Some(window) = app.get_webview_window("main")
                && let Some(monitor) = window.current_monitor()?
            {
                let size = window.outer_size()?;
                let bounds = monitor.size();
                let origin = monitor.position();
                window.set_position(PhysicalPosition::new(
                    origin.x + (bounds.width.saturating_sub(size.width) / 2) as i32,
                    origin.y + 20,
                ))?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to start Otto");
}
