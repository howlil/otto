use super::target::{select_capture_target, window_pid};
use std::{mem::size_of, thread, time::Duration};
use windows_sys::Win32::{
    Foundation::HWND,
    UI::{
        Input::KeyboardAndMouse::{
            INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, KEYEVENTF_UNICODE,
            SendInput, VK_RETURN,
        },
        WindowsAndMessaging::{GetForegroundWindow, SetForegroundWindow},
    },
};

const MAX_INSERT_UTF16_UNITS: usize = 32_000;
const FOCUS_SETTLE_DELAY: Duration = Duration::from_millis(80);

pub(crate) fn insert_text_at_caret(value: &str) -> Result<(), String> {
    let inputs = unicode_inputs(value)?;
    let target = select_capture_target()?;
    let hwnd = target.handle as HWND;
    if unsafe { SetForegroundWindow(hwnd) } == 0 {
        return Err("Windows could not focus the destination app. Focus it and retry.".into());
    }
    thread::sleep(FOCUS_SETTLE_DELAY);
    if unsafe { GetForegroundWindow() } != hwnd || !target.matches(hwnd as isize, window_pid(hwnd))
    {
        return Err("The destination app changed before insertion. Focus it and retry.".into());
    }
    let sent = unsafe {
        SendInput(
            inputs.len() as u32,
            inputs.as_ptr(),
            size_of::<INPUT>() as i32,
        )
    };
    if sent != inputs.len() as u32 {
        return Err(
            "Windows could not send the complete answer. Focus an editable field and retry.".into(),
        );
    }
    Ok(())
}

pub(super) fn unicode_inputs(value: &str) -> Result<Vec<INPUT>, String> {
    let units: Vec<u16> = value.encode_utf16().collect();
    if units.is_empty() {
        return Err("There is no answer to insert.".into());
    }
    if units.len() > MAX_INSERT_UTF16_UNITS {
        return Err("The answer is too long to insert safely. Copy it instead.".into());
    }
    let mut inputs = Vec::with_capacity(units.len() * 2);
    let mut units = units.into_iter().peekable();
    while let Some(unit) = units.next() {
        if unit == b'\r' as u16 {
            if units.peek() == Some(&(b'\n' as u16)) {
                units.next();
            }
            push_key_pair(&mut inputs, VK_RETURN, 0, 0);
        } else if unit == b'\n' as u16 {
            push_key_pair(&mut inputs, VK_RETURN, 0, 0);
        } else {
            push_key_pair(&mut inputs, 0, unit, KEYEVENTF_UNICODE);
        }
    }
    Ok(inputs)
}

fn push_key_pair(inputs: &mut Vec<INPUT>, virtual_key: u16, scan_code: u16, flags: u32) {
    inputs.push(keyboard_input(virtual_key, scan_code, flags));
    inputs.push(keyboard_input(
        virtual_key,
        scan_code,
        flags | KEYEVENTF_KEYUP,
    ));
}

fn keyboard_input(virtual_key: u16, scan_code: u16, flags: u32) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: virtual_key,
                wScan: scan_code,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}
