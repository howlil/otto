mod agent;
mod focus;
mod ipc;
mod lyrics;
mod media;
mod notch;
mod os_events;
#[cfg(windows)]
mod windows;

use tauri::Manager;

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
        .manage(ipc::notch::NotchHostState::default())
        .manage(lyrics::LyricsRuntime::new())
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
            ipc::notch::notch_configure_host,
            ipc::notch::notch_set_region,
            ipc::media::media_snapshot,
            ipc::media::media_set_online_lyrics,
            ipc::media::media_lyrics,
            ipc::media::media_subscribe,
            ipc::media::media_unsubscribe,
            ipc::media::media_refresh,
            ipc::media::media_control,
            ipc::focus::focus_timer_snapshot,
            ipc::focus::focus_timer_subscribe,
            ipc::focus::focus_timer_unsubscribe,
            ipc::focus::focus_timer_start,
            ipc::focus::focus_timer_pause,
            ipc::focus::focus_timer_reset,
            ipc::focus::focus_timer_configure,
            ipc::focus::focus_timer_select_phase,
            ipc::focus::focus_timer_start_next,
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
            let focus_timer = std::sync::Arc::new(focus::FocusTimerRuntime::new());
            focus_timer.start_worker();
            app.manage(focus_timer);
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
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to start Otto");
}
