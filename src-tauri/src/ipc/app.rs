use crate::agent::AgentRuntime;
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn app_quit(app: AppHandle, runtime: State<'_, AgentRuntime>) -> Result<(), String> {
    runtime.shutdown().await;
    app.exit(0);
    Ok(())
}
