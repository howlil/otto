use super::{Observer, sleep_while, spawn};
use crate::os_events::{EventSink, Observation};
use std::{
    sync::{Arc, atomic::AtomicBool, atomic::Ordering},
    time::Duration,
};
use windows::Win32::{
    Devices::Display::{
        DestroyPhysicalMonitors, GetMonitorBrightness, GetNumberOfPhysicalMonitorsFromHMONITOR,
        GetPhysicalMonitorsFromHMONITOR, PHYSICAL_MONITOR,
    },
    Foundation::POINT,
    Graphics::Gdi::{MONITOR_DEFAULTTOPRIMARY, MonitorFromPoint},
};

const POLL_INTERVAL: Duration = Duration::from_secs(2);

pub fn start(sink: Arc<dyn EventSink>) -> Option<Box<dyn Observer>> {
    spawn("otto-os-brightness", sink, run)
}

fn run(sink: Arc<dyn EventSink>, stop: &AtomicBool) {
    let Some(mut last) = read_brightness() else {
        return;
    };
    while !stop.load(Ordering::SeqCst) {
        sleep_while(stop, POLL_INTERVAL);
        if stop.load(Ordering::SeqCst) {
            break;
        }
        let Some(current) = read_brightness() else {
            continue;
        };
        if current != last {
            last = current;
            sink.observe(Observation::Brightness { percent: current });
        }
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
