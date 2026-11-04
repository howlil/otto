use super::{Observer, spawn};
use crate::os_events::{EventSink, Observation};
use std::{
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
        mpsc::{self, RecvTimeoutError, Sender},
    },
    time::Duration,
};
use windows::{
    Win32::{
        Media::Audio::{
            AUDIO_VOLUME_NOTIFICATION_DATA, DEVICE_STATE, EDataFlow, ERole,
            Endpoints::IAudioEndpointVolume, Endpoints::IAudioEndpointVolumeCallback,
            Endpoints::IAudioEndpointVolumeCallback_Impl, IMMDeviceEnumerator,
            IMMNotificationClient, IMMNotificationClient_Impl, MMDeviceEnumerator, eConsole,
            eRender,
        },
        System::Com::{
            CLSCTX_ALL, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx, CoUninitialize,
        },
    },
    core::{PCWSTR, Result, implement},
};

#[implement(IAudioEndpointVolumeCallback)]
struct VolumeCallback {
    sink: Arc<dyn EventSink>,
}

impl IAudioEndpointVolumeCallback_Impl for VolumeCallback_Impl {
    fn OnNotify(&self, data: *mut AUDIO_VOLUME_NOTIFICATION_DATA) -> Result<()> {
        if data.is_null() {
            return Ok(());
        }
        let data = unsafe { &*data };
        let percent = (data.fMasterVolume.clamp(0.0, 1.0) * 100.0).round() as u8;
        self.sink.observe(Observation::Volume {
            percent,
            muted: data.bMuted.as_bool(),
        });
        Ok(())
    }
}

#[implement(IMMNotificationClient)]
struct DefaultDeviceClient {
    wake: Mutex<Sender<()>>,
}

impl IMMNotificationClient_Impl for DefaultDeviceClient_Impl {
    fn OnDeviceStateChanged(&self, _id: &PCWSTR, _state: DEVICE_STATE) -> Result<()> {
        Ok(())
    }

    fn OnDeviceAdded(&self, _id: &PCWSTR) -> Result<()> {
        Ok(())
    }

    fn OnDeviceRemoved(&self, _id: &PCWSTR) -> Result<()> {
        Ok(())
    }

    fn OnDefaultDeviceChanged(&self, flow: EDataFlow, role: ERole, _id: &PCWSTR) -> Result<()> {
        if flow == eRender
            && role == eConsole
            && let Ok(wake) = self.wake.lock()
        {
            let _ = wake.send(());
        }
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
    spawn("otto-os-volume", sink, run)
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
        let callback: IAudioEndpointVolumeCallback = VolumeCallback { sink }.into();
        let (wake, wake_rx) = mpsc::channel();
        let client: IMMNotificationClient = DefaultDeviceClient {
            wake: Mutex::new(wake),
        }
        .into();
        let registered = enumerator
            .RegisterEndpointNotificationCallback(&client)
            .is_ok();
        let mut endpoint = register(&enumerator, &callback);
        loop {
            match wake_rx.recv_timeout(Duration::from_millis(250)) {
                Ok(()) => {
                    if let Some(previous) = endpoint.take() {
                        let _ = previous.UnregisterControlChangeNotify(&callback);
                    }
                    endpoint = register(&enumerator, &callback);
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => break,
            }
            if stop.load(Ordering::SeqCst) {
                break;
            }
        }
        if let Some(previous) = endpoint.take() {
            let _ = previous.UnregisterControlChangeNotify(&callback);
        }
        if registered {
            let _ = enumerator.UnregisterEndpointNotificationCallback(&client);
        }
        CoUninitialize();
    }
}

fn register(
    enumerator: &IMMDeviceEnumerator,
    callback: &IAudioEndpointVolumeCallback,
) -> Option<IAudioEndpointVolume> {
    unsafe {
        let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole).ok()?;
        let endpoint: IAudioEndpointVolume = device.Activate(CLSCTX_ALL, None).ok()?;
        endpoint.RegisterControlChangeNotify(callback).ok()?;
        Some(endpoint)
    }
}
