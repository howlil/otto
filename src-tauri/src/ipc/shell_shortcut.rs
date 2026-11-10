#[tauri::command]
pub async fn shell_shortcut(
    app: tauri::AppHandle,
    shortcut: Option<String>,
) -> Result<String, String> {
    #[cfg(windows)]
    {
        use tauri::Manager;
        tauri::async_runtime::spawn_blocking(move || {
            let service = app.state::<crate::windows::shell_shortcut::ShellShortcut>();
            if let Some(value) = shortcut {
                service.configure(value)?;
            }
            Ok(service.current())
        })
        .await
        .map_err(|_| "Shortcut service failed.".to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = (app, shortcut);
        Err("Global shortcuts require Windows.".into())
    }
}
