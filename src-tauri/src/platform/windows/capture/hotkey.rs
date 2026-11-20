use super::{
    image::{capture_foreground, capture_full_screen, capture_scrolling, cleanup_startup_captures},
    region::capture_region,
    selection::capture_selected_text,
    target::{LAST_EXTERNAL_WINDOW, WindowTarget, on_foreground, select_capture_target},
};
use crate::ipc::agent_capture;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
    mpsc::{self, Receiver, Sender, SyncSender},
};
use std::time::Duration;
use windows_sys::Win32::{
    System::Threading::GetCurrentThreadId,
    UI::{
        Accessibility::{SetWinEventHook, UnhookWinEvent},
        Input::KeyboardAndMouse::{
            MOD_CONTROL, MOD_NOREPEAT, MOD_SHIFT, RegisterHotKey, UnregisterHotKey,
        },
        WindowsAndMessaging::{
            EVENT_SYSTEM_FOREGROUND, GetForegroundWindow, GetMessageW, MSG, PM_NOREMOVE,
            PeekMessageW, PostThreadMessageW, WINEVENT_OUTOFCONTEXT, WINEVENT_SKIPOWNPROCESS,
            WM_APP, WM_HOTKEY,
        },
    },
};

const HOTKEY_ID: i32 = 0x4f54;
const TEXT_HOTKEY_ID: i32 = 0x4f55;
const WM_HOTKEY_CONFIG: u32 = WM_APP + 19;
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct Shortcut {
    pub(super) modifiers: u32,
    pub(super) key: u32,
}

pub(super) fn parse_shortcut(value: &str) -> Result<Shortcut, String> {
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
pub(super) enum CaptureSource {
    SelectedText,
    Region,
    Window,
    ScrollingWindow,
    FullScreen,
}

impl CaptureSource {
    pub(super) fn parse(value: &str) -> Result<Self, String> {
        match value {
            "selectedText" => Ok(Self::SelectedText),
            "region" => Ok(Self::Region),
            "window" => Ok(Self::Window),
            "scrollingWindow" => Ok(Self::ScrollingWindow),
            "fullScreen" => Ok(Self::FullScreen),
            _ => Err("Unknown capture source.".into()),
        }
    }
}

type HotkeyReply = SyncSender<Result<(), String>>;

pub(super) enum HotkeyChange {
    Shortcut(Shortcut, HotkeyReply),
    TextShortcut(Shortcut, HotkeyReply),
    Source(CaptureSource, HotkeyReply),
    Trigger(HotkeyReply),
    TriggerSource(CaptureSource, HotkeyReply),
}

pub(super) enum CaptureIntent {
    SelectedText,
    Region,
    Window(WindowTarget),
    ScrollingWindow(WindowTarget),
    FullScreen,
}

pub struct CaptureHotkeys {
    pub(super) changes: Sender<HotkeyChange>,
    pub(super) thread_id: u32,
    pub(super) armed: Arc<AtomicBool>,
}

impl CaptureHotkeys {
    pub fn trigger(&self) -> Result<(), String> {
        self.request(HotkeyChange::Trigger)
    }

    pub fn trigger_source(&self, value: &str) -> Result<(), String> {
        let requested = CaptureSource::parse(value)?;
        self.request(|reply| HotkeyChange::TriggerSource(requested, reply))
    }

    pub fn configure(&self, value: &str) -> Result<(), String> {
        let requested = parse_shortcut(value)?;
        self.request(|reply| HotkeyChange::Shortcut(requested, reply))?;
        self.armed.store(true, Ordering::SeqCst);
        Ok(())
    }

    pub fn configure_text_shortcut(&self, value: &str) -> Result<(), String> {
        let requested = parse_shortcut(value)?;
        self.request(|reply| HotkeyChange::TextShortcut(requested, reply))?;
        self.armed.store(true, Ordering::SeqCst);
        Ok(())
    }

    pub fn configure_source(&self, value: &str) -> Result<(), String> {
        let requested = CaptureSource::parse(value)?;
        self.request(|reply| HotkeyChange::Source(requested, reply))
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

fn register(hotkey_id: i32, shortcut: Shortcut) -> bool {
    unsafe {
        RegisterHotKey(
            std::ptr::null_mut(),
            hotkey_id,
            shortcut.modifiers,
            shortcut.key,
        ) != 0
    }
}

pub(super) fn update_hotkey_slot(
    hotkey_id: i32,
    slot: &mut Option<Shortcut>,
    other: Option<Shortcut>,
    requested: Shortcut,
) -> Result<(), String> {
    if other == Some(requested) {
        return Err("Selected text and visual capture shortcuts must use different keys.".into());
    }
    if *slot == Some(requested) {
        return Ok(());
    }
    if slot.is_some() {
        unsafe { UnregisterHotKey(std::ptr::null_mut(), hotkey_id) };
    }
    if register(hotkey_id, requested) {
        *slot = Some(requested);
        return Ok(());
    }
    let restored = slot.filter(|old| register(hotkey_id, *old));
    *slot = restored;
    Err("Shortcut unavailable. The previous shortcut was kept when possible.".into())
}

pub(super) fn capture_intent(
    source: CaptureSource,
    hook_available: bool,
    find_window: impl FnOnce() -> Result<WindowTarget, String>,
) -> Result<CaptureIntent, String> {
    match source {
        CaptureSource::SelectedText => Ok(CaptureIntent::SelectedText),
        CaptureSource::Region => Ok(CaptureIntent::Region),
        CaptureSource::Window | CaptureSource::ScrollingWindow if !hook_available => {
            Err("Window focus tracking is unavailable.".to_string())
        }
        CaptureSource::Window => find_window().map(CaptureIntent::Window),
        CaptureSource::ScrollingWindow => find_window().map(CaptureIntent::ScrollingWindow),
        CaptureSource::FullScreen => Ok(CaptureIntent::FullScreen),
    }
}

fn dispatch_capture(
    app: &tauri::AppHandle,
    source: CaptureSource,
    hook_available: bool,
) -> Result<(), String> {
    let intent = capture_intent(source, hook_available, select_capture_target)?;
    match intent {
        CaptureIntent::SelectedText => agent_capture::dispatch_text(app, capture_selected_text),
        CaptureIntent::Region => agent_capture::dispatch_region_image(app, capture_region),
        CaptureIntent::Window(window) => {
            agent_capture::dispatch_image(app, move || capture_foreground(window))
        }
        CaptureIntent::ScrollingWindow(window) => {
            agent_capture::dispatch_scrolling_image(app, move || capture_scrolling(window))
        }
        CaptureIntent::FullScreen => {
            agent_capture::dispatch_fullscreen_image(app, capture_full_screen)
        }
    }
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
    let mut registered: Option<Shortcut> = None;
    let mut registered_text: Option<Shortcut> = None;
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
        agent_capture::report_error(
            &app,
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
                    HotkeyChange::TriggerSource(requested, reply) => {
                        let result = dispatch_capture(&app, requested, !hook.is_null());
                        let _ = reply.send(result);
                    }
                    HotkeyChange::Source(requested, reply) => {
                        source = requested;
                        let _ = reply.send(Ok(()));
                    }
                    HotkeyChange::Shortcut(requested, reply) => {
                        let result = update_hotkey_slot(
                            HOTKEY_ID,
                            &mut registered,
                            registered_text,
                            requested,
                        );
                        if result.is_err() && registered.is_none() {
                            agent_capture::report_error(
                                &app,
                                "Capture shortcut is unavailable. Choose another in Agent settings.",
                            );
                        }
                        let _ = reply.send(result);
                    }
                    HotkeyChange::TextShortcut(requested, reply) => {
                        let result = update_hotkey_slot(
                            TEXT_HOTKEY_ID,
                            &mut registered_text,
                            registered,
                            requested,
                        );
                        let _ = reply.send(result);
                    }
                }
            }
        }
        if message.message == WM_HOTKEY && armed.load(Ordering::SeqCst) {
            let active_source = if message.wParam == HOTKEY_ID as usize {
                Some(source)
            } else if message.wParam == TEXT_HOTKEY_ID as usize {
                Some(CaptureSource::SelectedText)
            } else {
                None
            };
            if let Some(active_source) = active_source
                && let Err(reason) = dispatch_capture(&app, active_source, !hook.is_null())
            {
                agent_capture::report_error(&app, &reason);
            }
        }
    }
    if registered.is_some() {
        unsafe { UnregisterHotKey(std::ptr::null_mut(), HOTKEY_ID) };
    }
    if registered_text.is_some() {
        unsafe { UnregisterHotKey(std::ptr::null_mut(), TEXT_HOTKEY_ID) };
    }
    if !hook.is_null() {
        unsafe { UnhookWinEvent(hook) };
    }
}

pub fn start_hotkey(app: tauri::AppHandle) -> CaptureHotkeys {
    std::thread::spawn(|| {
        cleanup_startup_captures();
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
