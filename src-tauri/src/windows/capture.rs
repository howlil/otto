use crate::agent::{AgentRuntime, CapturedImage};
use std::{
    fs::{self, OpenOptions},
    io::BufWriter,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, Sender, SyncSender},
    },
    time::{Duration, SystemTime},
};
use tauri::Manager;
use windows_sys::Win32::{
    Foundation::{CloseHandle, ERROR_INVALID_PARAMETER, GetLastError, HWND, RECT},
    Graphics::Gdi::{
        BI_RGB, BITMAPINFO, BitBlt, CAPTUREBLT, CreateCompatibleBitmap, CreateCompatibleDC,
        DIB_RGB_COLORS, DeleteDC, DeleteObject, GetDC, GetDIBits, GetWindowDC, ReleaseDC, SRCCOPY,
        SelectObject,
    },
    Storage::Xps::PrintWindow,
    System::Threading::{
        GetCurrentThreadId, GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    },
    UI::{
        Accessibility::{SetWinEventHook, UnhookWinEvent},
        Input::KeyboardAndMouse::{
            MOD_CONTROL, MOD_NOREPEAT, MOD_SHIFT, RegisterHotKey, UnregisterHotKey,
        },
        WindowsAndMessaging::{
            EVENT_SYSTEM_FOREGROUND, GetForegroundWindow, GetMessageW, GetSystemMetrics,
            GetWindowRect, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId,
            IsIconic, IsWindow, IsWindowVisible, MSG, PM_NOREMOVE, PeekMessageW,
            PostThreadMessageW, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN,
            SM_YVIRTUALSCREEN, WINEVENT_OUTOFCONTEXT, WINEVENT_SKIPOWNPROCESS, WM_APP, WM_HOTKEY,
        },
    },
};

const HOTKEY_ID: i32 = 0x4f54;
const MAX_EDGE: i32 = 8192;
const MAX_PIXELS: u64 = 24_000_000;
const CAPTURE_FILE_PREFIX: &str = "otto-capture-";
const ORPHAN_CAPTURE_AGE: Duration = Duration::from_secs(24 * 60 * 60);
const MAX_ORPHAN_REMOVALS: usize = 128;
const WM_HOTKEY_CONFIG: u32 = WM_APP + 19;
static LAST_EXTERNAL_WINDOW: Mutex<Option<WindowTarget>> = Mutex::new(None);

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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct WindowTarget {
    handle: isize,
    pid: u32,
}

impl WindowTarget {
    fn matches(self, handle: isize, pid: u32) -> bool {
        self.handle == handle && self.pid == pid && pid != 0
    }

    fn pin(hwnd: HWND) -> Option<Self> {
        let pid = window_pid(hwnd);
        (valid_capture_window(hwnd) && pid != 0).then_some(Self {
            handle: hwnd as isize,
            pid,
        })
    }
}

fn window_pid(hwnd: HWND) -> u32 {
    if hwnd.is_null() {
        return 0;
    }
    let mut pid = 0;
    unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
    pid
}

fn external_window(hwnd: HWND) -> bool {
    let pid = window_pid(hwnd);
    pid != 0 && pid != std::process::id()
}

fn valid_capture_window(hwnd: HWND) -> bool {
    external_window(hwnd)
        && unsafe {
            IsWindow(hwnd) != 0
                && IsWindowVisible(hwnd) != 0
                && IsIconic(hwnd) == 0
                && GetWindowTextLengthW(hwnd) > 0
        }
}

unsafe extern "system" fn on_foreground(
    _: windows_sys::Win32::UI::Accessibility::HWINEVENTHOOK,
    _: u32,
    hwnd: HWND,
    object: i32,
    child: i32,
    _: u32,
    _: u32,
) {
    if object != 0 || child != 0 {
        return;
    }
    if external_window(hwnd)
        && let Ok(mut last) = LAST_EXTERNAL_WINDOW.lock()
    {
        *last = WindowTarget::pin(hwnd);
    }
}

fn choose_capture_target(
    foreground_pid: u32,
    own_pid: u32,
    current: Option<WindowTarget>,
    last: Option<WindowTarget>,
) -> Option<WindowTarget> {
    if foreground_pid == 0 {
        None
    } else if foreground_pid == own_pid {
        last
    } else {
        current
    }
}

fn select_capture_target() -> Result<WindowTarget, String> {
    let current = unsafe { GetForegroundWindow() };
    let pid = window_pid(current);
    let last = *LAST_EXTERNAL_WINDOW
        .lock()
        .map_err(|_| "Window tracking is unavailable.")?;
    let target = choose_capture_target(pid, std::process::id(), WindowTarget::pin(current), last);
    let target = target.ok_or("Previous application window is unavailable. Focus it and retry.")?;
    if !valid_capture_window(target.handle as HWND)
        || !target.matches(target.handle, window_pid(target.handle as HWND))
    {
        return Err("Previous window changed or disappeared. Focus it and retry.".into());
    }
    Ok(target)
}

pub fn capture_target_title() -> Result<String, String> {
    let target = select_capture_target()?;
    let hwnd = target.handle as HWND;
    let len = unsafe { GetWindowTextLengthW(hwnd) };
    if len <= 0 {
        return Err("No named external window is available. Focus an app and retry.".into());
    }
    let mut buffer = vec![0u16; len.min(128) as usize + 1];
    let copied = unsafe { GetWindowTextW(hwnd, buffer.as_mut_ptr(), buffer.len() as i32) };
    if copied <= 0 || !target.matches(hwnd as isize, window_pid(hwnd)) {
        return Err("Window target changed. Refocus the app and retry.".into());
    }
    Ok(String::from_utf16_lossy(&buffer[..copied as usize]))
}

fn capture_foreground(target: WindowTarget) -> Result<CapturedImage, String> {
    let hwnd = target.handle as HWND;
    if !valid_capture_window(hwnd) || !target.matches(hwnd as isize, window_pid(hwnd)) {
        return Err("Capture target changed before capture. Focus it and retry.".into());
    }
    let mut rect: RECT = unsafe { std::mem::zeroed() };
    if unsafe { GetWindowRect(hwnd, &mut rect) } == 0 {
        return Err("Cannot read the target window bounds.".into());
    }
    capture_image(hwnd, rect.right - rect.left, rect.bottom - rect.top, None)
}

fn capture_full_screen() -> Result<CapturedImage, String> {
    let x = unsafe { GetSystemMetrics(SM_XVIRTUALSCREEN) };
    let y = unsafe { GetSystemMetrics(SM_YVIRTUALSCREEN) };
    let width = unsafe { GetSystemMetrics(SM_CXVIRTUALSCREEN) };
    let height = unsafe { GetSystemMetrics(SM_CYVIRTUALSCREEN) };
    capture_image(std::ptr::null_mut(), width, height, Some((x, y)))
}

fn capture_image(
    hwnd: HWND,
    width: i32,
    height: i32,
    screen_origin: Option<(i32, i32)>,
) -> Result<CapturedImage, String> {
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
        unsafe { PrintWindow(hwnd, capture.memory, 0) }
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
        .and_then(|mut writer| writer.write_image_data(&pixels))
        .map_err(|_| "Cannot encode the capture.")?;
    Ok(image)
}

fn capture_file_owner(file_name: &str) -> Option<u32> {
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

fn cleanup_orphan_captures(
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum CaptureSource {
    Window,
    FullScreen,
}

impl CaptureSource {
    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "window" => Ok(Self::Window),
            "fullScreen" => Ok(Self::FullScreen),
            _ => Err("Unknown capture source.".into()),
        }
    }
}

type HotkeyReply = SyncSender<Result<(), String>>;

enum HotkeyChange {
    Shortcut(Shortcut, HotkeyReply),
    Source(CaptureSource, HotkeyReply),
    Trigger(HotkeyReply),
}

enum CaptureIntent {
    Window(WindowTarget),
    FullScreen,
}

pub struct CaptureHotkeys {
    changes: Sender<HotkeyChange>,
    thread_id: u32,
    armed: Arc<AtomicBool>,
}

impl CaptureHotkeys {
    pub fn trigger(&self) -> Result<(), String> {
        self.request(HotkeyChange::Trigger)
    }

    pub fn configure(&self, value: &str) -> Result<(), String> {
        let requested = parse_shortcut(value)?;
        self.request(|reply| HotkeyChange::Shortcut(requested, reply))
    }

    pub fn configure_source(&self, value: &str) -> Result<(), String> {
        let requested = CaptureSource::parse(value)?;
        self.armed.store(false, Ordering::SeqCst);
        self.request(|reply| HotkeyChange::Source(requested, reply))?;
        self.armed.store(true, Ordering::SeqCst);
        Ok(())
    }

    fn request(&self, build: impl FnOnce(HotkeyReply) -> HotkeyChange) -> Result<(), String> {
        let (reply, result) = mpsc::sync_channel(1);
        if self.thread_id == 0 {
            return Err("The capture shortcut service did not start.".into());
        }
        self.changes
            .send(build(reply))
            .map_err(|_| "The capture shortcut service is unavailable.".to_string())?;
        if unsafe { PostThreadMessageW(self.thread_id, WM_HOTKEY_CONFIG, 0, 0) } == 0 {
            return Err("The capture shortcut service cannot receive updates.".into());
        }
        result
            .recv_timeout(Duration::from_secs(3))
            .map_err(|_| "Capture shortcut configuration timed out.".to_string())?
    }
}

fn register(shortcut: Shortcut) -> bool {
    unsafe {
        RegisterHotKey(
            std::ptr::null_mut(),
            HOTKEY_ID,
            shortcut.modifiers,
            shortcut.key,
        ) != 0
    }
}

fn capture_intent(
    source: CaptureSource,
    hook_available: bool,
    find_window: impl FnOnce() -> Result<WindowTarget, String>,
) -> Result<CaptureIntent, String> {
    match source {
        CaptureSource::Window if !hook_available => {
            Err("Window focus tracking is unavailable.".to_string())
        }
        CaptureSource::Window => find_window().map(CaptureIntent::Window),
        CaptureSource::FullScreen => Ok(CaptureIntent::FullScreen),
    }
}

fn dispatch_capture(
    app: &tauri::AppHandle,
    source: CaptureSource,
    hook_available: bool,
) -> Result<(), String> {
    let intent = capture_intent(source, hook_available, select_capture_target)?;
    let runtime = app.state::<AgentRuntime>();
    let (request_id, reservation) = runtime.begin_capture()?;
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let runtime = handle.state::<AgentRuntime>();
        if let Err(reason) = runtime
            .capture_hotkey(request_id, reservation, move || match intent {
                CaptureIntent::Window(window) => capture_foreground(window),
                CaptureIntent::FullScreen => capture_full_screen(),
            })
            .await
        {
            runtime.capture_error_for(request_id, &reason);
        }
    });
    Ok(())
}

fn run_hotkeys(
    app: tauri::AppHandle,
    changes: Receiver<HotkeyChange>,
    ready: SyncSender<u32>,
    armed: Arc<AtomicBool>,
) {
    let mut message: MSG = unsafe { std::mem::zeroed() };
    unsafe { PeekMessageW(&mut message, std::ptr::null_mut(), 0, 0, PM_NOREMOVE) };
    let _ = ready.send(unsafe { GetCurrentThreadId() });
    // Do not register a default that may differ from the user's saved shortcut.
    // The React agent owner restores the chosen shortcut on startup.
    let mut registered: Option<Shortcut> = None;
    let mut source = CaptureSource::Window;
    let hook = unsafe {
        SetWinEventHook(
            EVENT_SYSTEM_FOREGROUND,
            EVENT_SYSTEM_FOREGROUND,
            std::ptr::null_mut(),
            Some(on_foreground),
            0,
            0,
            WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
        )
    };
    if hook.is_null() {
        app.state::<AgentRuntime>().capture_error(
            "Windows focus tracking is unavailable. Window capture cannot be started.",
        );
    }
    let initial = unsafe { GetForegroundWindow() };
    if let Some(target) = WindowTarget::pin(initial)
        && let Ok(mut last) = LAST_EXTERNAL_WINDOW.lock()
    {
        *last = Some(target);
    }
    loop {
        if unsafe { GetMessageW(&mut message, std::ptr::null_mut(), 0, 0) } <= 0 {
            break;
        }
        if message.message == WM_HOTKEY_CONFIG {
            while let Ok(change) = changes.try_recv() {
                match change {
                    HotkeyChange::Trigger(reply) => {
                        let result = dispatch_capture(&app, source, !hook.is_null());
                        let _ = reply.send(result);
                    }
                    HotkeyChange::Source(requested, reply) => {
                        source = requested;
                        let _ = reply.send(Ok(()));
                    }
                    HotkeyChange::Shortcut(requested, reply) => {
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
                                "Shortcut unavailable. The previous shortcut was kept when possible.".into(),
                            ));
                            if restored.is_none() {
                                app.state::<AgentRuntime>().capture_error(
                                    "Capture shortcut is unavailable. Choose another in Agent settings.",
                                );
                            }
                        }
                    }
                }
            }
        }
        if message.message == WM_HOTKEY
            && message.wParam == HOTKEY_ID as usize
            && armed.load(Ordering::SeqCst)
            && let Err(reason) = dispatch_capture(&app, source, !hook.is_null())
        {
            app.state::<AgentRuntime>().capture_error(&reason);
        }
    }
    if registered.is_some() {
        unsafe { UnregisterHotKey(std::ptr::null_mut(), HOTKEY_ID) };
    }
    if !hook.is_null() {
        unsafe { UnhookWinEvent(hook) };
    }
}

pub fn start_hotkey(app: tauri::AppHandle) -> CaptureHotkeys {
    std::thread::spawn(|| {
        cleanup_orphan_captures(&std::env::temp_dir(), SystemTime::now(), process_is_active);
    });
    let (changes, receiver) = mpsc::channel();
    let (ready, thread_id) = mpsc::sync_channel(1);
    let armed = Arc::new(AtomicBool::new(false));
    let hotkey_gate = Arc::clone(&armed);
    std::thread::spawn(move || run_hotkeys(app, receiver, ready, hotkey_gate));
    CaptureHotkeys {
        changes,
        thread_id: thread_id.recv_timeout(Duration::from_secs(2)).unwrap_or(0),
        armed,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cleanup_removes_only_old_captures_from_confirmed_exited_processes() {
        let now = SystemTime::now();
        let nonce = now
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory =
            std::env::temp_dir().join(format!("otto-cleanup-test-{}-{nonce}", std::process::id()));
        fs::create_dir(&directory).unwrap();
        let old = now - Duration::from_secs(48 * 60 * 60);
        let dead_pid = u32::MAX - 1;
        let active_pid = u32::MAX - 2;
        let dead_file = directory.join(format!("{CAPTURE_FILE_PREFIX}{dead_pid}-{nonce}.png"));
        let active_file = directory.join(format!("{CAPTURE_FILE_PREFIX}{active_pid}-{nonce}.png"));
        let recent_file = directory.join(format!(
            "{CAPTURE_FILE_PREFIX}{dead_pid}-1234567890123456.png"
        ));
        let unrelated_file = directory.join(format!("user-{dead_pid}-{nonce}.png"));
        let invalid_file = directory.join(format!("{CAPTURE_FILE_PREFIX}{dead_pid}-invalid.png"));

        for path in [
            &dead_file,
            &active_file,
            &recent_file,
            &unrelated_file,
            &invalid_file,
        ] {
            let file = fs::File::create(path).unwrap();
            if path != &recent_file {
                file.set_times(fs::FileTimes::new().set_modified(old))
                    .unwrap();
            }
        }

        let count = cleanup_orphan_captures(&directory, now, |pid| pid == active_pid);
        assert_eq!(count, 1);
        assert!(!dead_file.exists());
        assert!(active_file.exists());
        assert!(recent_file.exists());
        assert!(unrelated_file.exists());
        assert!(invalid_file.exists());
        assert_eq!(
            cleanup_orphan_captures(&directory, now, |pid| pid == active_pid),
            0
        );
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn capture_cleanup_rejects_unowned_or_ambiguous_names() {
        assert_eq!(
            capture_file_owner("otto-capture-42-1234567890123456.png"),
            Some(42)
        );
        for name in [
            "otto-42-1234567890123456.png",
            "otto-capture-0-1234567890123456.png",
            "otto-capture-42-invalid.png",
            "otto-capture-42-1234567890123456.txt",
            "otto-capture-42-1234567890123456.png.bak",
            "otto-capture-42-1234567890123456/../../secret.png",
        ] {
            assert_eq!(capture_file_owner(name), None, "accepted {name}");
        }
    }

    #[test]
    fn capture_target_preflight_rejects_invalid_window_without_scheduling_work() {
        let unavailable = capture_intent(CaptureSource::Window, true, || {
            Err("Window target changed. Refocus the app and retry.".into())
        });
        assert!(
            unavailable
                .err()
                .expect("invalid target must fail")
                .contains("Window target changed")
        );

        let no_hook = capture_intent(CaptureSource::Window, false, || {
            panic!("No window lookup is allowed when foreground tracking is unavailable")
        });
        assert_eq!(
            no_hook.err().expect("missing hook must fail"),
            "Window focus tracking is unavailable."
        );

        let target = WindowTarget {
            handle: 17,
            pid: 31,
        };
        let selected = capture_intent(CaptureSource::Window, true, || Ok(target)).unwrap();
        assert!(matches!(selected, CaptureIntent::Window(actual) if actual == target));

        let full_screen = capture_intent(CaptureSource::FullScreen, false, || {
            panic!("Full-screen capture must not require a window target or foreground hook")
        });
        assert!(matches!(full_screen, Ok(CaptureIntent::FullScreen)));
    }

    #[test]
    fn source_configuration_failure_disarms_capture_hotkey() {
        let (changes, _messages) = mpsc::channel();
        let gate = Arc::new(AtomicBool::new(true));
        let hotkeys = CaptureHotkeys {
            changes,
            thread_id: 0,
            armed: Arc::clone(&gate),
        };
        assert!(hotkeys.configure_source("fullScreen").is_err());
        assert!(!gate.load(Ordering::SeqCst));
    }

    #[test]
    fn unsupported_capture_source_never_selects_a_default() {
        assert_eq!(
            CaptureSource::parse("window").unwrap(),
            CaptureSource::Window
        );
        assert_eq!(
            CaptureSource::parse("fullScreen").unwrap(),
            CaptureSource::FullScreen
        );
        assert!(CaptureSource::parse("screen").is_err());
        assert!(CaptureSource::parse("").is_err());
    }

    #[test]
    fn unknown_foreground_never_falls_back_to_an_unrelated_window() {
        let last = WindowTarget {
            handle: 10,
            pid: 20,
        };
        let current = WindowTarget {
            handle: 30,
            pid: 40,
        };
        assert_eq!(
            choose_capture_target(0, 99, Some(current), Some(last)),
            None
        );
        assert_eq!(choose_capture_target(99, 99, None, Some(last)), Some(last));
        assert_eq!(
            choose_capture_target(40, 99, Some(current), Some(last)),
            Some(current)
        );
        assert_eq!(choose_capture_target(40, 99, None, Some(last)), None);
    }

    #[test]
    fn captured_window_identity_must_not_change_process() {
        let pinned = WindowTarget {
            handle: 12,
            pid: 42,
        };
        assert!(pinned.matches(12, 42));
        assert!(!pinned.matches(12, 43));
        assert!(!pinned.matches(13, 42));
        assert!(!pinned.matches(12, 0));
    }

    #[test]
    fn shortcuts_require_explicit_safe_modifiers_and_single_letter() {
        assert_eq!(parse_shortcut("Ctrl+Shift+O").unwrap().key, b'O' as u32);
        assert_eq!(
            parse_shortcut("ctrl+ALT+p").unwrap().modifiers,
            MOD_CONTROL | windows_sys::Win32::UI::Input::KeyboardAndMouse::MOD_ALT | MOD_NOREPEAT
        );
        for invalid in [
            "O",
            "Alt+O",
            "Ctrl+O",
            "Ctrl+Shift+1",
            "Ctrl+Ctrl+O",
            "Ctrl+Win+O",
            "",
        ] {
            assert!(parse_shortcut(invalid).is_err(), "accepted {invalid}");
        }
    }
}
