mod agent;
mod ipc;
mod platform;
mod shell;

use std::time::Duration;
use tauri::Manager;

fn build_async_runtime() -> std::io::Result<tokio::runtime::Runtime> {
    tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .max_blocking_threads(6)
        .thread_keep_alive(Duration::from_secs(10))
        .enable_all()
        .build()
}

pub fn run() {
    #[cfg(windows)]
    let _instance_guard = match platform::windows::single_instance::acquire() {
        Ok(Some(guard)) => guard,
        Ok(None) => return,
        Err(error) => {
            eprintln!("Unable to initialize Otto single-instance guard: {error}");
            std::process::exit(1);
        }
    };

    let _async_runtime = match build_async_runtime() {
        Ok(runtime) => {
            tauri::async_runtime::set(runtime.handle().clone());
            Some(runtime)
        }
        Err(error) => {
            eprintln!("Unable to initialize bounded Otto async runtime: {error}");
            None
        }
    };

    tauri::Builder::default()
        .manage(ipc::notch::NotchHostState::default())
        .manage(ipc::agent::AgentSubscriptions::default())
        .invoke_handler(tauri::generate_handler![
            ipc::app::app_quit,
            ipc::shell_shortcut::shell_shortcut,
            ipc::overlay::overlay_protection_status,
            ipc::overlay::overlay_set_capture_protection,
            ipc::overlay::overlay_set_memory_mode,
            ipc::agent::agent_snapshot,
            ipc::agent::agent_history_list,
            ipc::agent::agent_history_export_markdown,
            ipc::agent::agent_history_open,
            ipc::agent::agent_history_rename,
            ipc::agent::agent_history_delete,
            ipc::agent::agent_history_delete_all,
            ipc::agent::agent_provider_catalog,
            ipc::agent::agent_refresh_provider_catalog,
            ipc::agent::agent_provider_readiness,
            ipc::agent::agent_cancel_provider_readiness,
            ipc::agent::agent_runtime_prefs,
            ipc::agent::agent_toggle_pinned_model,
            ipc::agent::agent_select_provider,
            ipc::agent::agent_warm_provider,
            ipc::agent::agent_select_runtime_options,
            ipc::agent::agent_subscribe,
            ipc::agent::agent_unsubscribe,
            ipc::agent::agent_ask,
            ipc::agent::agent_retry_last,
            ipc::agent::agent_edit_and_rerun,
            ipc::agent::agent_queue_followup,
            ipc::agent::agent_clear_queued_followup,
            ipc::agent::agent_respond_permission,
            ipc::agent::agent_set_guidance,
            ipc::agent::agent_stop,
            ipc::agent::agent_new_chat,
            ipc::agent_capture::agent_configure_capture_shortcut,
            ipc::agent_capture::agent_configure_text_capture_shortcut,
            ipc::agent_capture::agent_configure_capture_source,
            ipc::agent_capture::agent_configure_capture_auto_send,
            ipc::agent_capture::agent_stage_image,
            ipc::agent_capture::agent_clear_staged_capture,
            ipc::agent_capture::agent_capture_target_title,
            ipc::agent_capture::agent_capture_now,
            ipc::agent_capture::agent_insert_text,
            ipc::notch::notch_configure_host,
            ipc::notch::notch_set_region,
            ipc::notch_window::notch_finish_drag,
            ipc::otto_os::otto_os_active,
        ])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.manage(platform::macos::display::DisplayWatch::start(
                app.handle().clone(),
            )?);
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
            ipc::agent::start_recovery_observer(&agent);
            app.manage(agent);
            #[cfg(windows)]
            {
                let handle = app.handle().clone();
                let hwnd = app
                    .get_webview_window("main")
                    .and_then(|window| window.hwnd().ok())
                    .map(|hwnd| hwnd.0 as isize);
                let follower = handle.clone();
                app.manage(platform::windows::otto_os::start(
                    handle,
                    hwnd,
                    move |presence| {
                        hwnd.is_some_and(|hwnd| {
                            ipc::notch_follow::follow(&follower, hwnd, presence)
                        })
                    },
                ));
            }
            #[cfg(windows)]
            app.manage(platform::windows::capture::start_hotkey(
                app.handle().clone(),
            ));
            #[cfg(windows)]
            {
                app.manage(platform::windows::shell_shortcut::start(
                    app.handle().clone(),
                )?);
            }
            if let Some(window) = app.get_webview_window("main") {
                #[cfg(windows)]
                {
                    if let Err(error) = platform::windows::overlay::configure(&window) {
                        eprintln!("Otto capture protection unavailable: {error}");
                    }
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to start Otto")
        .run(|_app, _event| {
            #[cfg(target_os = "macos")]
            if matches!(_event, tauri::RunEvent::Exit) {
                _app.unmanage::<platform::macos::display::DisplayWatch>();
            }
        });
}
