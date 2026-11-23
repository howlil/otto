use std::io;
use std::ptr::null_mut;
use tauri::WebviewWindow;
use windows_sys::Win32::{
    Foundation::{GetLastError, HWND, LPARAM, LRESULT, SetLastError, WPARAM},
    Graphics::Dwm::{
        DWM_WINDOW_CORNER_PREFERENCE, DWMNCRENDERINGPOLICY, DWMNCRP_DISABLED, DWMWA_BORDER_COLOR,
        DWMWA_COLOR_NONE, DWMWA_NCRENDERING_POLICY, DWMWA_WINDOW_CORNER_PREFERENCE,
        DWMWCP_DONOTROUND, DwmSetWindowAttribute,
    },
    System::Threading::GetCurrentThreadId,
    UI::{
        Controls::SetWindowTheme,
        Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass},
        WindowsAndMessaging::{
            GWL_EXSTYLE, GWL_STYLE, GetWindowDisplayAffinity, GetWindowLongPtrW,
            GetWindowTextLengthW, GetWindowThreadProcessId, STYLESTRUCT, SWP_FRAMECHANGED,
            SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, SetWindowDisplayAffinity,
            SetWindowLongPtrW, SetWindowPos, WM_NCACTIVATE, WM_NCCALCSIZE, WM_NCDESTROY,
            WM_NCPAINT, WM_STYLECHANGING, WS_BORDER, WS_CAPTION, WS_DLGFRAME, WS_EX_APPWINDOW,
            WS_EX_CLIENTEDGE, WS_EX_DLGMODALFRAME, WS_EX_STATICEDGE, WS_EX_TOOLWINDOW,
            WS_EX_WINDOWEDGE, WS_MAXIMIZEBOX, WS_MINIMIZEBOX, WS_POPUP, WS_SYSMENU, WS_THICKFRAME,
        },
    },
};

const EXCLUDE_FROM_CAPTURE: u32 = 0x11;
const NO_CAPTURE_RESTRICTION: u32 = 0;
const NONCLIENT_SUBCLASS_ID: usize = 0x4F54_544F;
const EMPTY_WIDE: [u16; 1] = [0];
const NONCLIENT_FRAME_STYLE: u32 = WS_CAPTION
    | WS_BORDER
    | WS_DLGFRAME
    | WS_SYSMENU
    | WS_MINIMIZEBOX
    | WS_MAXIMIZEBOX
    | WS_THICKFRAME;
const NONCLIENT_EX_STYLE: u32 =
    WS_EX_APPWINDOW | WS_EX_WINDOWEDGE | WS_EX_DLGMODALFRAME | WS_EX_CLIENTEDGE | WS_EX_STATICEDGE;

fn overlay_window_style(current: u32) -> u32 {
    (current | WS_EX_TOOLWINDOW) & !NONCLIENT_EX_STYLE
}

fn is_overlay_window_style(style: u32) -> bool {
    style & WS_EX_TOOLWINDOW != 0 && style & NONCLIENT_EX_STYLE == 0
}

fn borderless_window_style(current: u32) -> u32 {
    (current & !NONCLIENT_FRAME_STYLE) | WS_POPUP
}

fn is_borderless_window_style(style: u32) -> bool {
    style & WS_POPUP != 0 && style & NONCLIENT_FRAME_STYLE == 0
}

fn read_style_bits(hwnd: HWND, index: i32) -> io::Result<u32> {
    unsafe {
        SetLastError(0);
        let value = GetWindowLongPtrW(hwnd, index);
        if value == 0 && GetLastError() != 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(value as u32)
    }
}

fn write_style_bits(hwnd: HWND, index: i32, value: u32) -> io::Result<()> {
    unsafe {
        SetLastError(0);
        let replaced = SetWindowLongPtrW(hwnd, index, value as i32 as isize);
        if replaced == 0 && GetLastError() != 0 {
            return Err(io::Error::last_os_error());
        }
    }
    Ok(())
}

fn refresh_frame(hwnd: HWND) -> io::Result<()> {
    let result = unsafe {
        SetWindowPos(
            hwnd,
            null_mut(),
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

fn apply_style_bits(
    hwnd: HWND,
    index: i32,
    transform: fn(u32) -> u32,
    verify: fn(u32) -> bool,
    not_retained_message: &str,
) -> io::Result<()> {
    let previous = read_style_bits(hwnd, index)?;
    let desired = transform(previous);
    if desired == previous {
        return Ok(());
    }

    write_style_bits(hwnd, index, desired)?;

    let applied = refresh_frame(hwnd).and_then(|_| read_style_bits(hwnd, index));
    if applied.as_ref().is_ok_and(|style| verify(*style)) {
        return Ok(());
    }

    let _ = write_style_bits(hwnd, index, previous);
    let _ = refresh_frame(hwnd);
    match applied {
        Ok(_) => Err(io::Error::other(not_retained_message)),
        Err(error) => Err(error),
    }
}

fn apply_tool_style(hwnd: HWND) -> io::Result<()> {
    apply_style_bits(
        hwnd,
        GWL_EXSTYLE,
        overlay_window_style,
        is_overlay_window_style,
        "The overlay tool-window style was not retained.",
    )
}

fn apply_borderless_style(hwnd: HWND) -> io::Result<()> {
    apply_style_bits(
        hwnd,
        GWL_STYLE,
        borderless_window_style,
        is_borderless_window_style,
        "The borderless overlay window style was not retained.",
    )
}

fn disable_nonclient_rendering(hwnd: HWND) -> io::Result<()> {
    let policy = DWMNCRP_DISABLED;
    let status = unsafe {
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_NCRENDERING_POLICY as u32,
            (&raw const policy).cast(),
            size_of::<DWMNCRENDERINGPOLICY>() as u32,
        )
    };
    if status < 0 {
        return Err(io::Error::from_raw_os_error(status));
    }

    let corner = DWMWCP_DONOTROUND;
    let _ = unsafe {
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_WINDOW_CORNER_PREFERENCE as u32,
            (&raw const corner).cast(),
            size_of::<DWM_WINDOW_CORNER_PREFERENCE>() as u32,
        )
    };

    let border = DWMWA_COLOR_NONE;
    let _ = unsafe {
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_BORDER_COLOR as u32,
            (&raw const border).cast(),
            size_of::<u32>() as u32,
        )
    };

    let _ = unsafe { SetWindowTheme(hwnd, EMPTY_WIDE.as_ptr(), EMPTY_WIDE.as_ptr()) };
    Ok(())
}

unsafe extern "system" fn nonclient_subclass_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    subclass_id: usize,
    _ref_data: usize,
) -> LRESULT {
    match message {
        WM_STYLECHANGING => {
            if lparam != 0 {
                let styles = unsafe { &mut *(lparam as *mut STYLESTRUCT) };
                match wparam as i32 {
                    GWL_STYLE => styles.styleNew = borderless_window_style(styles.styleNew),
                    GWL_EXSTYLE => styles.styleNew = overlay_window_style(styles.styleNew),
                    _ => {}
                }
            }
            unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
        }
        WM_NCCALCSIZE | WM_NCPAINT => 0,
        WM_NCACTIVATE => unsafe { DefSubclassProc(hwnd, message, wparam, -1) },
        WM_NCDESTROY => unsafe {
            RemoveWindowSubclass(hwnd, Some(nonclient_subclass_proc), subclass_id);
            DefSubclassProc(hwnd, message, wparam, lparam)
        },
        _ => unsafe { DefSubclassProc(hwnd, message, wparam, lparam) },
    }
}

fn is_window_thread(hwnd: HWND) -> bool {
    let window_thread = unsafe { GetWindowThreadProcessId(hwnd, null_mut()) };
    window_thread != 0 && window_thread == unsafe { GetCurrentThreadId() }
}

fn install_nonclient_guard(hwnd: HWND) -> io::Result<()> {
    if !is_window_thread(hwnd) {
        return Err(io::Error::other(
            "Non-client subclass guard must be installed on the window thread.",
        ));
    }
    let installed = unsafe {
        SetWindowSubclass(
            hwnd,
            Some(nonclient_subclass_proc),
            NONCLIENT_SUBCLASS_ID,
            0,
        )
    };
    if installed == 0 {
        return Err(io::Error::other(
            "Windows rejected the overlay non-client subclass guard.",
        ));
    }
    Ok(())
}

fn ensure_nonclient_guard(window: &WebviewWindow, hwnd: HWND) -> io::Result<()> {
    if is_window_thread(hwnd) {
        return install_nonclient_guard(hwnd);
    }
    let raw = hwnd as isize;
    window
        .run_on_main_thread(move || {
            let _ = install_nonclient_guard(raw as HWND);
        })
        .map_err(io::Error::other)
}

pub fn ensure_tool_style(window: &WebviewWindow) -> io::Result<()> {
    let hwnd = window.hwnd().map_err(io::Error::other)?.0 as HWND;
    apply_borderless_style(hwnd)?;
    apply_tool_style(hwnd)?;
    disable_nonclient_rendering(hwnd)?;
    ensure_nonclient_guard(window, hwnd)
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

    if let Err(error) = apply_borderless_style(hwnd) {
        failures.push(format!("Borderless frame failed: {error}"));
    }
    if let Err(error) = apply_tool_style(hwnd) {
        failures.push(format!("Tool-window classification failed: {error}"));
    }
    if let Err(error) = disable_nonclient_rendering(hwnd) {
        failures.push(format!("Non-client rendering suppression failed: {error}"));
    }
    if let Err(error) = ensure_nonclient_guard(window, hwnd) {
        failures.push(format!("Non-client guard installation failed: {error}"));
    }
    if let Err(error) = clear_picker_title(window, hwnd) {
        failures.push(format!("Window title suppression failed: {error}"));
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
        WS_CLIPSIBLINGS, WS_EX_LAYERED, WS_EX_TOPMOST, WS_EX_TRANSPARENT, WS_VISIBLE,
    };

    #[cfg(target_os = "windows")]
    mod native_window {
        use super::*;
        use std::ffi::c_void;
        use std::ptr::null;
        use std::sync::atomic::{AtomicU32, Ordering};
        use windows_sys::Win32::{
            Graphics::{
                Dwm::{
                    DWM_BB_BLURREGION, DWM_BB_ENABLE, DWM_BLURBEHIND, DWMWA_NCRENDERING_ENABLED,
                    DwmEnableBlurBehindWindow, DwmFlush, DwmGetWindowAttribute,
                },
                Gdi::{
                    BI_RGB, BITMAPINFO, BITMAPINFOHEADER, BeginPaint, CreateCompatibleDC,
                    CreateDIBSection, CreateRectRgn, DIB_RGB_COLORS, DeleteDC, DeleteObject,
                    EndPaint, PAINTSTRUCT, SelectObject, UpdateWindow,
                },
            },
            Storage::Xps::PrintWindow,
            System::LibraryLoader::GetModuleHandleW,
            UI::WindowsAndMessaging::{
                CreateWindowExW, DefWindowProcW, DestroyWindow, GWLP_USERDATA, RegisterClassW,
                SW_SHOWNOACTIVATE, SendMessageW, SetWindowTextW, ShowWindow, WM_ERASEBKGND,
                WM_PAINT, WNDCLASSW, WS_EX_ACCEPTFILES, WS_OVERLAPPED,
            },
        };

        #[derive(Default)]
        struct NcProbeState {
            nc_activate_calls: Vec<(WPARAM, LPARAM)>,
        }

        unsafe extern "system" fn affinity_proc(
            hwnd: HWND,
            message: u32,
            wparam: WPARAM,
            lparam: LPARAM,
        ) -> LRESULT {
            unsafe { DefWindowProcW(hwnd, message, wparam, lparam) }
        }

        unsafe extern "system" fn tao_like_proc(
            hwnd: HWND,
            message: u32,
            wparam: WPARAM,
            lparam: LPARAM,
        ) -> LRESULT {
            match message {
                WM_NCCALCSIZE => 0,
                WM_ERASEBKGND => 1,
                WM_PAINT => {
                    let mut paint = unsafe { std::mem::zeroed::<PAINTSTRUCT>() };
                    unsafe {
                        BeginPaint(hwnd, &mut paint);
                        EndPaint(hwnd, &paint);
                    }
                    0
                }
                WM_NCACTIVATE => {
                    let ptr =
                        unsafe { GetWindowLongPtrW(hwnd, GWLP_USERDATA) } as *mut NcProbeState;
                    if !ptr.is_null() {
                        unsafe { (*ptr).nc_activate_calls.push((wparam, lparam)) };
                    }
                    unsafe { DefWindowProcW(hwnd, message, wparam, lparam) }
                }
                _ => unsafe { DefWindowProcW(hwnd, message, wparam, lparam) },
            }
        }

        static PROBE_CLASS: AtomicU32 = AtomicU32::new(0);

        struct TestWindow {
            hwnd: HWND,
            state: Option<Box<NcProbeState>>,
        }

        impl Drop for TestWindow {
            fn drop(&mut self) {
                unsafe {
                    SetWindowLongPtrW(self.hwnd, GWLP_USERDATA, 0);
                    DestroyWindow(self.hwnd);
                }
            }
        }

        fn register_probe_class(
            prefix: &str,
            wnd_proc: unsafe extern "system" fn(HWND, u32, WPARAM, LPARAM) -> LRESULT,
        ) -> (Vec<u16>, *mut c_void) {
            let class: Vec<u16> =
                format!("{prefix}{}\0", PROBE_CLASS.fetch_add(1, Ordering::Relaxed))
                    .encode_utf16()
                    .collect();
            let instance = unsafe { GetModuleHandleW(null()) };
            let class_info = WNDCLASSW {
                style: 0,
                lpfnWndProc: Some(wnd_proc),
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
            (class, instance)
        }

        fn create_window() -> TestWindow {
            let (class, instance) = register_probe_class("OttoAffinityProbe", affinity_proc);
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
            TestWindow { hwnd, state: None }
        }

        fn create_tao_like_window() -> TestWindow {
            let (class, instance) = register_probe_class("OttoNonClientProbe", tao_like_proc);
            let title: Vec<u16> = "Otto\0".encode_utf16().collect();
            let style = WS_CAPTION | WS_CLIPSIBLINGS | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX;
            let ex_style = WS_EX_WINDOWEDGE | WS_EX_ACCEPTFILES | WS_EX_APPWINDOW | WS_EX_TOPMOST;
            let hwnd = unsafe {
                CreateWindowExW(
                    ex_style,
                    class.as_ptr(),
                    title.as_ptr(),
                    style,
                    -2000,
                    -2000,
                    360,
                    80,
                    null_mut(),
                    null_mut(),
                    instance,
                    null(),
                )
            };
            assert!(!hwnd.is_null());

            let mut state = Box::new(NcProbeState::default());
            let state_ptr = (&raw mut *state) as isize;
            unsafe {
                SetWindowLongPtrW(hwnd, GWLP_USERDATA, state_ptr);
                let empty = CreateRectRgn(0, 0, -1, -1);
                let blur = DWM_BLURBEHIND {
                    dwFlags: DWM_BB_ENABLE | DWM_BB_BLURREGION,
                    fEnable: 1,
                    hRgnBlur: empty,
                    fTransitionOnMaximized: 0,
                };
                let _ = DwmEnableBlurBehindWindow(hwnd, &blur);
                DeleteObject(empty as _);
            }

            TestWindow {
                hwnd,
                state: Some(state),
            }
        }

        fn capture_window_column(
            hwnd: HWND,
            width: i32,
            height: i32,
            sample_x: i32,
        ) -> Vec<(u8, u8, u8)> {
            unsafe {
                let dc = CreateCompatibleDC(null_mut());
                assert!(!dc.is_null());
                let info = BITMAPINFO {
                    bmiHeader: BITMAPINFOHEADER {
                        biSize: size_of::<BITMAPINFOHEADER>() as u32,
                        biWidth: width,
                        biHeight: -height,
                        biPlanes: 1,
                        biBitCount: 32,
                        biCompression: BI_RGB,
                        biSizeImage: 0,
                        biXPelsPerMeter: 0,
                        biYPelsPerMeter: 0,
                        biClrUsed: 0,
                        biClrImportant: 0,
                    },
                    bmiColors: [std::mem::zeroed()],
                };
                let mut bits: *mut c_void = null_mut();
                let bitmap = CreateDIBSection(dc, &info, DIB_RGB_COLORS, &mut bits, null_mut(), 0);
                assert!(!bitmap.is_null());
                assert!(!bits.is_null());
                let previous = SelectObject(dc, bitmap as _);
                let printed = PrintWindow(hwnd, dc, 0);
                assert_ne!(printed, 0);

                let bytes =
                    std::slice::from_raw_parts(bits as *const u8, (width * height * 4) as usize);
                let mut pixels = Vec::with_capacity(height as usize);
                for y in 0..height {
                    let offset = ((y * width + sample_x) * 4) as usize;
                    pixels.push((bytes[offset + 2], bytes[offset + 1], bytes[offset]));
                }

                SelectObject(dc, previous);
                DeleteObject(bitmap as _);
                DeleteDC(dc);
                pixels
            }
        }

        #[test]
        fn capture_protection_toggle_changes_real_window_affinity() {
            let window = create_window();
            assert_eq!(read_affinity(window.hwnd).unwrap(), NO_CAPTURE_RESTRICTION);

            set_affinity(window.hwnd, true).unwrap();
            assert_eq!(read_affinity(window.hwnd).unwrap(), EXCLUDE_FROM_CAPTURE);

            set_affinity(window.hwnd, true).unwrap();
            assert_eq!(read_affinity(window.hwnd).unwrap(), EXCLUDE_FROM_CAPTURE);

            set_affinity(window.hwnd, false).unwrap();
            assert_eq!(read_affinity(window.hwnd).unwrap(), NO_CAPTURE_RESTRICTION);
        }

        #[test]
        fn overlay_default_application_excludes_a_window_that_started_capturable() {
            let window = create_window();
            apply_capture_exclusion(window.hwnd).unwrap();
            assert_eq!(read_affinity(window.hwnd).unwrap(), EXCLUDE_FROM_CAPTURE);
        }

        #[test]
        fn nonclient_guard_blocks_caption_restoration_and_suppresses_nonclient_paint() {
            let unguarded = create_tao_like_window();
            unsafe {
                ShowWindow(unguarded.hwnd, SW_SHOWNOACTIVATE);
                SendMessageW(unguarded.hwnd, WM_NCACTIVATE, 1, 0);
                SendMessageW(unguarded.hwnd, WM_NCPAINT, 1, 0);
                UpdateWindow(unguarded.hwnd);
                let _ = DwmFlush();
            }
            let unguarded_column = capture_window_column(unguarded.hwnd, 360, 80, 180);
            assert!(
                unguarded_column[..50]
                    .iter()
                    .any(|&(r, g, b)| r != 0 || g != 0 || b != 0),
                "expected unguarded WS_CAPTION window to paint non-client caption pixels"
            );

            let guarded = create_tao_like_window();
            apply_borderless_style(guarded.hwnd).unwrap();
            apply_tool_style(guarded.hwnd).unwrap();
            disable_nonclient_rendering(guarded.hwnd).unwrap();
            install_nonclient_guard(guarded.hwnd).unwrap();
            install_nonclient_guard(guarded.hwnd).unwrap();

            let attempted_style =
                WS_CAPTION | WS_BORDER | WS_DLGFRAME | WS_SYSMENU | WS_THICKFRAME | WS_CLIPSIBLINGS;
            let attempted_ex = WS_EX_WINDOWEDGE
                | WS_EX_DLGMODALFRAME
                | WS_EX_CLIENTEDGE
                | WS_EX_STATICEDGE
                | WS_EX_APPWINDOW
                | WS_EX_TOPMOST;
            write_style_bits(guarded.hwnd, GWL_STYLE, attempted_style).unwrap();
            write_style_bits(guarded.hwnd, GWL_EXSTYLE, attempted_ex).unwrap();
            refresh_frame(guarded.hwnd).unwrap();

            let actual_style = read_style_bits(guarded.hwnd, GWL_STYLE).unwrap();
            let actual_ex = read_style_bits(guarded.hwnd, GWL_EXSTYLE).unwrap();
            assert!(is_borderless_window_style(actual_style));
            assert!(is_overlay_window_style(actual_ex));
            assert_eq!(actual_style & WS_CLIPSIBLINGS, WS_CLIPSIBLINGS);
            assert_eq!(actual_ex & WS_EX_TOPMOST, WS_EX_TOPMOST);

            let mut nc_rendering_enabled = -1i32;
            let dwm_status = unsafe {
                DwmGetWindowAttribute(
                    guarded.hwnd,
                    DWMWA_NCRENDERING_ENABLED as u32,
                    (&raw mut nc_rendering_enabled).cast(),
                    size_of::<i32>() as u32,
                )
            };
            assert!(dwm_status >= 0);
            assert_eq!(nc_rendering_enabled, 0);

            unsafe {
                ShowWindow(guarded.hwnd, SW_SHOWNOACTIVATE);
                SetWindowTextW(guarded.hwnd, EMPTY_WIDE.as_ptr());
                SendMessageW(guarded.hwnd, WM_NCACTIVATE, 1, 0);
                SendMessageW(guarded.hwnd, WM_NCACTIVATE, 0, 0);
                SendMessageW(guarded.hwnd, WM_NCPAINT, 1, 0);
                UpdateWindow(guarded.hwnd);
                let _ = DwmFlush();
            }

            let probe_state = guarded.state.as_ref().unwrap();
            assert!(probe_state.nc_activate_calls.contains(&(1, -1)));
            assert!(probe_state.nc_activate_calls.contains(&(0, -1)));

            let guarded_column = capture_window_column(guarded.hwnd, 360, 80, 180);
            assert!(
                guarded_column
                    .iter()
                    .all(|&(r, g, b)| r == 0 && g == 0 && b == 0),
                "expected guarded overlay window to paint zero non-client pixels"
            );
        }
    }

    #[test]
    fn borderless_style_drops_caption_frame_and_keeps_visibility() {
        let current = WS_CAPTION
            | WS_BORDER
            | WS_DLGFRAME
            | WS_SYSMENU
            | WS_MINIMIZEBOX
            | WS_MAXIMIZEBOX
            | WS_THICKFRAME
            | WS_CLIPSIBLINGS
            | WS_VISIBLE;
        let adjusted = borderless_window_style(current);

        assert!(is_borderless_window_style(adjusted));
        assert_eq!(adjusted & NONCLIENT_FRAME_STYLE, 0);
        assert_eq!(adjusted & WS_POPUP, WS_POPUP);
        assert_eq!(adjusted & WS_CLIPSIBLINGS, WS_CLIPSIBLINGS);
        assert_eq!(adjusted & WS_VISIBLE, WS_VISIBLE);
        assert_eq!(borderless_window_style(adjusted), adjusted);
    }

    #[test]
    fn preserves_overlay_layering_topmost_and_unrelated_extended_styles() {
        let unrelated = WS_EX_TRANSPARENT;
        let current = WS_EX_APPWINDOW
            | WS_EX_WINDOWEDGE
            | WS_EX_DLGMODALFRAME
            | WS_EX_CLIENTEDGE
            | WS_EX_STATICEDGE
            | WS_EX_TOPMOST
            | WS_EX_LAYERED
            | unrelated;
        let adjusted = overlay_window_style(current);

        assert!(is_overlay_window_style(adjusted));
        assert_eq!(adjusted & NONCLIENT_EX_STYLE, 0);
        assert_eq!(adjusted & WS_EX_TOPMOST, WS_EX_TOPMOST);
        assert_eq!(adjusted & WS_EX_LAYERED, WS_EX_LAYERED);
        assert_eq!(adjusted & unrelated, unrelated);
        assert_eq!(overlay_window_style(adjusted), adjusted);
    }

    #[test]
    fn overlay_configuration_keeps_window_untitled_and_capture_protected() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../../../tauri.conf.json")).unwrap();
        let window = &config["app"]["windows"][0];

        assert_eq!(window["label"], "main");
        assert_eq!(window["title"], "");
        assert_eq!(window["contentProtected"], true);
        assert_eq!(window["alwaysOnTop"], true);
        assert_eq!(window["skipTaskbar"], true);

        let args = window["additionalBrowserArgs"]
            .as_str()
            .expect("additionalBrowserArgs configured");
        for required in [
            "msWebOOUI",
            "msPdfOOUI",
            "msSmartScreenProtection",
            "--num-raster-threads=1",
            "--disk-cache-size=",
            "--max-old-space-size=",
        ] {
            assert!(
                args.contains(required),
                "expected additionalBrowserArgs to contain {required}"
            );
        }
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
        assert!(!is_overlay_window_style(WS_EX_APPWINDOW));
        assert!(!is_overlay_window_style(WS_EX_TOOLWINDOW | WS_EX_APPWINDOW));
        assert!(!is_overlay_window_style(
            WS_EX_TOOLWINDOW | WS_EX_WINDOWEDGE
        ));
        assert!(!is_overlay_window_style(
            WS_EX_TOOLWINDOW | WS_EX_DLGMODALFRAME
        ));
        assert!(is_overlay_window_style(WS_EX_TOOLWINDOW));

        assert!(!is_borderless_window_style(0));
        assert!(!is_borderless_window_style(WS_CAPTION));
        assert!(!is_borderless_window_style(WS_POPUP | WS_CAPTION));
        assert!(!is_borderless_window_style(WS_POPUP | WS_BORDER));
        assert!(!is_borderless_window_style(WS_POPUP | WS_THICKFRAME));
        assert!(is_borderless_window_style(WS_POPUP));
    }
}
