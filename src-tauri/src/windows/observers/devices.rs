use super::{Observer, sleep_while, spawn};
use crate::os_events::{EventSink, Observation, PeripheralKind};
use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
use windows::{
    Win32::{
        Media::Audio::{
            DEVICE_STATE, EDataFlow, ERole, IMMDeviceEnumerator, IMMNotificationClient,
            IMMNotificationClient_Impl, MMDeviceEnumerator,
        },
        System::Com::{
            CLSCTX_ALL, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx, CoUninitialize,
        },
    },
    core::{PCWSTR, Result, implement},
};

const IDLE_INTERVAL: Duration = Duration::from_millis(250);

#[implement(IMMNotificationClient)]
struct DeviceClient {
    sink: Arc<dyn EventSink>,
}

impl IMMNotificationClient_Impl for DeviceClient_Impl {
    fn OnDeviceStateChanged(&self, _id: &PCWSTR, _state: DEVICE_STATE) -> Result<()> {
        Ok(())
    }

    fn OnDeviceAdded(&self, _id: &PCWSTR) -> Result<()> {
        self.sink.observe(Observation::Peripheral {
            connected: true,
            kind: PeripheralKind::Audio,
            name: None,
        });
        Ok(())
    }

    fn OnDeviceRemoved(&self, _id: &PCWSTR) -> Result<()> {
        self.sink.observe(Observation::Peripheral {
            connected: false,
            kind: PeripheralKind::Audio,
            name: None,
        });
        Ok(())
    }

    fn OnDefaultDeviceChanged(&self, _flow: EDataFlow, _role: ERole, _id: &PCWSTR) -> Result<()> {
        Ok(())
    }

    fn OnPropertyValueChanged(
        &self,
        _id: &PCWSTR,
        _key: &windows::Win32::Foundation::PROPERTYKEY,
    ) -> Result<()> {
        Ok(())
    }
}

pub fn start(sink: Arc<dyn EventSink>) -> Option<Box<dyn Observer>> {
    spawn("otto-os-devices", sink, run)
}

fn run(sink: Arc<dyn EventSink>, stop: &AtomicBool) {
    unsafe {
        if CoInitializeEx(None, COINIT_MULTITHREADED).is_err() {
            return;
        }
        let Ok(enumerator) =
            CoCreateInstance::<_, IMMDeviceEnumerator>(&MMDeviceEnumerator, None, CLSCTX_ALL)
        else {
            CoUninitialize();
            return;
        };
        let client: IMMNotificationClient = DeviceClient { sink }.into();
        if enumerator
            .RegisterEndpointNotificationCallback(&client)
            .is_err()
        {
            CoUninitialize();
            return;
        }
        while !stop.load(Ordering::SeqCst) {
            sleep_while(stop, IDLE_INTERVAL);
        }
        let _ = enumerator.UnregisterEndpointNotificationCallback(&client);
        CoUninitialize();
    }
}
