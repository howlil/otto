use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
use windows_sys::Win32::Media::Audio::{
    CALLBACK_EVENT, HWAVEIN, WAVE_FORMAT_PCM, WAVE_MAPPER, WAVEFORMATEX, WAVEHDR, WAVEINCAPSW,
    WHDR_DONE, waveInAddBuffer, waveInClose, waveInGetDevCapsW, waveInGetNumDevs, waveInOpen,
    waveInPrepareHeader, waveInReset, waveInStart, waveInStop, waveInUnprepareHeader,
};
use windows_sys::Win32::System::Threading::{CreateEventW, SetEvent, WaitForSingleObject};

use crate::voice::model::{
    SilenceDetector, VOICE_MAX_SAMPLES, VOICE_SAMPLE_RATE, VoiceInputDevice, compute_rms_level,
};

const BUFFER_COUNT: usize = 4;
const FRAME_MS: u64 = 50;
const SAMPLES_PER_BUFFER: usize = (VOICE_SAMPLE_RATE as usize * FRAME_MS as usize) / 1000;
const BYTES_PER_BUFFER: usize = SAMPLES_PER_BUFFER * 2;
const LEVEL_EMIT_INTERVAL: Duration = Duration::from_millis(65);

pub fn list_input_devices() -> Vec<VoiceInputDevice> {
    let mut devices = vec![VoiceInputDevice {
        id: "default".into(),
        name: "System default microphone".into(),
        is_default: true,
    }];
    let count = unsafe { waveInGetNumDevs() };
    for index in 0..count {
        let mut caps: WAVEINCAPSW = unsafe { std::mem::zeroed() };
        let rc = unsafe {
            waveInGetDevCapsW(
                index as usize,
                &mut caps,
                std::mem::size_of::<WAVEINCAPSW>() as u32,
            )
        };
        if rc != 0 {
            continue;
        }
        let pname = caps.szPname;
        let end = pname.iter().position(|&ch| ch == 0).unwrap_or(pname.len());
        let name = String::from_utf16_lossy(&pname[..end]).trim().to_string();
        if !name.is_empty() {
            devices.push(VoiceInputDevice {
                id: index.to_string(),
                name,
                is_default: false,
            });
        }
    }
    devices
}

fn resolve_device_id(device_id: Option<&str>) -> u32 {
    let Some(raw) = device_id
        .map(str::trim)
        .filter(|value| !value.is_empty() && *value != "default")
    else {
        return WAVE_MAPPER;
    };
    let Ok(parsed) = raw.parse::<u32>() else {
        return WAVE_MAPPER;
    };
    let count = unsafe { waveInGetNumDevs() };
    if parsed < count { parsed } else { WAVE_MAPPER }
}

pub struct ActiveRecording {
    stop_flag: Arc<AtomicBool>,
    cancel_flag: Arc<AtomicBool>,
    wake_event: usize,
    join: Option<JoinHandle<Vec<i16>>>,
}

impl ActiveRecording {
    pub fn start<L, A>(
        device_id: Option<String>,
        auto_stop_silence: bool,
        on_level: L,
        on_auto_stop: A,
    ) -> Result<Self, String>
    where
        L: Fn(f32) + Send + 'static,
        A: FnOnce() + Send + 'static,
    {
        let device = resolve_device_id(device_id.as_deref());
        let stop_flag = Arc::new(AtomicBool::new(false));
        let cancel_flag = Arc::new(AtomicBool::new(false));
        let event = unsafe { CreateEventW(std::ptr::null(), 0, 0, std::ptr::null()) };
        if event.is_null() {
            return Err("Could not initialize Windows microphone event.".into());
        }
        let wake_event = event as usize;
        let thread_stop = stop_flag.clone();
        let thread_cancel = cancel_flag.clone();
        let (ready_tx, ready_rx) = mpsc::sync_channel::<Result<(), String>>(1);

        let join = std::thread::spawn(move || {
            capture_loop(
                device,
                wake_event as HANDLE,
                auto_stop_silence,
                thread_stop,
                thread_cancel,
                ready_tx,
                on_level,
                on_auto_stop,
            )
        });

        match ready_rx.recv_timeout(Duration::from_secs(3)) {
            Ok(Ok(())) => Ok(Self {
                stop_flag,
                cancel_flag,
                wake_event,
                join: Some(join),
            }),
            Ok(Err(error)) => {
                let _ = join.join();
                unsafe {
                    CloseHandle(wake_event as HANDLE);
                }
                Err(error)
            }
            Err(_) => {
                cancel_flag.store(true, Ordering::SeqCst);
                unsafe {
                    SetEvent(wake_event as HANDLE);
                }
                let _ = join.join();
                unsafe {
                    CloseHandle(wake_event as HANDLE);
                }
                Err("Microphone startup timed out.".into())
            }
        }
    }

    pub fn stop(mut self) -> Vec<i16> {
        self.stop_flag.store(true, Ordering::SeqCst);
        unsafe {
            SetEvent(self.wake_event as HANDLE);
        }
        let samples = self
            .join
            .take()
            .and_then(|handle| handle.join().ok())
            .unwrap_or_default();
        unsafe {
            CloseHandle(self.wake_event as HANDLE);
        }
        samples
    }

    pub fn cancel(mut self) {
        self.cancel_flag.store(true, Ordering::SeqCst);
        self.stop_flag.store(true, Ordering::SeqCst);
        unsafe {
            SetEvent(self.wake_event as HANDLE);
        }
        if let Some(handle) = self.join.take() {
            let _ = handle.join();
        }
        unsafe {
            CloseHandle(self.wake_event as HANDLE);
        }
    }
}

impl Drop for ActiveRecording {
    fn drop(&mut self) {
        if self.join.is_some() {
            self.cancel_flag.store(true, Ordering::SeqCst);
            self.stop_flag.store(true, Ordering::SeqCst);
            unsafe {
                SetEvent(self.wake_event as HANDLE);
            }
            if let Some(handle) = self.join.take() {
                let _ = handle.join();
            }
            unsafe {
                CloseHandle(self.wake_event as HANDLE);
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn capture_loop<L, A>(
    device: u32,
    event: HANDLE,
    auto_stop_silence: bool,
    stop_flag: Arc<AtomicBool>,
    cancel_flag: Arc<AtomicBool>,
    ready_tx: mpsc::SyncSender<Result<(), String>>,
    on_level: L,
    on_auto_stop: A,
) -> Vec<i16>
where
    L: Fn(f32),
    A: FnOnce(),
{
    let format = WAVEFORMATEX {
        wFormatTag: WAVE_FORMAT_PCM as u16,
        nChannels: 1,
        nSamplesPerSec: VOICE_SAMPLE_RATE,
        nAvgBytesPerSec: VOICE_SAMPLE_RATE * 2,
        nBlockAlign: 2,
        wBitsPerSample: 16,
        cbSize: 0,
    };
    let mut handle: HWAVEIN = std::ptr::null_mut();
    let open_rc = unsafe {
        waveInOpen(
            &mut handle,
            device,
            &format,
            event as usize,
            0,
            CALLBACK_EVENT,
        )
    };
    if open_rc != 0 || handle.is_null() {
        let _ = ready_tx.send(Err(
            "Could not open the microphone. Check Windows microphone privacy permissions or pick another input device in Settings → Voice."
                .into(),
        ));
        return Vec::new();
    }

    let mut buffers: Vec<Vec<u8>> = (0..BUFFER_COUNT)
        .map(|_| vec![0_u8; BYTES_PER_BUFFER])
        .collect();
    let mut headers: Vec<WAVEHDR> = buffers
        .iter_mut()
        .map(|buf| WAVEHDR {
            lpData: buf.as_mut_ptr(),
            dwBufferLength: BYTES_PER_BUFFER as u32,
            dwBytesRecorded: 0,
            dwUser: 0,
            dwFlags: 0,
            dwLoops: 0,
            lpNext: std::ptr::null_mut(),
            reserved: 0,
        })
        .collect();

    for header in &mut headers {
        let prep =
            unsafe { waveInPrepareHeader(handle, header, std::mem::size_of::<WAVEHDR>() as u32) };
        let add = if prep == 0 {
            unsafe { waveInAddBuffer(handle, header, std::mem::size_of::<WAVEHDR>() as u32) }
        } else {
            prep
        };
        if add != 0 {
            cleanup_wave(handle, &mut headers);
            let _ = ready_tx.send(Err("Could not prepare Windows microphone buffers.".into()));
            return Vec::new();
        }
    }

    if unsafe { waveInStart(handle) } != 0 {
        cleanup_wave(handle, &mut headers);
        let _ = ready_tx.send(Err("Could not start microphone recording.".into()));
        return Vec::new();
    }
    let _ = ready_tx.send(Ok(()));

    let mut samples = Vec::with_capacity(VOICE_SAMPLE_RATE as usize * 8);
    let mut silence = SilenceDetector::new(auto_stop_silence);
    let mut last_level = Instant::now() - LEVEL_EMIT_INTERVAL;
    let mut auto_stop = Some(on_auto_stop);

    while !stop_flag.load(Ordering::Acquire) {
        unsafe {
            WaitForSingleObject(event, 100);
        }
        for header in &mut headers {
            if header.dwFlags & WHDR_DONE == 0 {
                continue;
            }
            let recorded = (header.dwBytesRecorded as usize).min(header.dwBufferLength as usize);
            let count = recorded / 2;
            if count > 0 {
                let raw = unsafe { std::slice::from_raw_parts(header.lpData, count * 2) };
                let frame: Vec<i16> = raw
                    .as_chunks::<2>()
                    .0
                    .iter()
                    .map(|pair| i16::from_le_bytes(*pair))
                    .collect();
                let rms = compute_rms_level(&frame);
                if last_level.elapsed() >= LEVEL_EMIT_INTERVAL {
                    last_level = Instant::now();
                    on_level(rms);
                }
                let remaining = VOICE_MAX_SAMPLES.saturating_sub(samples.len());
                let take = remaining.min(frame.len());
                samples.extend_from_slice(&frame[..take]);

                if samples.len() >= VOICE_MAX_SAMPLES || silence.observe(rms, FRAME_MS) {
                    stop_flag.store(true, Ordering::SeqCst);
                    if let Some(trigger) = auto_stop.take() {
                        trigger();
                    }
                    break;
                }
            }
            if !stop_flag.load(Ordering::Acquire) {
                header.dwBytesRecorded = 0;
                let _ = unsafe {
                    waveInAddBuffer(handle, header, std::mem::size_of::<WAVEHDR>() as u32)
                };
            }
        }
    }

    cleanup_wave(handle, &mut headers);
    if cancel_flag.load(Ordering::Acquire) {
        Vec::new()
    } else {
        samples
    }
}

fn cleanup_wave(handle: HWAVEIN, headers: &mut [WAVEHDR]) {
    unsafe {
        waveInStop(handle);
        waveInReset(handle);
    }
    for header in headers {
        unsafe {
            waveInUnprepareHeader(handle, header, std::mem::size_of::<WAVEHDR>() as u32);
        }
    }
    unsafe {
        waveInClose(handle);
    }
}
