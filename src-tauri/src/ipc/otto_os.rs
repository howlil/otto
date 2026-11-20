pub fn active() -> bool {
    #[cfg(windows)]
    {
        crate::platform::windows::otto_os::active()
    }
    #[cfg(not(windows))]
    {
        false
    }
}

pub fn notch() -> Option<crate::shell::notch::RectPx> {
    #[cfg(windows)]
    {
        crate::platform::windows::otto_os::presence().and_then(|presence| presence.notch)
    }
    #[cfg(not(windows))]
    {
        None
    }
}

#[tauri::command]
pub fn otto_os_active() -> bool {
    active()
}
