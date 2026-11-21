use futures_util::StreamExt;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use crate::voice::model::{GGML_MAGIC, VoiceDownloadProgress, VoiceModelId, VoiceModelInfo};

pub const WHISPER_WIN_X64_ZIP_URL: &str =
    "https://github.com/ggml-org/whisper.cpp/releases/download/b5907/whisper-bin-x64.zip";

const RUNTIME_BINARY_NAME: &str = "whisper-cli.exe";

#[derive(Clone, Debug)]
pub struct VoiceStore {
    root: PathBuf,
}

impl VoiceStore {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    pub fn bin_dir(&self) -> PathBuf {
        self.root.join("bin")
    }

    pub fn models_dir(&self) -> PathBuf {
        self.root.join("models")
    }

    pub fn managed_binary_path(&self) -> PathBuf {
        self.bin_dir().join(RUNTIME_BINARY_NAME)
    }

    pub fn resolve_binary(&self) -> Option<PathBuf> {
        let managed = self.managed_binary_path();
        if managed.is_file() {
            return Some(managed);
        }
        find_in_path(RUNTIME_BINARY_NAME).or_else(|| find_in_path("whisper-cli"))
    }

    pub fn model_path(&self, model: VoiceModelId) -> PathBuf {
        self.models_dir().join(model.filename())
    }

    pub fn is_model_installed(&self, model: VoiceModelId) -> bool {
        let path = self.model_path(model);
        path.is_file() && has_valid_ggml_header(&path)
    }

    pub fn models(&self) -> Vec<VoiceModelInfo> {
        VoiceModelId::ALL
            .into_iter()
            .map(|id| VoiceModelInfo {
                id,
                label: id.display_name().to_string(),
                description: id.description().to_string(),
                approx_bytes: id.approx_bytes(),
                installed: self.is_model_installed(id),
                recommended: id == VoiceModelId::SmallQ5,
            })
            .collect()
    }

    pub fn delete_model(&self, model: VoiceModelId) -> Result<(), String> {
        let path = self.model_path(model);
        if path.exists() {
            std::fs::remove_file(&path).map_err(|_| "Could not delete the voice model file.")?;
        }
        let part = partial_path(&path);
        if part.exists() {
            let _ = std::fs::remove_file(&part);
        }
        Ok(())
    }

    pub async fn ensure_ready<F>(
        &self,
        model: VoiceModelId,
        cancel: Arc<AtomicBool>,
        mut on_progress: F,
    ) -> Result<(), String>
    where
        F: FnMut(VoiceDownloadProgress),
    {
        std::fs::create_dir_all(self.bin_dir())
            .map_err(|_| "Could not create local voice runtime folder.")?;
        std::fs::create_dir_all(self.models_dir())
            .map_err(|_| "Could not create local voice model folder.")?;

        let client = reqwest::Client::builder()
            .user_agent("Otto-Desktop/1.0")
            .build()
            .map_err(|_| "Could not initialize HTTP download client.")?;

        if self.resolve_binary().is_none() {
            let zip_part = self.root.join("whisper-bin-x64.zip.part");
            download_to_file(
                &client,
                WHISPER_WIN_X64_ZIP_URL,
                &zip_part,
                cancel.clone(),
                |downloaded, total| {
                    on_progress(VoiceDownloadProgress {
                        model_id: model,
                        stage: "Downloading Whisper engine…".into(),
                        downloaded_bytes: downloaded,
                        total_bytes: total,
                        percent: percent(downloaded, total),
                    });
                },
            )
            .await?;

            on_progress(VoiceDownloadProgress {
                model_id: model,
                stage: "Extracting Whisper engine…".into(),
                downloaded_bytes: 0,
                total_bytes: None,
                percent: None,
            });
            let extract_result = extract_whisper_runtime(&zip_part, &self.bin_dir());
            let _ = std::fs::remove_file(&zip_part);
            extract_result?;
            if self.resolve_binary().is_none() {
                return Err("Whisper engine archive did not contain whisper-cli.exe.".into());
            }
        }

        if !self.is_model_installed(model) {
            let dest = self.model_path(model);
            let part = partial_path(&dest);
            download_to_file(
                &client,
                model.download_url(),
                &part,
                cancel,
                |downloaded, total| {
                    on_progress(VoiceDownloadProgress {
                        model_id: model,
                        stage: format!("Downloading {} model…", model.display_name()),
                        downloaded_bytes: downloaded,
                        total_bytes: total.or(Some(model.approx_bytes())),
                        percent: percent(downloaded, total.or(Some(model.approx_bytes()))),
                    });
                },
            )
            .await?;

            if !has_valid_ggml_header(&part) {
                let _ = std::fs::remove_file(&part);
                return Err("Downloaded voice model file was invalid or incomplete.".into());
            }
            if dest.exists() {
                let _ = std::fs::remove_file(&dest);
            }
            std::fs::rename(&part, &dest)
                .map_err(|_| "Could not finalize the downloaded voice model.")?;
        }
        Ok(())
    }
}

fn partial_path(target: &Path) -> PathBuf {
    let mut os = target.as_os_str().to_os_string();
    os.push(".part");
    PathBuf::from(os)
}

fn percent(downloaded: u64, total: Option<u64>) -> Option<u8> {
    let total = total?;
    if total == 0 {
        return None;
    }
    Some(((downloaded.saturating_mul(100)) / total).min(100) as u8)
}

fn has_valid_ggml_header(path: &Path) -> bool {
    let Ok(mut file) = std::fs::File::open(path) else {
        return false;
    };
    let mut magic = [0_u8; 4];
    file.read_exact(&mut magic).is_ok() && magic == GGML_MAGIC
}

fn find_in_path(binary: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join(binary);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

async fn download_to_file<F>(
    client: &reqwest::Client,
    url: &str,
    dest: &Path,
    cancel: Arc<AtomicBool>,
    mut on_chunk: F,
) -> Result<(), String>
where
    F: FnMut(u64, Option<u64>),
{
    let response = client.get(url).send().await.map_err(
        |_| "Could not reach the Whisper download server. Check your internet connection.",
    )?;
    if !response.status().is_success() {
        return Err(format!(
            "Voice download failed with HTTP {}.",
            response.status().as_u16()
        ));
    }
    let total = response.content_length();
    let mut file =
        std::fs::File::create(dest).map_err(|_| "Could not write the downloaded voice file.")?;
    let mut stream = response.bytes_stream();
    let mut downloaded = 0_u64;
    let mut last_reported = 0_u64;
    on_chunk(0, total);
    while let Some(chunk) = stream.next().await {
        if cancel.load(Ordering::Relaxed) {
            drop(file);
            let _ = std::fs::remove_file(dest);
            return Err("Voice model download cancelled.".into());
        }
        let bytes = chunk.map_err(|_| {
            let _ = std::fs::remove_file(dest);
            "Connection dropped while downloading voice model.".to_string()
        })?;
        file.write_all(&bytes).map_err(|_| {
            let _ = std::fs::remove_file(dest);
            "Could not save downloaded voice data to disk.".to_string()
        })?;
        downloaded = downloaded.saturating_add(bytes.len() as u64);
        if downloaded.saturating_sub(last_reported) >= 256 * 1024 || total == Some(downloaded) {
            last_reported = downloaded;
            on_chunk(downloaded, total);
        }
    }
    file.flush()
        .map_err(|_| "Could not flush downloaded voice file.")?;
    on_chunk(downloaded, total);
    Ok(())
}

pub fn extract_whisper_runtime(zip_path: &Path, dest_dir: &Path) -> Result<(), String> {
    let file =
        std::fs::File::open(zip_path).map_err(|_| "Could not open Whisper runtime archive.")?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|_| "Whisper runtime archive is corrupted.")?;
    std::fs::create_dir_all(dest_dir)
        .map_err(|_| "Could not prepare Whisper runtime directory.")?;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|_| "Could not read entry from Whisper runtime archive.")?;
        if entry.is_dir() {
            continue;
        }
        let Some(name) = entry.enclosed_name().and_then(|path| {
            path.file_name()
                .map(|file_name| file_name.to_string_lossy().to_string())
        }) else {
            continue;
        };
        let lower = name.to_ascii_lowercase();
        let wanted = lower == RUNTIME_BINARY_NAME || lower.ends_with(".dll");
        if !wanted {
            continue;
        }
        let out_path = dest_dir.join(&name);
        let mut out = std::fs::File::create(&out_path)
            .map_err(|_| "Could not extract Whisper runtime files.")?;
        std::io::copy(&mut entry, &mut out)
            .map_err(|_| "Could not write extracted Whisper runtime file.")?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_store() -> (PathBuf, VoiceStore) {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("otto-voice-store-test-{stamp}"));
        std::fs::create_dir_all(&dir).unwrap();
        let store = VoiceStore::new(dir.clone());
        (dir, store)
    }

    #[test]
    fn validates_ggml_magic_header_and_lists_models() {
        let (dir, store) = temp_store();
        std::fs::create_dir_all(store.models_dir()).unwrap();
        let small = store.model_path(VoiceModelId::SmallQ5);
        std::fs::write(&small, b"not-ggml").unwrap();
        assert!(!store.is_model_installed(VoiceModelId::SmallQ5));

        std::fs::write(&small, b"lmggrest-of-model").unwrap();
        assert!(store.is_model_installed(VoiceModelId::SmallQ5));
        let models = store.models();
        assert_eq!(models.len(), 2);
        assert!(models[0].installed);
        assert!(models[0].recommended);
        assert!(!models[1].installed);

        store.delete_model(VoiceModelId::SmallQ5).unwrap();
        assert!(!store.is_model_installed(VoiceModelId::SmallQ5));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
