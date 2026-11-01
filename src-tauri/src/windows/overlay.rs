use tauri::WebviewWindow;
use windows_sys::Win32::{
    Foundation::{GetLastError, SetLastError},
    UI::WindowsAndMessaging::{
        GWL_EXSTYLE, GetWindowLongPtrW, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE,
        SWP_NOSIZE, SWP_NOZORDER, SetWindowLongPtrW, SetWindowPos, WS_EX_APPWINDOW,
        WS_EX_TOOLWINDOW,
    },
};

fn overlay_window_style(current: isize) -> isize {
    (current | WS_EX_TOOLWINDOW as isize) & !(WS_EX_APPWINDOW as isize)
}

pub fn configure(window: &WebviewWindow) -> std::io::Result<()> {
    let hwnd = window.hwnd().map_err(std::io::Error::other)?;
    let hwnd = hwnd.0 as _;

    unsafe {
        SetLastError(0);
        let current = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        if current == 0 && GetLastError() != 0 {
            return Err(std::io::Error::last_os_error());
        }

        let desired = overlay_window_style(current);
        if current != desired {
            SetLastError(0);
            let previous = SetWindowLongPtrW(hwnd, GWL_EXSTYLE, desired);
            if previous == 0 && GetLastError() != 0 {
                return Err(std::io::Error::last_os_error());
            }
            if SetWindowPos(
                hwnd,
                std::ptr::null_mut(),
                0,
                0,
                0,
                0,
                SWP_FRAMECHANGED | SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER,
            ) == 0 {
                return Err(std::io::Error::last_os_error());
            }
        }

        SetLastError(0);
        let applied = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        if applied == 0 && GetLastError() != 0 {
            return Err(std::io::Error::last_os_error());
        }
        if applied & WS_EX_TOOLWINDOW as isize == 0 || applied & WS_EX_APPWINDOW as isize != 0 {
            return Err(std::io::Error::other("Otto overlay window style was not applied."));
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows_sys::Win32::UI::WindowsAndMessaging::{WS_EX_LAYERED, WS_EX_TOPMOST};

    #[test]
    fn overlay_style_excludes_appwindow_without_dropping_other_flags() {
        let current = (WS_EX_APPWINDOW | WS_EX_TOPMOST | WS_EX_LAYERED) as isize;
        let adjusted = overlay_window_style(current);

        assert_ne!(adjusted & WS_EX_TOOLWINDOW as isize, 0);
        assert_eq!(adjusted & WS_EX_APPWINDOW as isize, 0);
        assert_ne!(adjusted & WS_EX_TOPMOST as isize, 0);
        assert_ne!(adjusted & WS_EX_LAYERED as isize, 0);
        assert_eq!(overlay_window_style(adjusted), adjusted);
    }
}
