use super::{
    scroll::{RgbaFrame, ScrollLimits, capture_scrolling_stitched},
    target::{WindowTarget, valid_capture_window, window_pid},
};
use crate::agent::CapturedImage;
use std::{
    fs::{self, OpenOptions},
    io::BufWriter,
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};
use windows_sys::Win32::{
    Foundation::{CloseHandle, ERROR_INVALID_PARAMETER, GetLastError, HWND, RECT},
    Graphics::Gdi::{
        BI_RGB, BITMAPINFO, BitBlt, CAPTUREBLT, CreateCompatibleBitmap, CreateCompatibleDC,
        DIB_RGB_COLORS, DeleteDC, DeleteObject, GetDC, GetDIBits, GetWindowDC, ReleaseDC, SRCCOPY,
        SelectObject,
    },
    Storage::Xps::PrintWindow,
    System::Threading::{GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION},
    UI::WindowsAndMessaging::{
        GetSystemMetrics, GetWindowRect, PW_RENDERFULLCONTENT, SM_CXVIRTUALSCREEN,
        SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN,
    },
};

pub(super) const MAX_EDGE: i32 = 8192;
pub(super) const MAX_PIXELS: u64 = 24_000_000;
pub(super) const CAPTURE_FILE_PREFIX: &str = "otto-capture-";
const ORPHAN_CAPTURE_AGE: Duration = Duration::from_secs(24 * 60 * 60);
const MAX_ORPHAN_REMOVALS: usize = 128;
struct GdiCapture {
    window: HWND,
    source: windows_sys::Win32::Graphics::Gdi::HDC,
    memory: windows_sys::Win32::Graphics::Gdi::HDC,
    bitmap: windows_sys::Win32::Graphics::Gdi::HBITMAP,
    old: windows_sys::Win32::Graphics::Gdi::HGDIOBJ,
}

impl Drop for GdiCapture {
    fn drop(&mut self) {
        unsafe {
            if !self.old.is_null() {
                SelectObject(self.memory, self.old);
            }
            if !self.bitmap.is_null() {
                DeleteObject(self.bitmap as _);
            }
            if !self.memory.is_null() {
                DeleteDC(self.memory);
            }
            if !self.source.is_null() {
                ReleaseDC(self.window, self.source);
            }
        }
    }
}

pub(super) fn capture_foreground(target: WindowTarget) -> Result<CapturedImage, String> {
    let (hwnd, rect) = window_bounds(target)?;
    let frame = capture_rgba(hwnd, rect.right - rect.left, rect.bottom - rect.top, None)?;
    write_png_capture(&frame)
}

pub(super) fn capture_scrolling(target: WindowTarget) -> Result<CapturedImage, String> {
    let (hwnd, rect) = window_bounds(target)?;
    let stitched = capture_scrolling_stitched(
        hwnd,
        rect,
        std::process::id(),
        ScrollLimits {
            max_height: MAX_EDGE as usize,
            max_pixels: MAX_PIXELS as usize,
        },
        window_pid,
        || valid_capture_window(hwnd) && target.matches(hwnd as isize, window_pid(hwnd)),
        || {
            let (current_hwnd, current_rect) = window_bounds(target)?;
            capture_rgba(
                current_hwnd,
                current_rect.right - current_rect.left,
                current_rect.bottom - current_rect.top,
                None,
            )
        },
    )?;
    write_png_capture(&stitched)
}

fn window_bounds(target: WindowTarget) -> Result<(HWND, RECT), String> {
    let hwnd = target.handle as HWND;
    if !valid_capture_window(hwnd) || !target.matches(hwnd as isize, window_pid(hwnd)) {
        return Err("Capture target changed before capture. Focus it and retry.".into());
    }
    let mut rect: RECT = unsafe { std::mem::zeroed() };
    if unsafe { GetWindowRect(hwnd, &mut rect) } == 0 {
        return Err("Cannot read the target window bounds.".into());
    }
    Ok((hwnd, rect))
}

pub(super) fn capture_full_screen() -> Result<CapturedImage, String> {
    let x = unsafe { GetSystemMetrics(SM_XVIRTUALSCREEN) };
    let y = unsafe { GetSystemMetrics(SM_YVIRTUALSCREEN) };
    let width = unsafe { GetSystemMetrics(SM_CXVIRTUALSCREEN) };
    let height = unsafe { GetSystemMetrics(SM_CYVIRTUALSCREEN) };
    capture_screen_rect(x, y, width, height)
}

pub(super) fn capture_screen_rect(
    left: i32,
    top: i32,
    width: i32,
    height: i32,
) -> Result<CapturedImage, String> {
    let frame = capture_rgba(std::ptr::null_mut(), width, height, Some((left, top)))?;
    write_png_capture(&frame)
}

pub(super) fn capture_rgba(
    hwnd: HWND,
    width: i32,
    height: i32,
    screen_origin: Option<(i32, i32)>,
) -> Result<RgbaFrame, String> {
    if !(1..=MAX_EDGE).contains(&width)
        || !(1..=MAX_EDGE).contains(&height)
        || (width as u64) * (height as u64) > MAX_PIXELS
    {
        return Err("Capture size exceeds the supported image limit.".into());
    }
    let source = unsafe {
        if screen_origin.is_some() {
            GetDC(std::ptr::null_mut())
        } else {
            GetWindowDC(hwnd)
        }
    };
    if source.is_null() {
        return Err("Window capture is unavailable.".into());
    }
    let mut capture = GdiCapture {
        window: hwnd,
        source,
        memory: std::ptr::null_mut(),
        bitmap: std::ptr::null_mut(),
        old: std::ptr::null_mut(),
    };
    capture.memory = unsafe { CreateCompatibleDC(source) };
    if capture.memory.is_null() {
        return Err("Cannot create the capture surface.".into());
    }
    capture.bitmap = unsafe { CreateCompatibleBitmap(source, width, height) };
    if capture.bitmap.is_null() {
        return Err("Cannot allocate the capture bitmap.".into());
    }
    capture.old = unsafe { SelectObject(capture.memory, capture.bitmap as _) };
    if capture.old.is_null() {
        return Err("Cannot select the capture bitmap.".into());
    }

    let copied = if let Some((x, y)) = screen_origin {
        unsafe {
            BitBlt(
                capture.memory,
                0,
                0,
                width,
                height,
                source,
                x,
                y,
                SRCCOPY | CAPTUREBLT,
            )
        }
    } else {
        let rendered = unsafe { PrintWindow(hwnd, capture.memory, PW_RENDERFULLCONTENT) };
        if rendered != 0 {
            rendered
        } else {
            unsafe { PrintWindow(hwnd, capture.memory, 0) }
        }
    };
    if copied == 0 {
        return Err("The requested screen image could not be captured.".into());
    }
    unsafe {
        SelectObject(capture.memory, capture.old);
    }
    capture.old = std::ptr::null_mut();
    let mut info: BITMAPINFO = unsafe { std::mem::zeroed() };
    info.bmiHeader.biSize = std::mem::size_of_val(&info.bmiHeader) as u32;
    info.bmiHeader.biWidth = width;
    info.bmiHeader.biHeight = -height;
    info.bmiHeader.biPlanes = 1;
    info.bmiHeader.biBitCount = 32;
    info.bmiHeader.biCompression = BI_RGB;
    let len = width as usize * height as usize * 4;
    let mut pixels = vec![0u8; len];
    let copied = unsafe {
        GetDIBits(
            source,
            capture.bitmap,
            0,
            height as u32,
            pixels.as_mut_ptr() as _,
            &mut info,
            DIB_RGB_COLORS,
        )
    };
    if copied != height {
        return Err("Cannot read the rendered target pixels.".into());
    }

    for pixel in pixels.as_chunks_mut::<4>().0 {
        pixel.swap(0, 2);
        pixel[3] = 255;
    }
    Ok(RgbaFrame {
        width: width as usize,
        height: height as usize,
        pixels,
    })
}

pub(super) fn write_png_capture(frame: &RgbaFrame) -> Result<CapturedImage, String> {
    let width = i32::try_from(frame.width)
        .map_err(|_| "Capture size exceeds the supported image limit.".to_string())?;
    let height = i32::try_from(frame.height)
        .map_err(|_| "Capture size exceeds the supported image limit.".to_string())?;
    if !(1..=MAX_EDGE).contains(&width)
        || !(1..=MAX_EDGE).contains(&height)
        || (width as u64) * (height as u64) > MAX_PIXELS
    {
        return Err("Capture size exceeds the supported image limit.".into());
    }
    let nonce = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map_err(|_| "Cannot create a unique capture file.")?
        .as_nanos();
    let path: PathBuf = std::env::temp_dir().join(format!(
        "{CAPTURE_FILE_PREFIX}{}-{nonce}.png",
        std::process::id()
    ));
    let file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&path)
        .map_err(|_| "Cannot create the temporary capture.")?;
    let image = CapturedImage::new(path);
    let mut png = png::Encoder::new(BufWriter::new(file), width as u32, height as u32);
    png.set_color(png::ColorType::Rgba);
    png.set_depth(png::BitDepth::Eight);
    png.write_header()
        .and_then(|mut writer| writer.write_image_data(&frame.pixels))
        .map_err(|_| "Cannot encode the capture.")?;
    Ok(image)
}

pub(super) fn capture_file_owner(file_name: &str) -> Option<u32> {
    let stem = file_name
        .strip_prefix(CAPTURE_FILE_PREFIX)?
        .strip_suffix(".png")?;
    let (pid, nonce) = stem.split_once('-')?;
    if !(16..=24).contains(&nonce.len()) || !nonce.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    pid.parse::<u32>().ok().filter(|pid| *pid != 0)
}

fn process_is_active(pid: u32) -> bool {
    if pid == std::process::id() {
        return true;
    }
    let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if process.is_null() {
        return unsafe { GetLastError() } != ERROR_INVALID_PARAMETER;
    }
    let mut exit_code = 0;
    let checked = unsafe { GetExitCodeProcess(process, &mut exit_code) };
    unsafe { CloseHandle(process) };
    checked == 0 || exit_code == 259
}

pub(super) fn cleanup_orphan_captures(
    directory: &Path,
    now: SystemTime,
    is_process_active: impl Fn(u32) -> bool,
) -> usize {
    let Ok(entries) = fs::read_dir(directory) else {
        return 0;
    };
    let mut removed = 0;
    for entry in entries.flatten() {
        if removed >= MAX_ORPHAN_REMOVALS {
            break;
        }
        let name = entry.file_name();
        let Some(pid) = name.to_str().and_then(capture_file_owner) else {
            continue;
        };
        if pid == std::process::id() || is_process_active(pid) {
            continue;
        }
        let path = entry.path();
        let Ok(metadata) = fs::symlink_metadata(&path) else {
            continue;
        };
        if !metadata.file_type().is_file()
            || !metadata
                .modified()
                .ok()
                .and_then(|modified| now.duration_since(modified).ok())
                .is_some_and(|age| age >= ORPHAN_CAPTURE_AGE)
        {
            continue;
        }
        if fs::remove_file(&path).is_ok() {
            removed += 1;
        }
    }
    removed
}

pub(super) fn cleanup_startup_captures() {
    cleanup_orphan_captures(&std::env::temp_dir(), SystemTime::now(), process_is_active);
}
