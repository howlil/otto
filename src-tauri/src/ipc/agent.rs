use crate::agent::{AcceptedRun, AgentRuntime, Snapshot};
use tauri::{Manager, State, ipc::Channel};

#[tauri::command]
pub fn agent_snapshot(runtime: State<'_, AgentRuntime>) -> Snapshot {
    runtime.snapshot()
}
#[tauri::command]
pub fn agent_history_list(
    runtime: State<'_, AgentRuntime>,
) -> Result<Vec<crate::agent::history::ConversationSummary>, String> {
    runtime.history_list()
}
#[tauri::command]
pub async fn agent_history_open(
    runtime: State<'_, AgentRuntime>,
    conversation_id: String,
) -> Result<Snapshot, String> {
    runtime.history_open(&conversation_id).await
}
#[tauri::command]
pub fn agent_history_rename(
    runtime: State<'_, AgentRuntime>,
    conversation_id: String,
    title: String,
) -> Result<(), String> {
    runtime.history_rename(&conversation_id, &title)
}
#[tauri::command]
pub async fn agent_history_delete(
    runtime: State<'_, AgentRuntime>,
    conversation_id: String,
) -> Result<(), String> {
    runtime.history_delete(&conversation_id).await
}
#[tauri::command]
pub async fn agent_history_delete_all(runtime: State<'_, AgentRuntime>) -> Result<(), String> {
    runtime.history_delete_all().await
}
#[tauri::command]
pub fn agent_codex_installed(runtime: State<'_, AgentRuntime>) -> bool {
    runtime.provider_installed("codex")
}
#[tauri::command]
pub async fn agent_codex_readiness(
    runtime: State<'_, AgentRuntime>,
) -> Result<crate::agent::ProviderReadiness, String> {
    Ok(runtime.provider_readiness("codex", None).await)
}
#[tauri::command]
pub async fn agent_provider_readiness(
    runtime: State<'_, AgentRuntime>,
    provider: String,
    model: Option<String>,
    request_id: u64,
) -> Result<crate::agent::ProviderReadiness, String> {
    runtime
        .probe_provider_readiness(request_id, &provider, None, model.as_deref())
        .await
}

#[tauri::command]
pub fn agent_cancel_provider_readiness(runtime: State<'_, AgentRuntime>, request_id: u64) {
    runtime.cancel_provider_readiness(request_id);
}

#[tauri::command]
pub async fn agent_select_runtime_options(
    runtime: State<'_, AgentRuntime>,
    model: Option<String>,
    thinking_effort: Option<String>,
) -> Result<(), String> {
    runtime.select_runtime_options(model, thinking_effort).await
}

#[tauri::command]
pub async fn agent_select_provider(
    runtime: State<'_, AgentRuntime>,
    provider: String,
) -> Result<(), String> {
    runtime.select_provider(provider).await
}

#[tauri::command]
pub fn agent_subscribe(runtime: State<'_, AgentRuntime>, on_event: Channel<Snapshot>) -> u64 {
    runtime.subscribe(on_event)
}
#[tauri::command]
pub fn agent_unsubscribe(runtime: State<'_, AgentRuntime>, subscription_id: u64) {
    runtime.unsubscribe(subscription_id);
}
#[tauri::command]
pub async fn agent_ask(
    runtime: State<'_, AgentRuntime>,
    text: String,
    provider: String,
    model: Option<String>,
    thinking_effort: Option<String>,
) -> Result<AcceptedRun, String> {
    runtime.ask(text, provider, model, thinking_effort).await
}

#[tauri::command]
pub async fn agent_stop(runtime: State<'_, AgentRuntime>) -> Result<(), String> {
    runtime.stop().await
}

#[tauri::command]
pub async fn agent_new_chat(runtime: State<'_, AgentRuntime>) -> Result<(), String> {
    runtime.new_session().await
}

#[tauri::command]
pub fn agent_configure_capture_shortcut(
    app: tauri::AppHandle,
    shortcut: String,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        app.state::<crate::windows::capture::CaptureHotkeys>()
            .configure(&shortcut)?;
        app.state::<AgentRuntime>().clear_capture_error();
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = (app, shortcut);
        Err("Screen capture shortcuts require Windows.".into())
    }
}

#[tauri::command]
pub fn agent_configure_capture_source(app: tauri::AppHandle, source: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        app.state::<crate::windows::capture::CaptureHotkeys>()
            .configure_source(&source)?;
        app.state::<AgentRuntime>().clear_capture_error();
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = (app, source);
        Err("Screen capture requires Windows.".into())
    }
}

#[tauri::command]
pub async fn agent_capture_now(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(move || {
            app.state::<crate::windows::capture::CaptureHotkeys>()
                .trigger()
        })
        .await
        .map_err(|_| "Capture request could not be dispatched.".to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        Err("Screen capture requires Windows.".into())
    }
}

#[tauri::command]
pub fn agent_capture_target_title() -> Result<String, String> {
    #[cfg(windows)]
    {
        crate::windows::capture::capture_target_title()
    }
    #[cfg(not(windows))]
    {
        Err("Window target lookup requires Windows.".into())
    }
}
