use crate::agent::{AgentRuntime, CapturedImage};
use std::{fs::OpenOptions, io::BufWriter, path::PathBuf, time::SystemTime};
use tauri::Manager;
use windows_sys::Win32::{
    Foundation::{HWND, RECT},
    Graphics::Gdi::{
        BI_RGB, BITMAPINFO, CreateCompatibleBitmap, CreateCompatibleDC, DIB_RGB_COLORS, DeleteDC,
        DeleteObject, GetDIBits, GetWindowDC, ReleaseDC, SelectObject,
    },
    Storage::Xps::PrintWindow,
    UI::{
        Input::KeyboardAndMouse::{
            MOD_CONTROL, MOD_NOREPEAT, MOD_SHIFT, RegisterHotKey, UnregisterHotKey,
        },
        WindowsAndMessaging::{
            GetForegroundWindow, GetMessageW, GetWindowRect, GetWindowTextLengthW,
            GetWindowThreadProcessId, IsIconic, IsWindow, IsWindowVisible, MSG, WM_HOTKEY,
        },
    },
};

const HOTKEY_ID: i32 = 0x4f54;
const MAX_EDGE: i32 = 4096;

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

fn capture_foreground(target: isize) -> Result<CapturedImage, String> {
    let hwnd = target as HWND;

    let valid = unsafe {
        !hwnd.is_null()
            && IsWindow(hwnd) != 0
            && IsWindowVisible(hwnd) != 0
            && IsIconic(hwnd) == 0
            && GetForegroundWindow() == hwnd
            && GetWindowTextLengthW(hwnd) > 0
    };
    if !valid {
        return Err(
            "The target window changed or cannot be captured. Focus it and retry the shortcut."
                .into(),
        );
    }
    let mut pid: u32 = 0;
    unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
    if pid == 0 || pid == std::process::id() {
        return Err("Focus a non-Otto application before capturing.".into());
    }
    let mut rect: RECT = unsafe { std::mem::zeroed() };
    if unsafe { GetWindowRect(hwnd, &mut rect) } == 0 {
        return Err("Cannot read the target window bounds.".into());
    }
    let width = rect.right - rect.left;
    let height = rect.bottom - rect.top;
    if !(1..=MAX_EDGE).contains(&width) || !(1..=MAX_EDGE).contains(&height) {
        return Err("The target window size is unsupported.".into());
    }
    let source = unsafe { GetWindowDC(hwnd) };
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

    if unsafe { PrintWindow(hwnd, capture.memory, 0) } == 0 {
        return Err("This application does not support silent window capture.".into());
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
    if copied != height as i32 {
        return Err("Cannot read the rendered target pixels.".into());
    }

    for pixel in pixels.as_chunks_mut::<4>().0 {
        pixel.swap(0, 2);
        pixel[3] = 255;
    }
    let nonce = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map_err(|_| "Cannot create a unique capture file.")?
        .as_nanos();
    let path: PathBuf =
        std::env::temp_dir().join(format!("otto-{}-{nonce}.png", std::process::id()));
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
        .and_then(|mut writer| writer.write_image_data(&pixels))
        .map_err(|_| "Cannot encode the capture.")?;
    Ok(image)
}

pub fn start_hotkey(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let modifiers = MOD_CONTROL | MOD_SHIFT | MOD_NOREPEAT;
        if unsafe { RegisterHotKey(std::ptr::null_mut(), HOTKEY_ID, modifiers, b'O' as u32) } == 0 {
            app.state::<AgentRuntime>().capture_error(
                "Ctrl+Shift+O is unavailable (shortcut conflict). Screen capture is disabled.",
            );
            return;
        }
        let mut message: MSG = unsafe { std::mem::zeroed() };
        while unsafe { GetMessageW(&mut message, std::ptr::null_mut(), 0, 0) } > 0 {
            if message.message != WM_HOTKEY || message.wParam != HOTKEY_ID as usize {
                continue;
            }
            let foreground = unsafe { GetForegroundWindow() };
            let window = foreground as isize;
            let handle = app.clone();
            tauri::async_runtime::spawn(async move {
                let runtime = handle.state::<AgentRuntime>();

                if let Err(reason) = runtime.capture_hotkey(window, capture_foreground).await {
                    runtime.capture_error(&reason);
                }
            });
        }
        unsafe { UnregisterHotKey(std::ptr::null_mut(), HOTKEY_ID) };
    });
}
