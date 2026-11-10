use std::io;
use tauri::WebviewWindow;
use windows_sys::Win32::{
    Foundation::{GetLastError, HWND, SetLastError},
    UI::WindowsAndMessaging::{
        GWL_EXSTYLE, GetWindowDisplayAffinity, GetWindowLongPtrW, GetWindowTextLengthW,
        SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER,
        SetWindowDisplayAffinity, SetWindowLongPtrW, SetWindowPos, WS_EX_APPWINDOW,
        WS_EX_TOOLWINDOW,
    },
};

const EXCLUDE_FROM_CAPTURE: u32 = 0x11;
const NO_CAPTURE_RESTRICTION: u32 = 0;

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
    if applied
        .as_ref()
        .is_ok_and(|style| is_overlay_window_style(*style))
    {
        return Ok(());
    }

    unsafe {
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, previous);
    }
    let _ = refresh_frame(hwnd);
    match applied {
        Ok(_) => Err(io::Error::other(
            "The overlay tool-window style was not retained.",
        )),
        Err(error) => Err(error),
    }
}

pub fn ensure_tool_style(window: &WebviewWindow) -> io::Result<()> {
    apply_tool_style(window.hwnd().map_err(io::Error::other)?.0 as HWND)
}

fn read_affinity(hwnd: HWND) -> io::Result<u32> {
    let mut affinity = 0u32;
    if unsafe { GetWindowDisplayAffinity(hwnd, &mut affinity) } == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(affinity)
}

fn requested_capture_affinity(enabled: bool) -> u32 {
    if enabled {
        EXCLUDE_FROM_CAPTURE
    } else {
        NO_CAPTURE_RESTRICTION
    }
}

fn set_affinity(hwnd: HWND, enabled: bool) -> io::Result<()> {
    let requested = requested_capture_affinity(enabled);
    if read_affinity(hwnd).is_ok_and(|current| current == requested) {
        return Ok(());
    }
    if unsafe { SetWindowDisplayAffinity(hwnd, requested) } == 0 {
        return Err(io::Error::last_os_error());
    }
    if read_affinity(hwnd)? != requested {
        return Err(io::Error::other(
            "Window capture affinity was not retained.",
        ));
    }
    Ok(())
}

fn apply_capture_exclusion(hwnd: HWND) -> io::Result<()> {
    set_affinity(hwnd, true)
}

pub fn capture_protection_status(window: &WebviewWindow) -> io::Result<bool> {
    let hwnd = window.hwnd().map_err(io::Error::other)?.0 as _;
    match read_affinity(hwnd)? {
        EXCLUDE_FROM_CAPTURE => Ok(true),
        NO_CAPTURE_RESTRICTION => Ok(false),
        _ => Err(io::Error::other("Unexpected window capture affinity.")),
    }
}

pub fn set_capture_protection(window: &WebviewWindow, enabled: bool) -> io::Result<bool> {
    let hwnd = window.hwnd().map_err(io::Error::other)?.0 as _;
    set_affinity(hwnd, enabled)?;
    capture_protection_status(window)
}

fn clear_picker_title(window: &WebviewWindow, hwnd: HWND) -> io::Result<()> {
    window.set_title("").map_err(io::Error::other)?;

    unsafe {
        SetLastError(0);
        let length = GetWindowTextLengthW(hwnd);
        if length != 0 {
            return Err(io::Error::other(
                "The overlay window title was not cleared.",
            ));
        }
        if GetLastError() != 0 {
            return Err(io::Error::last_os_error());
        }
    }

    Ok(())
}

pub fn configure(window: &WebviewWindow) -> io::Result<()> {
    let hwnd = window.hwnd().map_err(io::Error::other)?.0 as _;
    let mut failures = Vec::new();

    if let Err(error) = clear_picker_title(window, hwnd) {
        failures.push(format!("Window title suppression failed: {error}"));
    }
    if let Err(error) = apply_tool_style(hwnd) {
        failures.push(format!("Tool-window classification failed: {error}"));
    }
    if let Err(error) = apply_capture_exclusion(hwnd) {
        failures.push(format!("Capture exclusion failed: {error}"));
    }

    if failures.is_empty() {
        Ok(())
    } else {
        Err(io::Error::other(failures.join("; ")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        WS_EX_LAYERED, WS_EX_TOPMOST, WS_EX_TRANSPARENT,
    };

    #[cfg(target_os = "windows")]
    mod native_affinity {
        use super::*;
        use std::ptr::{null, null_mut};
        use std::sync::atomic::{AtomicU32, Ordering};
        use windows_sys::Win32::{
            Foundation::{LPARAM, LRESULT, WPARAM},
            System::LibraryLoader::GetModuleHandleW,
            UI::WindowsAndMessaging::{
                CreateWindowExW, DefWindowProcW, DestroyWindow, RegisterClassW, SW_SHOWNOACTIVATE,
                ShowWindow, WNDCLASSW, WS_OVERLAPPED,
            },
        };

        unsafe extern "system" fn test_proc(
            hwnd: HWND,
            message: u32,
            wparam: WPARAM,
            lparam: LPARAM,
        ) -> LRESULT {
            unsafe { DefWindowProcW(hwnd, message, wparam, lparam) }
        }

        static PROBE_CLASS: AtomicU32 = AtomicU32::new(0);

        struct TestWindow(HWND);

        impl Drop for TestWindow {
            fn drop(&mut self) {
                unsafe { DestroyWindow(self.0) };
            }
        }

        fn create_window() -> TestWindow {
            let class: Vec<u16> = format!(
                "OttoAffinityProbe{}\0",
                PROBE_CLASS.fetch_add(1, Ordering::Relaxed)
            )
            .encode_utf16()
            .collect();
            let instance = unsafe { GetModuleHandleW(null()) };
            let class_info = WNDCLASSW {
                style: 0,
                lpfnWndProc: Some(test_proc),
                cbClsExtra: 0,
                cbWndExtra: 0,
                hInstance: instance,
                hIcon: null_mut(),
                hCursor: null_mut(),
                hbrBackground: null_mut(),
                lpszMenuName: null(),
                lpszClassName: class.as_ptr(),
            };
            assert_ne!(unsafe { RegisterClassW(&class_info) }, 0);
            let title: Vec<u16> = "Otto affinity probe\0".encode_utf16().collect();
            let hwnd = unsafe {
                CreateWindowExW(
                    0,
                    class.as_ptr(),
                    title.as_ptr(),
                    WS_OVERLAPPED,
                    0,
                    0,
                    64,
                    64,
                    null_mut(),
                    null_mut(),
                    instance,
                    null(),
                )
            };
            assert!(!hwnd.is_null());
            unsafe { ShowWindow(hwnd, SW_SHOWNOACTIVATE) };
            TestWindow(hwnd)
        }

        #[test]
        fn capture_protection_toggle_changes_real_window_affinity() {
            let window = create_window();
            assert_eq!(read_affinity(window.0).unwrap(), NO_CAPTURE_RESTRICTION);

            set_affinity(window.0, true).unwrap();
            assert_eq!(read_affinity(window.0).unwrap(), EXCLUDE_FROM_CAPTURE);

            set_affinity(window.0, true).unwrap();
            assert_eq!(read_affinity(window.0).unwrap(), EXCLUDE_FROM_CAPTURE);

            set_affinity(window.0, false).unwrap();
            assert_eq!(read_affinity(window.0).unwrap(), NO_CAPTURE_RESTRICTION);
        }

        #[test]
        fn overlay_default_application_excludes_a_window_that_started_capturable() {
            let window = create_window();
            apply_capture_exclusion(window.0).unwrap();
            assert_eq!(read_affinity(window.0).unwrap(), EXCLUDE_FROM_CAPTURE);
        }
    }

    #[test]
    fn preserves_overlay_layering_topmost_and_unrelated_extended_styles() {
        let unrelated = WS_EX_TRANSPARENT as isize;
        let current = (WS_EX_APPWINDOW | WS_EX_TOPMOST | WS_EX_LAYERED) as isize | unrelated;
        let adjusted = overlay_window_style(current);

        assert!(is_overlay_window_style(adjusted));
        assert_eq!(adjusted & WS_EX_TOPMOST as isize, WS_EX_TOPMOST as isize);
        assert_eq!(adjusted & WS_EX_LAYERED as isize, WS_EX_LAYERED as isize);
        assert_eq!(adjusted & unrelated, unrelated);
        assert_eq!(overlay_window_style(adjusted), adjusted);
    }

    #[test]
    fn overlay_configuration_keeps_window_untitled_and_capture_protected() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../../tauri.conf.json")).unwrap();
        let window = &config["app"]["windows"][0];

        assert_eq!(window["label"], "main");
        assert_eq!(window["title"], "");
        assert_eq!(window["contentProtected"], true);
        assert_eq!(window["alwaysOnTop"], true);
        assert_eq!(window["skipTaskbar"], true);
    }

    #[test]
    fn capture_protection_toggle_uses_exact_windows_affinity_values() {
        assert_eq!(requested_capture_affinity(true), EXCLUDE_FROM_CAPTURE);
        assert_eq!(requested_capture_affinity(false), NO_CAPTURE_RESTRICTION);
        assert_ne!(
            requested_capture_affinity(true),
            requested_capture_affinity(false)
        );
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
