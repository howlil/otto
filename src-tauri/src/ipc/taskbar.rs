#[tauri::command]
#[cfg(windows)]
pub fn taskbar_auto_hide_state(
    state: tauri::State<'_, crate::windows::taskbar::TaskbarState>,
) -> Result<bool, String> {
    state
        .auto_hide()
        .map_err(|_| "Windows taskbar state is unavailable.".into())
}

#[tauri::command]
#[cfg(not(windows))]
pub fn taskbar_auto_hide_state() -> Result<bool, String> {
    Ok(false)
}

#[tauri::command]
#[cfg(windows)]
pub fn taskbar_set_otto_mode(
    state: tauri::State<'_, crate::windows::taskbar::TaskbarState>,
    enabled: bool,
) -> Result<bool, String> {
    state
        .set_otto_mode(enabled)
        .map_err(|_| "Windows could not change taskbar visibility. Try again.".into())
}

#[tauri::command]
#[cfg(not(windows))]
pub fn taskbar_set_otto_mode(enabled: bool) -> Result<bool, String> {
    let _ = enabled;
    Err("Otto Dock mode requires Windows.".into())
}
