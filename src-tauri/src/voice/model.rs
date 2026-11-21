use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub const VOICE_SAMPLE_RATE: u32 = 16_000;
pub const VOICE_MAX_DURATION_SECS: usize = 120;
pub const VOICE_MAX_SAMPLES: usize = VOICE_SAMPLE_RATE as usize * VOICE_MAX_DURATION_SECS;
pub const VOICE_SILENCE_THRESHOLD: f32 = 0.015;
pub const VOICE_SPEECH_THRESHOLD: f32 = 0.028;
pub const VOICE_SPEECH_MIN_MS: u64 = 140;
pub const VOICE_SILENCE_STOP_MS: u64 = 1800;
pub const VOICE_INITIAL_TIMEOUT_MS: u64 = 12_000;
pub const GGML_MAGIC: [u8; 4] = *b"lmgg";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum VoicePhase {
    Idle,
    Downloading,
    Listening,
    Transcribing,
    Error,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum VoiceModelId {
    #[serde(rename = "small-q5_1")]
    SmallQ5,
    #[serde(rename = "base-q5_1")]
    BaseQ5,
}

impl VoiceModelId {
    pub const ALL: [Self; 2] = [Self::SmallQ5, Self::BaseQ5];

    pub fn parse(value: &str) -> Result<Self, String> {
        match value.trim() {
            "small-q5_1" => Ok(Self::SmallQ5),
            "base-q5_1" => Ok(Self::BaseQ5),
            _ => Err("Unsupported voice model selection.".into()),
        }
    }

    pub fn display_name(self) -> &'static str {
        match self {
            Self::SmallQ5 => "Small (Q5_1)",
            Self::BaseQ5 => "Base (Q5_1)",
        }
    }

    pub fn description(self) -> &'static str {
        match self {
            Self::SmallQ5 => "Recommended for Indonesian + English accuracy",
            Self::BaseQ5 => "Faster and lighter on CPU",
        }
    }

    pub fn filename(self) -> &'static str {
        match self {
            Self::SmallQ5 => "ggml-small-q5_1.bin",
            Self::BaseQ5 => "ggml-base-q5_1.bin",
        }
    }

    pub fn approx_bytes(self) -> u64 {
        match self {
            Self::SmallQ5 => 190_000_000,
            Self::BaseQ5 => 60_000_000,
        }
    }

    pub fn download_url(self) -> &'static str {
        match self {
            Self::SmallQ5 => {
                "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin"
            }
            Self::BaseQ5 => {
                "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin"
            }
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceModelInfo {
    pub id: VoiceModelId,
    pub label: String,
    pub description: String,
    pub approx_bytes: u64,
    pub installed: bool,
    pub recommended: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceInputDevice {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceDownloadProgress {
    pub model_id: VoiceModelId,
    pub stage: String,
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub percent: Option<u8>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceRecordOptions {
    pub model_id: String,
    pub language: String,
    pub device_id: Option<String>,
    pub auto_stop_silence: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceSnapshot {
    pub phase: VoicePhase,
    pub supported: bool,
    pub runtime_installed: bool,
    pub models: Vec<VoiceModelInfo>,
    pub active_model: VoiceModelId,
    pub download: Option<VoiceDownloadProgress>,
    pub transcript: Option<String>,
    pub transcript_seq: u64,
    pub error: Option<String>,
}

pub fn normalize_voice_language(value: &str) -> &'static str {
    match value.trim().to_ascii_lowercase().as_str() {
        "id" | "indonesian" => "id",
        "en" | "english" => "en",
        _ => "auto",
    }
}

pub fn compute_rms_level(samples: &[i16]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum_sq: f64 = samples
        .iter()
        .map(|&sample| {
            let norm = f64::from(sample) / 32768.0;
            norm * norm
        })
        .sum();
    let rms = (sum_sq / samples.len() as f64).sqrt() as f32;
    (rms * 4.0).clamp(0.0, 1.0)
}

pub struct SilenceDetector {
    enabled: bool,
    speech_ms: u64,
    silence_ms: u64,
    elapsed_ms: u64,
    heard_speech: bool,
}

impl SilenceDetector {
    pub fn new(enabled: bool) -> Self {
        Self {
            enabled,
            speech_ms: 0,
            silence_ms: 0,
            elapsed_ms: 0,
            heard_speech: false,
        }
    }

    pub fn observe(&mut self, rms: f32, frame_ms: u64) -> bool {
        self.elapsed_ms = self.elapsed_ms.saturating_add(frame_ms);
        if !self.enabled {
            return false;
        }
        if !self.heard_speech {
            if rms >= VOICE_SPEECH_THRESHOLD {
                self.speech_ms = self.speech_ms.saturating_add(frame_ms);
                if self.speech_ms >= VOICE_SPEECH_MIN_MS {
                    self.heard_speech = true;
                    self.silence_ms = 0;
                }
            } else {
                self.speech_ms = 0;
            }
            return self.elapsed_ms >= VOICE_INITIAL_TIMEOUT_MS;
        }
        if rms < VOICE_SILENCE_THRESHOLD {
            self.silence_ms = self.silence_ms.saturating_add(frame_ms);
            return self.silence_ms >= VOICE_SILENCE_STOP_MS;
        }
        self.silence_ms = 0;
        false
    }
}

pub fn encode_wav_pcm16_mono(samples: &[i16], sample_rate: u32) -> Vec<u8> {
    let data_bytes = (samples.len() * 2) as u32;
    let riff_size = 36_u32.saturating_add(data_bytes);
    let byte_rate = sample_rate.saturating_mul(2);
    let mut out = Vec::with_capacity(44 + samples.len() * 2);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&riff_size.to_le_bytes());
    out.extend_from_slice(b"WAVE");
    out.extend_from_slice(b"fmt ");
    out.extend_from_slice(&16_u32.to_le_bytes());
    out.extend_from_slice(&1_u16.to_le_bytes());
    out.extend_from_slice(&1_u16.to_le_bytes());
    out.extend_from_slice(&sample_rate.to_le_bytes());
    out.extend_from_slice(&byte_rate.to_le_bytes());
    out.extend_from_slice(&2_u16.to_le_bytes());
    out.extend_from_slice(&16_u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_bytes.to_le_bytes());
    for &sample in samples {
        out.extend_from_slice(&sample.to_le_bytes());
    }
    out
}

pub fn clean_whisper_transcript(raw: &str) -> String {
    let mut parts = Vec::new();
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let cleaned = strip_bracket_markers(trimmed);
        let normalized = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
        if !normalized.is_empty() {
            parts.push(normalized);
        }
    }
    parts.join(" ").trim().to_string()
}

fn strip_bracket_markers(line: &str) -> String {
    let mut result = String::with_capacity(line.len());
    let chars: Vec<char> = line.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '['
            && let Some(end) = chars[i + 1..].iter().position(|&c| c == ']')
        {
            let inner: String = chars[i + 1..i + 1 + end].iter().collect();
            let upper = inner.trim().to_ascii_uppercase();
            if is_whisper_noise_marker(&upper) {
                i = i + 2 + end;
                continue;
            }
        }
        if chars[i] == '('
            && let Some(end) = chars[i + 1..].iter().position(|&c| c == ')')
        {
            let inner: String = chars[i + 1..i + 1 + end].iter().collect();
            let upper = inner.trim().to_ascii_uppercase();
            if is_whisper_noise_marker(&upper) {
                i = i + 2 + end;
                continue;
            }
        }
        result.push(chars[i]);
        i += 1;
    }
    result
}

fn is_whisper_noise_marker(upper: &str) -> bool {
    matches!(
        upper,
        "BLANK_AUDIO"
            | "SILENCE"
            | "MUSIC"
            | "APPLAUSE"
            | "LAUGHTER"
            | "NO_SPEECH"
            | "INAUDIBLE"
            | "STATIC"
    ) || upper.contains("BLANK_AUDIO")
}

pub struct TempWavFile {
    path: PathBuf,
}

impl TempWavFile {
    pub fn write(samples: &[i16]) -> Result<Self, String> {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let path =
            std::env::temp_dir().join(format!("otto-voice-{}-{stamp}.wav", std::process::id()));
        let wav = encode_wav_pcm16_mono(samples, VOICE_SAMPLE_RATE);
        std::fs::write(&path, wav).map_err(|_| "Could not prepare temporary voice audio.")?;
        Ok(Self { path })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TempWavFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wav_encoder_produces_valid_16khz_mono_pcm_header() {
        let samples = [0_i16, 1000, -1000, 32767];
        let wav = encode_wav_pcm16_mono(&samples, VOICE_SAMPLE_RATE);
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
        assert_eq!(&wav[12..16], b"fmt ");
        assert_eq!(u16::from_le_bytes([wav[20], wav[21]]), 1);
        assert_eq!(u16::from_le_bytes([wav[22], wav[23]]), 1);
        assert_eq!(
            u32::from_le_bytes([wav[24], wav[25], wav[26], wav[27]]),
            16_000
        );
        assert_eq!(&wav[36..40], b"data");
        assert_eq!(u32::from_le_bytes([wav[40], wav[41], wav[42], wav[43]]), 8);
        assert_eq!(wav.len(), 52);
    }

    #[test]
    fn silence_detector_stops_only_after_speech_and_trailing_silence() {
        let mut detector = SilenceDetector::new(true);
        for _ in 0..10 {
            assert!(!detector.observe(0.002, 50));
        }
        for _ in 0..4 {
            assert!(!detector.observe(0.12, 50));
        }
        let mut stopped = false;
        for _ in 0..40 {
            if detector.observe(0.005, 50) {
                stopped = true;
                break;
            }
        }
        assert!(stopped);

        let mut disabled = SilenceDetector::new(false);
        for _ in 0..500 {
            assert!(!disabled.observe(0.0, 50));
        }
    }

    #[test]
    fn transcript_cleaner_removes_whisper_noise_markers_and_preserves_text() {
        assert_eq!(clean_whisper_transcript("[BLANK_AUDIO]"), "");
        assert_eq!(
            clean_whisper_transcript("  [MUSIC] Jelaskan   konsep  recursion (silence) \n  dong "),
            "Jelaskan konsep recursion dong"
        );
        assert_eq!(
            clean_whisper_transcript("What is [O(n)] complexity?"),
            "What is [O(n)] complexity?"
        );
    }

    #[test]
    fn temp_wav_file_deletes_itself_on_drop() {
        let path = {
            let file = TempWavFile::write(&[10, -10, 20]).expect("temp wav writes");
            assert!(file.path().exists());
            file.path().to_path_buf()
        };
        assert!(!path.exists());
    }
}
