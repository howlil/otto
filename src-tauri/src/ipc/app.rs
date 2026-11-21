use crate::agent::AgentRuntime;
use crate::voice::VoiceRuntime;
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn app_quit(
    app: AppHandle,
    runtime: State<'_, AgentRuntime>,
    voice: State<'_, VoiceRuntime>,
) -> Result<(), String> {
    voice.shutdown().await;
    runtime.shutdown().await;
    app.exit(0);
    Ok(())
}
