use super::region_state::RegionRect;
use std::{
    ffi::c_void,
    mem::size_of,
    ptr::{null, null_mut},
    sync::atomic::{AtomicU64, Ordering},
};
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM},
    Graphics::{
        Dwm::{
            DWM_WINDOW_CORNER_PREFERENCE, DWMNCRENDERINGPOLICY, DWMNCRP_DISABLED,
            DWMWA_BORDER_COLOR, DWMWA_COLOR_NONE, DWMWA_EXCLUDED_FROM_PEEK,
            DWMWA_NCRENDERING_POLICY, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_DONOTROUND,
            DwmSetWindowAttribute,
        },
        Gdi::{
            BeginPaint, CombineRgn, CreateRectRgn, CreateSolidBrush, DeleteObject, EndPaint,
            FrameRect, InvalidateRect, PAINTSTRUCT, RGN_DIFF, SetWindowRgn, UpdateWindow,
        },
    },
    System::LibraryLoader::GetModuleHandleW,
    UI::{
        Controls::SetWindowTheme,
        WindowsAndMessaging::{
            CreateWindowExW, DestroyWindow, GetClientRect, GetWindowDisplayAffinity, HWND_TOPMOST,
            IsWindowVisible, LWA_ALPHA, RegisterClassW, SW_HIDE, SW_SHOWNOACTIVATE, SWP_NOACTIVATE,
            SWP_NOOWNERZORDER, SWP_NOREDRAW, SetLayeredWindowAttributes, SetWindowDisplayAffinity,
            SetWindowPos, ShowWindow, UnregisterClassW, WNDCLASSW, WS_EX_LAYERED, WS_EX_NOACTIVATE,
            WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_EX_TRANSPARENT, WS_POPUP,
        },
    },
};

const BORDER_PX: i32 = 2;
const EXCLUDE_FROM_CAPTURE: u32 = 0x11;
const OVERLAY_ALPHA: u8 = 235;
const OUTER_BORDER_COLOR: u32 = 0x0014_1110;
const INNER_BORDER_COLOR: u32 = 0x00FA_FAFA;
const EMPTY_WIDE: [u16; 1] = [0];

static OVERLAY_CLASS_SEQ: AtomicU64 = AtomicU64::new(1);

pub(super) struct RegionOverlay {
    pub(super) hwnd: HWND,
    class_name: Vec<u16>,
    pub(super) instance: *mut c_void,
}

impl RegionOverlay {
    pub(super) fn create(
        wnd_proc: unsafe extern "system" fn(HWND, u32, WPARAM, LPARAM) -> LRESULT,
    ) -> Result<Self, String> {
        let instance = unsafe { GetModuleHandleW(null()) };
        let seq = OVERLAY_CLASS_SEQ.fetch_add(1, Ordering::Relaxed);
        let class_name: Vec<u16> = format!("OttoRegionOverlay-{}-{seq}\0", std::process::id())
            .encode_utf16()
            .collect();
        let class = WNDCLASSW {
            style: 0,
            lpfnWndProc: Some(wnd_proc),
            cbClsExtra: 0,
            cbWndExtra: 0,
            hInstance: instance,
            hIcon: null_mut(),
            hCursor: null_mut(),
            hbrBackground: null_mut(),
            lpszMenuName: null(),
            lpszClassName: class_name.as_ptr(),
        };
        if unsafe { RegisterClassW(&class) } == 0 {
            return Err("Cannot initialize the area selection overlay.".into());
        }
        let ex_style =
            WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_TOPMOST | WS_EX_NOACTIVATE;
        let hwnd = unsafe {
            CreateWindowExW(
                ex_style,
                class_name.as_ptr(),
                EMPTY_WIDE.as_ptr(),
                WS_POPUP,
                0,
                0,
                0,
                0,
                null_mut(),
                null_mut(),
                instance,
                null(),
            )
        };
        if hwnd.is_null() {
            unsafe {
                UnregisterClassW(class_name.as_ptr(), instance);
            }
            return Err("Cannot create the area selection overlay.".into());
        }
        let overlay = Self {
            hwnd,
            class_name,
            instance,
        };
        configure_protected_overlay(overlay.hwnd)?;
        Ok(overlay)
    }

    pub(super) fn hide(&self) {
        unsafe {
            ShowWindow(self.hwnd, SW_HIDE);
        }
    }
}

impl Drop for RegionOverlay {
    fn drop(&mut self) {
        unsafe {
            if !self.hwnd.is_null() {
                ShowWindow(self.hwnd, SW_HIDE);
                DestroyWindow(self.hwnd);
            }
            UnregisterClassW(self.class_name.as_ptr(), self.instance);
        }
    }
}

pub(super) fn verify_capture_exclusion(hwnd: HWND) -> bool {
    let mut affinity = 0u32;
    unsafe {
        GetWindowDisplayAffinity(hwnd, &mut affinity) != 0 && affinity == EXCLUDE_FROM_CAPTURE
    }
}

fn configure_protected_overlay(hwnd: HWND) -> Result<(), String> {
    if unsafe { SetLayeredWindowAttributes(hwnd, 0, OVERLAY_ALPHA, LWA_ALPHA) } == 0 {
        return Err("Cannot configure the layered selection overlay.".into());
    }
    let policy = DWMNCRP_DISABLED;
    let _ = unsafe {
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_NCRENDERING_POLICY as u32,
            (&raw const policy).cast(),
            size_of::<DWMNCRENDERINGPOLICY>() as u32,
        )
    };
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
    let excluded_from_peek = 1i32;
    let _ = unsafe {
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_EXCLUDED_FROM_PEEK as u32,
            (&raw const excluded_from_peek).cast(),
            size_of::<i32>() as u32,
        )
    };
    let _ = unsafe { SetWindowTheme(hwnd, EMPTY_WIDE.as_ptr(), EMPTY_WIDE.as_ptr()) };
    if unsafe { SetWindowDisplayAffinity(hwnd, EXCLUDE_FROM_CAPTURE) } == 0
        || !verify_capture_exclusion(hwnd)
    {
        return Err(
            "Screen capture protection for area selection is unavailable on this Windows session."
                .into(),
        );
    }
    Ok(())
}

fn apply_hollow_region(hwnd: HWND, width: i32, height: i32, redraw: i32) {
    unsafe {
        let outer = CreateRectRgn(0, 0, width, height);
        if outer.is_null() {
            return;
        }
        if width > BORDER_PX * 2 && height > BORDER_PX * 2 {
            let inner = CreateRectRgn(BORDER_PX, BORDER_PX, width - BORDER_PX, height - BORDER_PX);
            if !inner.is_null() {
                CombineRgn(outer, outer, inner, RGN_DIFF);
                DeleteObject(inner as _);
            }
        }
        if SetWindowRgn(hwnd, outer, redraw) == 0 {
            DeleteObject(outer as _);
        }
    }
}

pub(super) fn show_overlay_rect(hwnd: HWND, rect: RegionRect) -> bool {
    let width = rect.width();
    let height = rect.height();
    if width < 2 || height < 2 {
        unsafe {
            ShowWindow(hwnd, SW_HIDE);
        }
        return false;
    }
    let already_visible = unsafe { IsWindowVisible(hwnd) != 0 };
    unsafe {
        SetWindowPos(
            hwnd,
            HWND_TOPMOST,
            rect.left,
            rect.top,
            width,
            height,
            SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_NOREDRAW,
        );
    }
    apply_hollow_region(hwnd, width, height, i32::from(already_visible));
    unsafe {
        if !already_visible {
            ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        }
        InvalidateRect(hwnd, null(), 0);
        UpdateWindow(hwnd);
    }
    true
}

pub(super) fn paint_border(hwnd: HWND) {
    unsafe {
        let mut paint: PAINTSTRUCT = std::mem::zeroed();
        let hdc = BeginPaint(hwnd, &mut paint);
        if !hdc.is_null() {
            let mut client: RECT = std::mem::zeroed();
            if GetClientRect(hwnd, &mut client) != 0 {
                let outer = CreateSolidBrush(OUTER_BORDER_COLOR);
                if !outer.is_null() {
                    FrameRect(hdc, &client, outer);
                    DeleteObject(outer as _);
                }
                if client.right > 2 && client.bottom > 2 {
                    let inner_rect = RECT {
                        left: 1,
                        top: 1,
                        right: client.right - 1,
                        bottom: client.bottom - 1,
                    };
                    let inner = CreateSolidBrush(INNER_BORDER_COLOR);
                    if !inner.is_null() {
                        FrameRect(hdc, &inner_rect, inner);
                        DeleteObject(inner as _);
                    }
                }
            }
            EndPaint(hwnd, &paint);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::platform::windows::capture::{
        image::{capture_screen_rect, write_png_capture},
        scroll::RgbaFrame,
    };
    use std::fs;
    use windows_sys::Win32::{
        Graphics::{
            Dwm::DwmFlush,
            Gdi::{
                BI_RGB, BITMAPINFO, BITMAPINFOHEADER, BitBlt, CAPTUREBLT, CreateCompatibleBitmap,
                CreateCompatibleDC, CreateDIBSection, DIB_RGB_COLORS, DeleteDC, FillRect, GetDC,
                GetDIBits, GetWindowRgn, PtInRegion, ReleaseDC, SRCCOPY, SelectObject,
            },
        },
        Storage::Xps::PrintWindow,
        UI::WindowsAndMessaging::{
            DefWindowProcW, GWL_EXSTYLE, GetForegroundWindow, GetWindowLongPtrW,
            GetWindowTextLengthW, HTTRANSPARENT, MA_NOACTIVATEANDEAT, WM_ERASEBKGND,
            WM_MOUSEACTIVATE, WM_NCACTIVATE, WM_NCCALCSIZE, WM_NCHITTEST, WM_NCPAINT, WM_PAINT,
            WS_EX_APPWINDOW,
        },
    };

    unsafe extern "system" fn probe_overlay_proc(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        match message {
            WM_NCCALCSIZE | WM_NCPAINT | WM_NCACTIVATE => 0,
            WM_ERASEBKGND => 1,
            WM_MOUSEACTIVATE => MA_NOACTIVATEANDEAT as LRESULT,
            WM_NCHITTEST => HTTRANSPARENT as LRESULT,
            WM_PAINT => {
                paint_border(hwnd);
                0
            }
            _ => unsafe { DefWindowProcW(hwnd, message, wparam, lparam) },
        }
    }

    struct BackdropWindow {
        hwnd: HWND,
        class_name: Vec<u16>,
        instance: *mut c_void,
    }

    unsafe extern "system" fn backdrop_proc(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        if message == WM_PAINT {
            unsafe {
                let mut paint: PAINTSTRUCT = std::mem::zeroed();
                let hdc = BeginPaint(hwnd, &mut paint);
                if !hdc.is_null() {
                    let mut rect: RECT = std::mem::zeroed();
                    GetClientRect(hwnd, &mut rect);
                    let brush = CreateSolidBrush(0x0020_C820);
                    if !brush.is_null() {
                        FillRect(hdc, &rect, brush);
                        DeleteObject(brush as _);
                    }
                    EndPaint(hwnd, &paint);
                }
            }
            return 0;
        }
        unsafe { DefWindowProcW(hwnd, message, wparam, lparam) }
    }

    impl BackdropWindow {
        fn create(x: i32, y: i32, width: i32, height: i32) -> Self {
            let instance = unsafe { GetModuleHandleW(null()) };
            let seq = OVERLAY_CLASS_SEQ.fetch_add(1, Ordering::Relaxed);
            let class_name: Vec<u16> = format!("OttoRegionBackdrop-{}-{seq}\0", std::process::id())
                .encode_utf16()
                .collect();
            let class = WNDCLASSW {
                style: 0,
                lpfnWndProc: Some(backdrop_proc),
                cbClsExtra: 0,
                cbWndExtra: 0,
                hInstance: instance,
                hIcon: null_mut(),
                hCursor: null_mut(),
                hbrBackground: null_mut(),
                lpszMenuName: null(),
                lpszClassName: class_name.as_ptr(),
            };
            assert_ne!(unsafe { RegisterClassW(&class) }, 0);
            let hwnd = unsafe {
                CreateWindowExW(
                    WS_EX_TOOLWINDOW | WS_EX_TOPMOST | WS_EX_NOACTIVATE,
                    class_name.as_ptr(),
                    EMPTY_WIDE.as_ptr(),
                    WS_POPUP,
                    x,
                    y,
                    width,
                    height,
                    null_mut(),
                    null_mut(),
                    instance,
                    null(),
                )
            };
            assert!(!hwnd.is_null());
            unsafe {
                ShowWindow(hwnd, SW_SHOWNOACTIVATE);
                InvalidateRect(hwnd, null(), 0);
                UpdateWindow(hwnd);
            }
            Self {
                hwnd,
                class_name,
                instance,
            }
        }
    }

    impl Drop for BackdropWindow {
        fn drop(&mut self) {
            unsafe {
                DestroyWindow(self.hwnd);
                UnregisterClassW(self.class_name.as_ptr(), self.instance);
            }
        }
    }

    fn print_window_rgb(hwnd: HWND, width: i32, height: i32) -> Vec<(u8, u8, u8)> {
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
            let old = SelectObject(dc, bitmap as _);
            assert_ne!(PrintWindow(hwnd, dc, 0), 0);
            let bytes =
                std::slice::from_raw_parts(bits as *const u8, (width * height * 4) as usize);
            let pixels = bytes
                .chunks_exact(4)
                .map(|bgra| (bgra[2], bgra[1], bgra[0]))
                .collect();
            SelectObject(dc, old);
            DeleteObject(bitmap as _);
            DeleteDC(dc);
            pixels
        }
    }

    fn try_sample_screen_rgb(x: i32, y: i32, width: i32, height: i32) -> Option<Vec<(u8, u8, u8)>> {
        unsafe {
            let screen = GetDC(null_mut());
            if screen.is_null() {
                return None;
            }
            let memory = CreateCompatibleDC(screen);
            let bitmap = CreateCompatibleBitmap(screen, width, height);
            if memory.is_null() || bitmap.is_null() {
                if !bitmap.is_null() {
                    DeleteObject(bitmap as _);
                }
                if !memory.is_null() {
                    DeleteDC(memory);
                }
                ReleaseDC(null_mut(), screen);
                return None;
            }
            let old = SelectObject(memory, bitmap as _);
            let copied = BitBlt(
                memory,
                0,
                0,
                width,
                height,
                screen,
                x,
                y,
                SRCCOPY | CAPTUREBLT,
            );
            SelectObject(memory, old);
            if copied == 0 {
                DeleteObject(bitmap as _);
                DeleteDC(memory);
                ReleaseDC(null_mut(), screen);
                return None;
            }
            let mut info = BITMAPINFO {
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
            let mut bytes = vec![0u8; (width * height * 4) as usize];
            let rows = GetDIBits(
                screen,
                bitmap,
                0,
                height as u32,
                bytes.as_mut_ptr() as _,
                &mut info,
                DIB_RGB_COLORS,
            );
            DeleteObject(bitmap as _);
            DeleteDC(memory);
            ReleaseDC(null_mut(), screen);
            if rows != height {
                return None;
            }
            Some(
                bytes
                    .chunks_exact(4)
                    .map(|bgra| (bgra[2], bgra[1], bgra[0]))
                    .collect(),
            )
        }
    }

    #[test]
    fn native_selection_overlay_is_non_activating_hollow_untitled_and_capture_excluded() {
        let backdrop_x = 120;
        let backdrop_y = 120;
        let _backdrop = BackdropWindow::create(backdrop_x, backdrop_y, 160, 160);
        let overlay = RegionOverlay::create(probe_overlay_proc)
            .expect("overlay creates with capture exclusion");
        let before_foreground = unsafe { GetForegroundWindow() };

        let border_rect = RegionRect {
            left: backdrop_x + 20,
            top: backdrop_y + 20,
            right: backdrop_x + 120,
            bottom: backdrop_y + 120,
        };
        assert!(show_overlay_rect(overlay.hwnd, border_rect));
        assert!(verify_capture_exclusion(overlay.hwnd));
        unsafe {
            let _ = DwmFlush();
        }

        assert_ne!(unsafe { GetForegroundWindow() }, overlay.hwnd);
        assert_eq!(unsafe { GetForegroundWindow() }, before_foreground);
        assert_eq!(unsafe { GetWindowTextLengthW(overlay.hwnd) }, 0);
        let ex_style = unsafe { GetWindowLongPtrW(overlay.hwnd, GWL_EXSTYLE) } as u32;
        let required =
            WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_TOPMOST | WS_EX_NOACTIVATE;
        assert_eq!(ex_style & required, required);
        assert_eq!(ex_style & WS_EX_APPWINDOW, 0);

        unsafe {
            let region = CreateRectRgn(0, 0, 0, 0);
            assert!(!region.is_null());
            assert_ne!(GetWindowRgn(overlay.hwnd, region), 0);
            assert_ne!(PtInRegion(region, 0, 0), 0);
            assert_ne!(PtInRegion(region, 1, 1), 0);
            assert_ne!(PtInRegion(region, 50, 0), 0);
            assert_ne!(PtInRegion(region, 99, 50), 0);
            assert_eq!(PtInRegion(region, 2, 2), 0);
            assert_eq!(PtInRegion(region, 50, 50), 0);
            assert_eq!(PtInRegion(region, 97, 97), 0);
            DeleteObject(region as _);
        }

        let printed = print_window_rgb(overlay.hwnd, 100, 100);
        assert_eq!(printed[0], (16, 17, 20));
        assert_eq!(printed[100 + 1], (250, 250, 250));

        if let Some(protected_pixels) =
            try_sample_screen_rgb(border_rect.left, border_rect.top, 40, 6)
        {
            assert!(
                protected_pixels
                    .iter()
                    .all(|&(r, g, b)| g > r.saturating_add(80) && g > b.saturating_add(80)),
                "protected selection border leaked into screen capture: {:?}",
                &protected_pixels[..10]
            );

            assert_ne!(unsafe { SetWindowDisplayAffinity(overlay.hwnd, 0) }, 0);
            overlay.hide();
            show_overlay_rect(overlay.hwnd, border_rect);
            unsafe {
                let _ = DwmFlush();
            }
            std::thread::sleep(std::time::Duration::from_millis(60));
            if let Some(unprotected_pixels) =
                try_sample_screen_rgb(border_rect.left, border_rect.top, 40, 6)
            {
                assert!(
                    unprotected_pixels
                        .iter()
                        .any(|&(r, g, b)| g.abs_diff(r) < 30 && g.abs_diff(b) < 30),
                    "expected local border to be painted visibly when capture exclusion is disabled"
                );
            }
        }
    }

    #[test]
    fn screen_rect_capture_validates_bounds_and_png_encoding_cleans_up_temp_file() {
        assert!(capture_screen_rect(0, 0, 0, 48).is_err());
        assert!(capture_screen_rect(0, 0, 64, -1).is_err());
        assert!(capture_screen_rect(0, 0, 9000, 64).is_err());

        let frame = RgbaFrame {
            width: 64,
            height: 48,
            pixels: vec![180; 64 * 48 * 4],
        };
        let image = write_png_capture(&frame).expect("png encoding succeeds");
        let path = image.path().to_path_buf();
        assert!(path.exists());
        let decoder = png::Decoder::new(std::io::BufReader::new(fs::File::open(&path).unwrap()));
        let reader = decoder.read_info().unwrap();
        assert_eq!(reader.info().width, 64);
        assert_eq!(reader.info().height, 48);
        drop(reader);
        drop(image);
        assert!(!path.exists());
    }
}
