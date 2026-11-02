use super::{Observer, ThreadObserver};
use crate::os_events::{EventSink, Observation};
use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU32, Ordering},
    },
    thread,
};
use windows::{
    Win32::{
        Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, WPARAM},
        System::{
            LibraryLoader::GetModuleHandleW,
            Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS},
            Threading::GetCurrentThreadId,
        },
        UI::WindowsAndMessaging::{
            CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GWLP_USERDATA,
            GetMessageW, GetWindowLongPtrW, KillTimer, MSG, PBT_APMPOWERSTATUSCHANGE,
            RegisterClassW, SetTimer, SetWindowLongPtrW, TranslateMessage, WM_NCDESTROY,
            WM_POWERBROADCAST, WM_TIMER, WNDCLASSW, WS_EX_TOOLWINDOW, WS_POPUP,
        },
    },
    core::PCWSTR,
};

const RECONCILE_INTERVAL_MS: u32 = 60_000;

pub fn start(sink: Arc<dyn EventSink>) -> Option<Box<dyn Observer>> {
    let stop = Arc::new(AtomicBool::new(false));
    let thread_id = Arc::new(AtomicU32::new(0));
    let stop_thread = stop.clone();
    let id_thread = thread_id.clone();
    let handle = thread::Builder::new()
        .name("otto-os-power".to_string())
        .spawn(move || run(sink, &stop_thread, &id_thread))
        .ok()?;
    Some(Box::new(
        ThreadObserver::new(stop, handle).with_thread_id(thread_id),
    ))
}

fn run(sink: Arc<dyn EventSink>, stop: &AtomicBool, thread_id: &AtomicU32) {
    unsafe {
        thread_id.store(GetCurrentThreadId(), Ordering::SeqCst);
        let Some(window) = create_window(&sink) else {
            return;
        };
        let timer = SetTimer(Some(window), 1, RECONCILE_INTERVAL_MS, None);
        while !stop.load(Ordering::SeqCst) {
            let mut message = MSG::default();
            if GetMessageW(&mut message, None, 0, 0).0 <= 0 {
                break;
            }
            let _ = TranslateMessage(&message);
            DispatchMessageW(&message);
        }
        if timer != 0 {
            let _ = KillTimer(Some(window), timer);
        }
        let _ = DestroyWindow(window);
    }
}

unsafe fn create_window(sink: &Arc<dyn EventSink>) -> Option<HWND> {
    unsafe {
        let class_name = windows::core::HSTRING::from("OttoOsPower");
        let instance = GetModuleHandleW(None).unwrap_or_default();
        let class = WNDCLASSW {
            lpfnWndProc: Some(window_proc),
            hInstance: HINSTANCE(instance.0),
            lpszClassName: PCWSTR(class_name.as_ptr()),
            ..Default::default()
        };
        let _ = RegisterClassW(&class);
        let window = CreateWindowExW(
            WS_EX_TOOLWINDOW,
            PCWSTR(class_name.as_ptr()),
            PCWSTR::null(),
            WS_POPUP,
            0,
            0,
            0,
            0,
            None,
            None,
            Some(HINSTANCE(instance.0)),
            None,
        )
        .ok()?;
        let context = Box::into_raw(Box::new(sink.clone()));
        SetWindowLongPtrW(window, GWLP_USERDATA, context as isize);
        publish(window);
        Some(window)
    }
}

unsafe fn publish(window: HWND) {
    unsafe {
        let context = GetWindowLongPtrW(window, GWLP_USERDATA) as *const Arc<dyn EventSink>;
        if context.is_null() {
            return;
        }
        if let Some(observation) = read_power() {
            (*context).observe(observation);
        }
    }
}

unsafe extern "system" fn window_proc(
    window: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    unsafe {
        match message {
            WM_POWERBROADCAST if wparam == WPARAM(PBT_APMPOWERSTATUSCHANGE as usize) => {
                publish(window)
            }
            WM_TIMER => publish(window),
            WM_NCDESTROY => {
                let context = GetWindowLongPtrW(window, GWLP_USERDATA) as *mut Arc<dyn EventSink>;
                if !context.is_null() {
                    SetWindowLongPtrW(window, GWLP_USERDATA, 0);
                    drop(Box::from_raw(context));
                }
            }
            _ => {}
        }
        DefWindowProcW(window, message, wparam, lparam)
    }
}

fn read_power() -> Option<Observation> {
    let mut status = SYSTEM_POWER_STATUS::default();
    unsafe {
        GetSystemPowerStatus(&mut status).ok()?;
    }
    if status.BatteryFlag & 0x80 != 0 {
        return None;
    }
    let plugged = status.ACLineStatus == 1;
    let charging = plugged && status.BatteryFlag & 0x08 != 0;
    let percent = (status.BatteryLifePercent != u8::MAX).then_some(status.BatteryLifePercent);
    Some(Observation::Power {
        plugged,
        charging,
        percent,
    })
}
