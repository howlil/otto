mod agent;
mod ipc;
mod media;
mod notch;
mod os_events;
#[cfg(windows)]
mod windows;

use tauri::{Manager, PhysicalPosition};

pub fn run() {
    #[cfg(windows)]
    let _instance_guard = match windows::single_instance::acquire() {
        Ok(Some(guard)) => guard,
        Ok(None) => return,
        Err(error) => {
            eprintln!("Unable to initialize Otto single-instance guard: {error}");
            std::process::exit(1);
        }
    };

    tauri::Builder::default()
        .manage(ipc::notch::NotchPlacementState::default())
        .invoke_handler(tauri::generate_handler![
            ipc::overlay::overlay_protection_status,
            ipc::overlay::overlay_set_capture_protection,
            ipc::agent::agent_snapshot,
            ipc::agent::agent_history_list,
            ipc::agent::agent_history_open,
            ipc::agent::agent_history_rename,
            ipc::agent::agent_history_delete,
            ipc::agent::agent_history_delete_all,
            ipc::agent::agent_codex_installed,
            ipc::agent::agent_codex_readiness,
            ipc::agent::agent_provider_readiness,
            ipc::agent::agent_cancel_provider_readiness,
            ipc::agent::agent_select_provider,
            ipc::agent::agent_select_runtime_options,
            ipc::agent::agent_subscribe,
            ipc::agent::agent_unsubscribe,
            ipc::agent::agent_ask,
            ipc::agent::agent_stop,
            ipc::agent::agent_new_chat,
            ipc::agent::agent_configure_capture_shortcut,
            ipc::agent::agent_configure_capture_source,
            ipc::agent::agent_capture_target_title,
            ipc::agent::agent_capture_now,
            ipc::notch::notch_measure_surface,
            ipc::notch::notch_set_surface,
            ipc::notch::notch_set_hit_region,
            ipc::media::media_snapshot,
            ipc::media::media_subscribe,
            ipc::media::media_unsubscribe,
            ipc::media::media_refresh,
            ipc::media::media_control,
            ipc::os_events::os_events_subscribe,
            ipc::os_events::os_events_unsubscribe,
            ipc::os_events::os_events_set_enabled,
        ])
        .setup(|app| {
            #[cfg(windows)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
            let agent = match app.path().app_local_data_dir() {
                Ok(path) => agent::AgentRuntime::persistent_with_history(
                    path.join("agent-active.marker"),
                    path.join("conversations.json"),
                ),
                Err(_) => agent::AgentRuntime::new(),
            };
            agent.start_recovery_observer();
            app.manage(agent);
            let media = std::sync::Arc::new(media::MediaRuntime::new());
            app.manage(media.clone());
            #[cfg(windows)]
            app.manage(windows::media::MediaController::start(media));
            #[cfg(not(windows))]
            let _ = media;
            let os_events = std::sync::Arc::new(os_events::OsEventRuntime::new());
            app.manage(os_events.clone());
            #[cfg(windows)]
            app.manage(windows::observers::start_all(os_events));
            #[cfg(not(windows))]
            let _ = os_events;
            #[cfg(windows)]
            app.manage(windows::capture::start_hotkey(app.handle().clone()));
            if let Some(window) = app.get_webview_window("main") {
                #[cfg(windows)]
                {
                    if let Err(error) = windows::overlay::configure(&window) {
                        eprintln!("Otto capture protection unavailable: {error}");
                    }
                }
                if let Some(monitor) = window.current_monitor()? {
                    let size = window.outer_size()?;
                    let bounds = monitor.size();
                    let origin = monitor.position();
                    window.set_position(PhysicalPosition::new(
                        origin.x + (bounds.width.saturating_sub(size.width) / 2) as i32,
                        origin.y + 20,
                    ))?;
                }
                window.show()?;
                #[cfg(windows)]
                {
                    if let Err(error) = windows::overlay::configure(&window) {
                        eprintln!("Otto capture protection unavailable: {error}");
                    }
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to start Otto");
}
