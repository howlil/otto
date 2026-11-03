use super::{Observer, sleep_while, spawn};
use crate::os_events::{EventSink, Observation};
use std::{
    sync::{Arc, atomic::AtomicBool, atomic::Ordering},
    time::Duration,
};
use windows::{
    Win32::{
        Devices::Display::{
            DestroyPhysicalMonitors, GetMonitorBrightness, GetNumberOfPhysicalMonitorsFromHMONITOR,
            GetPhysicalMonitorsFromHMONITOR, PHYSICAL_MONITOR,
        },
        Foundation::POINT,
        Graphics::Gdi::{MONITOR_DEFAULTTOPRIMARY, MonitorFromPoint},
        System::{
            Com::{
                CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx,
                CoInitializeSecurity, CoSetProxyBlanket, CoUninitialize, EOAC_NONE,
                RPC_C_AUTHN_LEVEL_CALL, RPC_C_AUTHN_LEVEL_DEFAULT, RPC_C_IMP_LEVEL_IMPERSONATE,
            },
            Rpc::{RPC_C_AUTHN_WINNT, RPC_C_AUTHZ_NONE},
            Variant::{VARIANT, VT_I4, VT_UI1, VariantClear},
            Wmi::{
                IEnumWbemClassObject, IWbemClassObject, IWbemLocator, IWbemServices,
                WBEM_FLAG_FORWARD_ONLY, WBEM_FLAG_RETURN_IMMEDIATELY, WBEM_INFINITE,
            },
        },
    },
    core::{BSTR, GUID, w},
};

const POLL_INTERVAL: Duration = Duration::from_secs(2);
const CLSID_WBEM_LOCATOR: GUID = GUID::from_u128(0x4590f811_1d3a_11d0_891f_00aa004b2e24);

struct WmiBrightness {
    services: IWbemServices,
}

impl WmiBrightness {
    unsafe fn connect() -> Option<Self> {
        unsafe {
            let locator: IWbemLocator =
                CoCreateInstance(&CLSID_WBEM_LOCATOR, None, CLSCTX_INPROC_SERVER).ok()?;
            let _ = CoInitializeSecurity(
                None,
                -1,
                None,
                None,
                RPC_C_AUTHN_LEVEL_DEFAULT,
                RPC_C_IMP_LEVEL_IMPERSONATE,
                None,
                EOAC_NONE,
                None,
            );
            let services = locator
                .ConnectServer(
                    &BSTR::from("ROOT\\WMI"),
                    &BSTR::new(),
                    &BSTR::new(),
                    &BSTR::new(),
                    0,
                    &BSTR::new(),
                    None,
                )
                .ok()?;
            CoSetProxyBlanket(
                &services,
                RPC_C_AUTHN_WINNT,
                RPC_C_AUTHZ_NONE,
                None,
                RPC_C_AUTHN_LEVEL_CALL,
                RPC_C_IMP_LEVEL_IMPERSONATE,
                None,
                EOAC_NONE,
            )
            .ok()?;
            Some(Self { services })
        }
    }

    unsafe fn read(&self) -> Option<u8> {
        unsafe {
            let flags = windows::Win32::System::Wmi::WBEM_GENERIC_FLAG_TYPE(
                WBEM_FLAG_FORWARD_ONLY.0 | WBEM_FLAG_RETURN_IMMEDIATELY.0,
            );
            let enumerator: IEnumWbemClassObject = self
                .services
                .ExecQuery(
                    &BSTR::from("WQL"),
                    &BSTR::from("SELECT CurrentBrightness FROM WmiMonitorBrightness"),
                    flags,
                    None,
                )
                .ok()?;
            read_first(&enumerator)
        }
    }
}

unsafe fn read_first(enumerator: &IEnumWbemClassObject) -> Option<u8> {
    unsafe {
        let mut objects = [None::<IWbemClassObject>];
        let mut returned = 0u32;
        let status = enumerator.Next(WBEM_INFINITE, &mut objects, &mut returned);
        if status.is_err() || returned == 0 {
            return None;
        }
        let object = objects[0].take()?;
        let mut value = VARIANT::default();
        object
            .Get(w!("CurrentBrightness"), 0, &mut value, None, None)
            .ok()?;
        let brightness = read_variant(&value);
        let _ = VariantClear(&mut value);
        brightness
    }
}

unsafe fn read_variant(value: &VARIANT) -> Option<u8> {
    unsafe {
        let inner = &value.Anonymous.Anonymous;
        match inner.vt {
            VT_UI1 => Some(inner.Anonymous.bVal),
            VT_I4 => u8::try_from(inner.Anonymous.lVal).ok(),
            _ => None,
        }
    }
}

pub fn start(sink: Arc<dyn EventSink>) -> Option<Box<dyn Observer>> {
    spawn("otto-os-brightness", sink, run)
}

fn run(sink: Arc<dyn EventSink>, stop: &AtomicBool) {
    let initialized = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED).is_ok() };
    let wmi = if initialized {
        unsafe { WmiBrightness::connect() }
    } else {
        None
    };
    let read = || {
        wmi.as_ref()
            .and_then(|reader| unsafe { reader.read() })
            .or_else(read_brightness)
    };
    let Some(mut last) = read() else {
        if initialized {
            unsafe { CoUninitialize() };
        }
        return;
    };
    while !stop.load(Ordering::SeqCst) {
        sleep_while(stop, POLL_INTERVAL);
        if stop.load(Ordering::SeqCst) {
            break;
        }
        let Some(current) = read() else {
            continue;
        };
        if current != last {
            last = current;
            sink.observe(Observation::Brightness { percent: current });
        }
    }
    drop(wmi);
    if initialized {
        unsafe { CoUninitialize() };
    }
}

fn read_brightness() -> Option<u8> {
    unsafe {
        let monitor = MonitorFromPoint(POINT { x: 0, y: 0 }, MONITOR_DEFAULTTOPRIMARY);
        if monitor.is_invalid() {
            return None;
        }
        let mut count = 0u32;
        GetNumberOfPhysicalMonitorsFromHMONITOR(monitor, &mut count).ok()?;
        if count == 0 {
            return None;
        }
        let mut monitors = vec![PHYSICAL_MONITOR::default(); count as usize];
        GetPhysicalMonitorsFromHMONITOR(monitor, &mut monitors).ok()?;
        let mut percent = None;
        for physical in &monitors {
            let (mut minimum, mut current, mut maximum) = (0u32, 0u32, 0u32);
            if GetMonitorBrightness(
                physical.hPhysicalMonitor,
                &mut minimum,
                &mut current,
                &mut maximum,
            ) != 0
                && maximum > minimum
            {
                percent =
                    Some((((current - minimum) as u64 * 100) / (maximum - minimum) as u64) as u8);
                break;
            }
        }
        let _ = DestroyPhysicalMonitors(&monitors);
        percent
    }
}
