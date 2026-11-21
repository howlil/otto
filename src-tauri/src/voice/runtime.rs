use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tokio::sync::watch;

use crate::voice::model::{
    TempWavFile, VOICE_SAMPLE_RATE, VoiceDownloadProgress, VoiceInputDevice, VoiceModelId,
    VoicePhase, VoiceRecordOptions, VoiceSnapshot,
};
use crate::voice::store::VoiceStore;
use crate::voice::transcribe::transcribe_wav;

#[cfg(windows)]
use crate::platform::windows::voice_audio::{ActiveRecording, list_input_devices};

const MIN_SPEECH_SAMPLES: usize = VOICE_SAMPLE_RATE as usize / 5;

struct ActiveRecordSession {
    model: VoiceModelId,
    language: String,
    #[cfg(windows)]
    recording: ActiveRecording,
}

struct InnerState {
    phase: VoicePhase,
    active_model: VoiceModelId,
    download: Option<VoiceDownloadProgress>,
    transcript: Option<String>,
    transcript_seq: u64,
    error: Option<String>,
    recording: Option<ActiveRecordSession>,
    download_cancel: Option<Arc<AtomicBool>>,
    transcribe_cancel: Option<watch::Sender<bool>>,
}

#[derive(Clone)]
pub struct VoiceRuntime {
    store: VoiceStore,
    state: Arc<Mutex<InnerState>>,
}

impl VoiceRuntime {
    pub fn new(voice_dir: PathBuf) -> Self {
        let store = VoiceStore::new(voice_dir);
        let state = InnerState {
            phase: VoicePhase::Idle,
            active_model: VoiceModelId::SmallQ5,
            download: None,
            transcript: None,
            transcript_seq: 0,
            error: None,
            recording: None,
            download_cancel: None,
            transcribe_cancel: None,
        };
        Self {
            store,
            state: Arc::new(Mutex::new(state)),
        }
    }

    pub fn snapshot(&self) -> VoiceSnapshot {
        let guard = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        self.build_snapshot(&guard)
    }

    fn build_snapshot(&self, guard: &InnerState) -> VoiceSnapshot {
        VoiceSnapshot {
            phase: guard.phase,
            supported: cfg!(windows),
            runtime_installed: self.store.resolve_binary().is_some(),
            models: self.store.models(),
            active_model: guard.active_model,
            download: guard.download.clone(),
            transcript: guard.transcript.clone(),
            transcript_seq: guard.transcript_seq,
            error: guard.error.clone(),
        }
    }

    pub fn list_devices(&self) -> Vec<VoiceInputDevice> {
        #[cfg(windows)]
        {
            list_input_devices()
        }
        #[cfg(not(windows))]
        {
            Vec::new()
        }
    }

    pub async fn download_model<F>(
        &self,
        model_id: &str,
        on_update: F,
    ) -> Result<VoiceSnapshot, String>
    where
        F: Fn(VoiceSnapshot) + Send + Sync + 'static,
    {
        let model = VoiceModelId::parse(model_id)?;
        let cancel = Arc::new(AtomicBool::new(false));
        let initial = {
            let mut guard = self
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            if matches!(
                guard.phase,
                VoicePhase::Downloading | VoicePhase::Listening | VoicePhase::Transcribing
            ) {
                return Err(
                    "Voice engine is busy. Wait or cancel the current action first.".into(),
                );
            }
            guard.phase = VoicePhase::Downloading;
            guard.active_model = model;
            guard.error = None;
            guard.download = Some(VoiceDownloadProgress {
                model_id: model,
                stage: "Preparing download…".into(),
                downloaded_bytes: 0,
                total_bytes: Some(model.approx_bytes()),
                percent: Some(0),
            });
            guard.download_cancel = Some(cancel.clone());
            self.build_snapshot(&guard)
        };
        on_update(initial);

        let on_update = Arc::new(on_update);
        let state_ref = self.state.clone();
        let store_ref = self.store.clone();
        let progress_emit = on_update.clone();
        let result = self
            .store
            .ensure_ready(model, cancel, move |progress| {
                let snapshot = {
                    let mut guard = state_ref
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner);
                    guard.download = Some(progress);
                    VoiceSnapshot {
                        phase: guard.phase,
                        supported: cfg!(windows),
                        runtime_installed: store_ref.resolve_binary().is_some(),
                        models: store_ref.models(),
                        active_model: guard.active_model,
                        download: guard.download.clone(),
                        transcript: guard.transcript.clone(),
                        transcript_seq: guard.transcript_seq,
                        error: guard.error.clone(),
                    }
                };
                progress_emit(snapshot);
            })
            .await;

        let final_snapshot = {
            let mut guard = self
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            guard.download_cancel = None;
            guard.download = None;
            match &result {
                Ok(()) => {
                    guard.phase = VoicePhase::Idle;
                    guard.error = None;
                }
                Err(error) => {
                    guard.phase = if error.contains("cancelled") {
                        VoicePhase::Idle
                    } else {
                        VoicePhase::Error
                    };
                    guard.error = if error.contains("cancelled") {
                        None
                    } else {
                        Some(error.clone())
                    };
                }
            }
            self.build_snapshot(&guard)
        };
        on_update(final_snapshot.clone());
        result.map(|()| final_snapshot)
    }

    pub fn cancel_download(&self) -> VoiceSnapshot {
        let guard = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(flag) = &guard.download_cancel {
            flag.store(true, Ordering::SeqCst);
        }
        self.build_snapshot(&guard)
    }

    pub fn delete_model(&self, model_id: &str) -> Result<VoiceSnapshot, String> {
        let model = VoiceModelId::parse(model_id)?;
        let guard = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if matches!(
            guard.phase,
            VoicePhase::Downloading | VoicePhase::Listening | VoicePhase::Transcribing
        ) {
            return Err("Stop active voice work before deleting a model.".into());
        }
        self.store.delete_model(model)?;
        Ok(self.build_snapshot(&guard))
    }

    pub fn start_recording<L, A>(
        &self,
        options: VoiceRecordOptions,
        on_level: L,
        on_auto_stop: A,
    ) -> Result<VoiceSnapshot, String>
    where
        L: Fn(f32) + Send + 'static,
        A: FnOnce() + Send + 'static,
    {
        #[cfg(not(windows))]
        {
            let _ = (options, on_level, on_auto_stop);
            return Err("Voice input requires Otto for Windows.".into());
        }
        #[cfg(windows)]
        {
            let model = VoiceModelId::parse(&options.model_id)?;
            if self.store.resolve_binary().is_none() || !self.store.is_model_installed(model) {
                return Err(
                    "Voice model is not downloaded yet. Download it in Settings → Voice.".into(),
                );
            }
            {
                let guard = self
                    .state
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                if matches!(
                    guard.phase,
                    VoicePhase::Downloading | VoicePhase::Listening | VoicePhase::Transcribing
                ) {
                    return Err("Voice engine is already active.".into());
                }
            }
            let recording = ActiveRecording::start(
                options.device_id,
                options.auto_stop_silence,
                on_level,
                on_auto_stop,
            )?;
            let mut guard = self
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            guard.phase = VoicePhase::Listening;
            guard.active_model = model;
            guard.error = None;
            guard.recording = Some(ActiveRecordSession {
                model,
                language: options.language,
                recording,
            });
            Ok(self.build_snapshot(&guard))
        }
    }

    pub async fn stop_and_transcribe<F>(&self, on_update: F) -> Result<VoiceSnapshot, String>
    where
        F: Fn(VoiceSnapshot) + Send + Sync,
    {
        let session = {
            let mut guard = self
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            let Some(session) = guard.recording.take() else {
                return Ok(self.build_snapshot(&guard));
            };
            guard.phase = VoicePhase::Transcribing;
            guard.error = None;
            let snap = self.build_snapshot(&guard);
            on_update(snap);
            session
        };

        #[cfg(windows)]
        let samples = tokio::task::spawn_blocking(move || session.recording.stop())
            .await
            .map_err(|_| "Could not finalize microphone recording.".to_string())?;
        #[cfg(not(windows))]
        let samples: Vec<i16> = Vec::new();

        if samples.len() < MIN_SPEECH_SAMPLES {
            let snap = {
                let mut guard = self
                    .state
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                guard.phase = VoicePhase::Idle;
                guard.error = None;
                self.build_snapshot(&guard)
            };
            on_update(snap.clone());
            return Ok(snap);
        }

        let Some(binary) = self.store.resolve_binary() else {
            return self.fail_transcribe("Whisper engine is not installed.".into(), &on_update);
        };
        let model_path = self.store.model_path(session.model);
        if !self.store.is_model_installed(session.model) {
            return self.fail_transcribe("Selected voice model is missing.".into(), &on_update);
        }

        let temp_wav = match TempWavFile::write(&samples) {
            Ok(file) => file,
            Err(error) => return self.fail_transcribe(error, &on_update),
        };
        drop(samples);

        let (cancel_tx, cancel_rx) = watch::channel(false);
        {
            let mut guard = self
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            guard.transcribe_cancel = Some(cancel_tx);
        }

        let outcome = transcribe_wav(
            &binary,
            &model_path,
            temp_wav.path(),
            &session.language,
            cancel_rx,
        )
        .await;
        drop(temp_wav);

        let snapshot = {
            let mut guard = self
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            guard.transcribe_cancel = None;
            match &outcome {
                Ok(text) => {
                    guard.phase = VoicePhase::Idle;
                    guard.error = None;
                    if !text.is_empty() {
                        guard.transcript = Some(text.clone());
                        guard.transcript_seq = guard.transcript_seq.saturating_add(1);
                    }
                }
                Err(error) => {
                    if error.contains("cancelled") {
                        guard.phase = VoicePhase::Idle;
                        guard.error = None;
                    } else {
                        guard.phase = VoicePhase::Error;
                        guard.error = Some(error.clone());
                    }
                }
            }
            self.build_snapshot(&guard)
        };
        on_update(snapshot.clone());
        outcome.map(|_| snapshot)
    }

    fn fail_transcribe<F>(&self, error: String, on_update: &F) -> Result<VoiceSnapshot, String>
    where
        F: Fn(VoiceSnapshot),
    {
        let snapshot = {
            let mut guard = self
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            guard.phase = VoicePhase::Error;
            guard.error = Some(error.clone());
            self.build_snapshot(&guard)
        };
        on_update(snapshot);
        Err(error)
    }

    pub fn cancel(&self) -> VoiceSnapshot {
        let recording = {
            let mut guard = self
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            if let Some(flag) = &guard.download_cancel {
                flag.store(true, Ordering::SeqCst);
            }
            if let Some(tx) = guard.transcribe_cancel.take() {
                let _ = tx.send(true);
            }
            guard.phase = VoicePhase::Idle;
            guard.error = None;
            guard.download = None;
            guard.recording.take()
        };
        #[cfg(windows)]
        if let Some(session) = recording {
            session.recording.cancel();
        }
        #[cfg(not(windows))]
        let _ = recording;
        self.snapshot()
    }

    pub async fn shutdown(&self) {
        let _ = self.cancel();
    }
}
