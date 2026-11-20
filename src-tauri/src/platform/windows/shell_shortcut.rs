use std::sync::{Mutex, mpsc};
use std::time::Duration;
use tauri::Emitter;
use windows_sys::Win32::System::Threading::GetCurrentThreadId;
use windows_sys::Win32::UI::{
    Input::KeyboardAndMouse::{
        MOD_ALT, MOD_CONTROL, MOD_NOREPEAT, MOD_SHIFT, MOD_WIN, RegisterHotKey, UnregisterHotKey,
    },
    WindowsAndMessaging::{
        GetMessageW, MSG, PM_NOREMOVE, PeekMessageW, PostThreadMessageW, WM_APP, WM_HOTKEY, WM_QUIT,
    },
};

const ID: i32 = 0x4f55;
const CONFIGURE: u32 = WM_APP + 51;
type Change = (String, mpsc::SyncSender<(Result<(), String>, String)>);

pub struct ShellShortcut {
    changes: mpsc::Sender<Change>,
    thread: u32,
    current: Mutex<String>,
}

fn parse(value: &str) -> Result<(u32, u32), String> {
    let mut modifiers = MOD_NOREPEAT;
    let mut key = None;
    for part in value.split('+').map(str::trim) {
        match part.to_ascii_lowercase().as_str() {
            "ctrl" => modifiers |= MOD_CONTROL,
            "alt" => modifiers |= MOD_ALT,
            "shift" => modifiers |= MOD_SHIFT,
            "win" => modifiers |= MOD_WIN,
            _ if part.len() == 1 && part.as_bytes()[0].is_ascii_alphanumeric() && key.is_none() => {
                key = Some(u32::from(part.as_bytes()[0].to_ascii_uppercase()));
            }
            _ => {
                return Err(
                    "Use modifiers and one letter or digit, for example Ctrl+Alt+O.".into(),
                );
            }
        }
    }
    if modifiers == MOD_NOREPEAT {
        return Err("Include Ctrl, Alt, Shift or Win.".into());
    }
    Ok((modifiers, key.ok_or("Choose a letter or digit.")?))
}

fn register(value: &str) -> bool {
    parse(value).is_ok_and(|(modifiers, key)| unsafe {
        RegisterHotKey(std::ptr::null_mut(), ID, modifiers, key) != 0
    })
}

impl ShellShortcut {
    pub fn configure(&self, value: String) -> Result<(), String> {
        parse(&value)?;
        let mut current = self
            .current
            .lock()
            .map_err(|_| "Shortcut configuration is unavailable.")?;
        let (reply, result) = mpsc::sync_channel(1);
        self.changes
            .send((value, reply))
            .map_err(|_| "Shortcut service is unavailable.")?;
        if unsafe { PostThreadMessageW(self.thread, CONFIGURE, 0, 0) } == 0 {
            return Err("Shortcut service is unavailable.".into());
        }
        let (outcome, observed) = result
            .recv_timeout(Duration::from_secs(3))
            .map_err(|_| "Shortcut configuration timed out.")?;
        *current = observed;
        outcome
    }

    pub fn current(&self) -> String {
        self.current
            .lock()
            .map(|value| value.clone())
            .unwrap_or_default()
    }
}

impl Drop for ShellShortcut {
    fn drop(&mut self) {
        unsafe {
            PostThreadMessageW(self.thread, WM_QUIT, 0, 0);
        }
    }
}

pub fn start(app: tauri::AppHandle) -> Result<ShellShortcut, String> {
    let (changes, receiver) = mpsc::channel::<Change>();
    let (ready, result) = mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let mut message: MSG = unsafe { std::mem::zeroed() };
        unsafe {
            PeekMessageW(&mut message, std::ptr::null_mut(), 0, 0, PM_NOREMOVE);
        }
        let mut current = if register("Ctrl+Alt+O") {
            "Ctrl+Alt+O".to_string()
        } else {
            String::new()
        };
        let _ = ready.send((unsafe { GetCurrentThreadId() }, current.clone()));
        while unsafe { GetMessageW(&mut message, std::ptr::null_mut(), 0, 0) } > 0 {
            if message.message == WM_HOTKEY && message.wParam == ID as usize {
                let _ = app.emit("otto-toggle-expanded", ());
            }
            if message.message == CONFIGURE {
                while let Ok((value, reply)) = receiver.try_recv() {
                    let outcome = if current == value || register_replacement(&mut current, value) {
                        Ok(())
                    } else {
                        Err("Shortcut unavailable. Choose another combination.".into())
                    };
                    let _ = reply.send((outcome, current.clone()));
                }
            }
        }
        unsafe {
            UnregisterHotKey(std::ptr::null_mut(), ID);
        }
    });
    let (thread, current) = result
        .recv_timeout(Duration::from_secs(3))
        .map_err(|_| "Shell shortcut did not start.")?;
    Ok(ShellShortcut {
        changes,
        thread,
        current: Mutex::new(current),
    })
}

fn register_replacement(current: &mut String, value: String) -> bool {
    unsafe {
        UnregisterHotKey(std::ptr::null_mut(), ID);
    }
    if register(&value) {
        *current = value;
        return true;
    }
    if !current.is_empty() && !register(current) {
        current.clear();
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_shortcuts_require_modified_single_keys() {
        assert_eq!(
            parse("Ctrl+Alt+O"),
            Ok((MOD_CONTROL | MOD_ALT | MOD_NOREPEAT, u32::from(b'O')))
        );
        for value in ["O", "Ctrl+", "Ctrl+O+P", "Ctrl+F12"] {
            assert!(parse(value).is_err());
        }
    }
}
