use crate::agent::{AgentRuntime, CapturedImage};
use std::{
    fs::OpenOptions,
    io::BufWriter,
    path::PathBuf,
    sync::mpsc::{self, Receiver, Sender, SyncSender},
    time::{Duration, SystemTime},
};
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
            GetForegroundWindow, GetWindowRect, GetWindowTextLengthW,
            GetWindowThreadProcessId, IsIconic, IsWindow, IsWindowVisible, MSG, PM_REMOVE,
            PeekMessageW, WM_HOTKEY,
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Shortcut {
    modifiers: u32,
    key: u32,
}

fn parse_shortcut(value: &str) -> Result<Shortcut, String> {
    let parts: Vec<&str> = value.split('+').map(str::trim).collect();
    if !(3..=4).contains(&parts.len()) {
        return Err("Use Ctrl+Shift+O or Ctrl+Alt+O (one letter key).".into());
    }
    let mut modifiers = MOD_NOREPEAT;
    let mut ctrl = false;
    let mut alt = false;
    let mut shift = false;
    for modifier in &parts[..parts.len() - 1] {
        if modifier.eq_ignore_ascii_case("ctrl") && !ctrl {
            ctrl = true;
            modifiers |= MOD_CONTROL;
        } else if modifier.eq_ignore_ascii_case("alt") && !alt {
            alt = true;
            modifiers |= windows_sys::Win32::UI::Input::KeyboardAndMouse::MOD_ALT;
        } else if modifier.eq_ignore_ascii_case("shift") && !shift {
            shift = true;
            modifiers |= MOD_SHIFT;
        } else {
            return Err("Use unique Ctrl, Alt and Shift modifiers only.".into());
        }
    }
    if !ctrl || !(alt || shift) {
        return Err("A capture shortcut must include Ctrl and Alt or Shift.".into());
    }
    let key = parts[parts.len() - 1];
    if key.len() != 1 || !key.as_bytes()[0].is_ascii_alphabetic() {
        return Err("Choose one letter from A to Z for the capture key.".into());
    }
    Ok(Shortcut {
        modifiers,
        key: key.as_bytes()[0].to_ascii_uppercase() as u32,
    })
}

type HotkeyReply = SyncSender<Result<(), String>>;
type HotkeyChange = (Shortcut, HotkeyReply);

pub struct CaptureHotkeys {
    changes: Sender<HotkeyChange>,
}

impl CaptureHotkeys {
    pub fn configure(&self, value: &str) -> Result<(), String> {
        let requested = parse_shortcut(value)?;
        let (reply, result) = mpsc::sync_channel(1);
        self.changes
            .send((requested, reply))
            .map_err(|_| "The capture shortcut service is unavailable.".to_string())?;
        result
            .recv_timeout(Duration::from_secs(3))
            .map_err(|_| "Capture shortcut configuration timed out.".to_string())?
    }
}

fn register(shortcut: Shortcut) -> bool {
    unsafe { RegisterHotKey(std::ptr::null_mut(), HOTKEY_ID, shortcut.modifiers, shortcut.key) != 0 }
}

fn run_hotkeys(app: tauri::AppHandle, changes: Receiver<HotkeyChange>) {
    let default = parse_shortcut("Ctrl+Shift+O").expect("valid default capture shortcut");
    let mut registered = if register(default) { Some(default) } else { None };
    if registered.is_none() {
        app.state::<AgentRuntime>().capture_error(
            "Ctrl+Shift+O conflicts with another shortcut. Choose a new one in Agent settings.",
        );
    }
    loop {
        while let Ok((requested, reply)) = changes.try_recv() {
            if registered == Some(requested) {
                let _ = reply.send(Ok(()));
                continue;
            }
            if registered.is_some() {
                unsafe { UnregisterHotKey(std::ptr::null_mut(), HOTKEY_ID) };
            }
            if register(requested) {
                registered = Some(requested);
                let _ = reply.send(Ok(()));
            } else {
                let restored = registered.filter(|old| register(*old));
                registered = restored;
                let _ = reply.send(Err(
                    "Shortcut is already in use or unavailable. The previous shortcut was kept when possible.".into(),
                ));
                if restored.is_none() {
                    app.state::<AgentRuntime>().capture_error(
                        "No capture shortcut could be registered. Choose another shortcut in Agent settings.",
                    );
                }
            }
        }

        let mut message: MSG = unsafe { std::mem::zeroed() };
        while unsafe { PeekMessageW(&mut message, std::ptr::null_mut(), 0, 0, PM_REMOVE) } != 0 {
            if message.message != WM_HOTKEY || message.wParam != HOTKEY_ID as usize {
                continue;
            }
            let foreground = unsafe { GetForegroundWindow() };
            let handle = app.clone();
            tauri::async_runtime::spawn(async move {
                let runtime = handle.state::<AgentRuntime>();
                if let Err(reason) = runtime.capture_hotkey(foreground as isize, capture_foreground).await {
                    runtime.capture_error(&reason);
                }
            });
        }
        std::thread::sleep(Duration::from_millis(30));
    }
}

pub fn start_hotkey(app: tauri::AppHandle) -> CaptureHotkeys {
    let (changes, receiver) = mpsc::channel();
    std::thread::spawn(move || run_hotkeys(app, receiver));
    CaptureHotkeys { changes }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shortcuts_require_explicit_safe_modifiers_and_single_letter() {
        assert_eq!(parse_shortcut("Ctrl+Shift+O").unwrap().key, b'O' as u32);
        assert_eq!(
            parse_shortcut("ctrl+ALT+p").unwrap().modifiers,
            MOD_CONTROL | windows_sys::Win32::UI::Input::KeyboardAndMouse::MOD_ALT | MOD_NOREPEAT
        );
        for invalid in ["O", "Alt+O", "Ctrl+O", "Ctrl+Shift+1", "Ctrl+Ctrl+O", "Ctrl+Win+O", ""] {
            assert!(parse_shortcut(invalid).is_err(), "accepted {invalid}");
        }
    }
}
