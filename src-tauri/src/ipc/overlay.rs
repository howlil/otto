use tauri::WebviewWindow;

#[tauri::command]
pub fn overlay_protection_status(window: WebviewWindow) -> Result<bool, String> {
    #[cfg(windows)]
    {
        crate::windows::overlay::capture_protection_status(&window)
            .map_err(|_| "Windows capture protection status is unavailable.".into())
    }
    #[cfg(not(windows))]
    {
        let _ = window;
        Ok(false)
    }
}

#[tauri::command]
pub fn overlay_set_capture_protection(
    window: WebviewWindow,
    enabled: bool,
) -> Result<bool, String> {
    #[cfg(windows)]
    {
        crate::windows::overlay::set_capture_protection(&window, enabled)
            .map_err(|_| "Windows could not change capture protection. Try again.".into())
    }
    #[cfg(not(windows))]
    {
        let _ = (window, enabled);
        Err("Capture protection requires Windows.".into())
    }
}
