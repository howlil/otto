use std::io;
use tauri::WebviewWindow;
use windows_sys::Win32::{
    Foundation::{GetLastError, HWND, SetLastError},
    UI::WindowsAndMessaging::{
        GWL_EXSTYLE, GetWindowDisplayAffinity, GetWindowLongPtrW, SWP_FRAMECHANGED,
        SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, SetWindowDisplayAffinity,
        SetWindowLongPtrW, SetWindowPos, WS_EX_APPWINDOW, WS_EX_TOOLWINDOW,
    },
};

const EXCLUDE_FROM_CAPTURE: u32 = 0x11;

fn overlay_window_style(current: isize) -> isize {
    (current | WS_EX_TOOLWINDOW as isize) & !(WS_EX_APPWINDOW as isize)
}

fn is_overlay_window_style(style: isize) -> bool {
    style & WS_EX_TOOLWINDOW as isize != 0 && style & WS_EX_APPWINDOW as isize == 0
}

fn read_style(hwnd: HWND) -> io::Result<isize> {
    unsafe {
        SetLastError(0);
        let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        if style == 0 && GetLastError() != 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(style)
    }
}

fn refresh_frame(hwnd: HWND) -> io::Result<()> {
    let result = unsafe {
        SetWindowPos(
            hwnd,
            std::ptr::null_mut(),
            0,
            0,
            0,
            0,
            SWP_FRAMECHANGED | SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER,
        )
    };
    if result == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

fn apply_tool_style(hwnd: HWND) -> io::Result<()> {
    let previous = read_style(hwnd)?;
    let desired = overlay_window_style(previous);
    if desired == previous {
        return Ok(());
    }

    unsafe {
        SetLastError(0);
        let replaced = SetWindowLongPtrW(hwnd, GWL_EXSTYLE, desired);
        if replaced == 0 && GetLastError() != 0 {
            return Err(io::Error::last_os_error());
        }
    }

    let applied = refresh_frame(hwnd).and_then(|_| read_style(hwnd));
    if applied.as_ref().is_ok_and(|style| is_overlay_window_style(*style)) {
        return Ok(());
    }

    unsafe {
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, previous);
    }
    let _ = refresh_frame(hwnd);
    match applied {
        Ok(_) => Err(io::Error::other("The overlay tool-window style was not retained.")),
        Err(error) => Err(error),
    }
}

fn read_affinity(hwnd: HWND) -> io::Result<u32> {
    let mut affinity = 0u32;
    if unsafe { GetWindowDisplayAffinity(hwnd, &mut affinity) } == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(affinity)
}

fn apply_capture_exclusion(hwnd: HWND) -> io::Result<()> {
    if read_affinity(hwnd).is_ok_and(|value| value == EXCLUDE_FROM_CAPTURE) {
        return Ok(());
    }

    if unsafe { SetWindowDisplayAffinity(hwnd, EXCLUDE_FROM_CAPTURE) } == 0 {
        return Err(io::Error::last_os_error());
    }

    if read_affinity(hwnd)? != EXCLUDE_FROM_CAPTURE {
        return Err(io::Error::other("Capture exclusion affinity was not retained."));
    }
    Ok(())
}

pub fn configure(window: &WebviewWindow) -> io::Result<()> {
    let hwnd = window.hwnd().map_err(io::Error::other)?.0 as _;
    let style = apply_tool_style(hwnd);
    let affinity = apply_capture_exclusion(hwnd);

    match (style, affinity) {
        (Ok(()), Ok(())) => Ok(()),
        (Err(error), Ok(())) => Err(io::Error::other(format!(
            "Tool-window classification failed: {error}"
        ))),
        (Ok(()), Err(error)) => Err(io::Error::other(format!(
            "Capture exclusion failed: {error}"
        ))),
        (Err(style), Err(affinity)) => Err(io::Error::other(format!(
            "Tool-window classification failed: {style}; capture exclusion failed: {affinity}"
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows_sys::Win32::UI::WindowsAndMessaging::{WS_EX_LAYERED, WS_EX_TOPMOST};

    #[test]
    fn preserves_overlay_layering_topmost_and_unrelated_extended_styles() {
        let unrelated = 0x00040000isize;
        let current = (WS_EX_APPWINDOW | WS_EX_TOPMOST | WS_EX_LAYERED) as isize | unrelated;
        let adjusted = overlay_window_style(current);

        assert!(is_overlay_window_style(adjusted));
        assert_eq!(adjusted & WS_EX_TOPMOST as isize, WS_EX_TOPMOST as isize);
        assert_eq!(adjusted & WS_EX_LAYERED as isize, WS_EX_LAYERED as isize);
        assert_eq!(adjusted & unrelated, unrelated);
        assert_eq!(overlay_window_style(adjusted), adjusted);
    }

    #[test]
    fn rejects_regular_or_conflicting_window_styles() {
        assert!(!is_overlay_window_style(0));
        assert!(!is_overlay_window_style(WS_EX_APPWINDOW as isize));
        assert!(!is_overlay_window_style(
            (WS_EX_TOOLWINDOW | WS_EX_APPWINDOW) as isize
        ));
        assert!(is_overlay_window_style(WS_EX_TOOLWINDOW as isize));
    }
}
