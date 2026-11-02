use super::{Observer, sleep_while, spawn};
use crate::os_events::{EventSink, Observation};
use std::{
    ffi::c_void,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
use windows::{
    Win32::{
        Foundation::HANDLE,
        NetworkManagement::WiFi::{
            L2_NOTIFICATION_DATA, WLAN_CONNECTION_ATTRIBUTES, WLAN_INTERFACE_INFO_LIST,
            WLAN_NOTIFICATION_SOURCE_ACM, WLAN_NOTIFICATION_SOURCE_NONE, WLAN_OPCODE_VALUE_TYPE,
            WlanCloseHandle, WlanEnumInterfaces, WlanFreeMemory, WlanOpenHandle,
            WlanQueryInterface, WlanRegisterNotification, wlan_intf_opcode_current_connection,
        },
    },
    core::GUID,
};

const IDLE_INTERVAL: Duration = Duration::from_millis(200);
const CLIENT_VERSION: u32 = 2;

struct WifiContext {
    sink: Arc<dyn EventSink>,
    handle: HANDLE,
    interfaces: Vec<GUID>,
    connected: AtomicBool,
}

pub fn start(sink: Arc<dyn EventSink>) -> Option<Box<dyn Observer>> {
    spawn("otto-os-wifi", sink, run)
}

fn run(sink: Arc<dyn EventSink>, stop: &AtomicBool) {
    unsafe {
        let mut negotiated = 0u32;
        let mut handle = HANDLE::default();
        if WlanOpenHandle(CLIENT_VERSION, None, &mut negotiated, &mut handle) != 0 {
            return;
        }
        let interfaces = interface_guids(handle);
        if interfaces.is_empty() {
            let _ = WlanCloseHandle(handle, None);
            return;
        }
        let context = WifiContext {
            sink,
            handle,
            connected: AtomicBool::new(is_connected(handle, &interfaces)),
            interfaces,
        };
        let registered = WlanRegisterNotification(
            handle,
            WLAN_NOTIFICATION_SOURCE_ACM,
            true,
            Some(notification),
            Some(&context as *const WifiContext as *const c_void),
            None,
            None,
        ) == 0;
        if registered {
            while !stop.load(Ordering::SeqCst) {
                sleep_while(stop, IDLE_INTERVAL);
            }
            let _ = WlanRegisterNotification(
                handle,
                WLAN_NOTIFICATION_SOURCE_NONE,
                true,
                None,
                None,
                None,
                None,
            );
        }
        let _ = WlanCloseHandle(handle, None);
    }
}

unsafe extern "system" fn notification(data: *mut L2_NOTIFICATION_DATA, context: *mut c_void) {
    unsafe {
        if data.is_null() || context.is_null() {
            return;
        }
        let data = &*data;
        if data.NotificationSource != WLAN_NOTIFICATION_SOURCE_ACM {
            return;
        }
        if !matches!(data.NotificationCode, 9 | 10 | 11 | 13 | 14 | 21) {
            return;
        }
        let context = &*(context as *const WifiContext);
        let connected = is_connected(context.handle, &context.interfaces);
        if context.connected.swap(connected, Ordering::SeqCst) != connected {
            context.sink.observe(Observation::Wifi { connected });
        }
    }
}

unsafe fn interface_guids(handle: HANDLE) -> Vec<GUID> {
    unsafe {
        let mut list: *mut WLAN_INTERFACE_INFO_LIST = std::ptr::null_mut();
        if WlanEnumInterfaces(handle, None, &mut list) != 0 || list.is_null() {
            return Vec::new();
        }
        let count = (*list).dwNumberOfItems as usize;
        let entries = std::ptr::slice_from_raw_parts((*list).InterfaceInfo.as_ptr(), count);
        let guids = (*entries).iter().map(|entry| entry.InterfaceGuid).collect();
        WlanFreeMemory(list as *const c_void);
        guids
    }
}

unsafe fn is_connected(handle: HANDLE, interfaces: &[GUID]) -> bool {
    unsafe {
        interfaces.iter().any(|interface| {
            let mut size = 0u32;
            let mut data: *mut c_void = std::ptr::null_mut();
            let mut value_type = WLAN_OPCODE_VALUE_TYPE::default();
            if WlanQueryInterface(
                handle,
                interface,
                wlan_intf_opcode_current_connection,
                None,
                &mut size,
                &mut data,
                Some(&mut value_type),
            ) != 0
                || data.is_null()
            {
                return false;
            }
            let connected = (*(data as *const WLAN_CONNECTION_ATTRIBUTES)).isState.0 == 1;
            WlanFreeMemory(data);
            connected
        })
    }
}
