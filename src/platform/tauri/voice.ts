import { invoke } from "@tauri-apps/api/core";
import { nativeAvailable } from "./runtime";

export type VoicePhase = "idle" | "downloading" | "listening" | "transcribing" | "error";
export type VoiceModelId = "small-q5_1" | "base-q5_1";
export type VoiceLanguage = "auto" | "id" | "en";

export type VoiceModelInfo = {
  id: VoiceModelId;
  label: string;
  description: string;
  approxBytes: number;
  installed: boolean;
  recommended: boolean;
};

export type VoiceInputDevice = {
  id: string;
  name: string;
  isDefault: boolean;
};

export type VoiceDownloadProgress = {
  modelId: VoiceModelId;
  stage: string;
  downloadedBytes: number;
  totalBytes: number | null;
  percent: number | null;
};

export type VoiceRecordOptions = {
  modelId: VoiceModelId;
  language: VoiceLanguage;
  deviceId: string | null;
  autoStopSilence: boolean;
};

export type VoiceSnapshot = {
  phase: VoicePhase;
  supported: boolean;
  runtimeInstalled: boolean;
  models: VoiceModelInfo[];
  activeModel: VoiceModelId;
  download: VoiceDownloadProgress | null;
  transcript: string | null;
  transcriptSeq: number;
  error: string | null;
};

export async function voiceStatus(): Promise<VoiceSnapshot> {
  return invoke("voice_status");
}

export async function voiceListDevices(): Promise<VoiceInputDevice[]> {
  return invoke("voice_list_devices");
}

export async function voiceShortcut(shortcut?: string): Promise<string> {
  return invoke("voice_shortcut", { shortcut: shortcut ?? null });
}

export async function voiceDownloadModel(modelId: VoiceModelId): Promise<VoiceSnapshot> {
  return invoke("voice_download_model", { modelId });
}

export async function voiceCancelDownload(): Promise<VoiceSnapshot> {
  return invoke("voice_cancel_download");
}

export async function voiceDeleteModel(modelId: VoiceModelId): Promise<VoiceSnapshot> {
  return invoke("voice_delete_model", { modelId });
}

export async function voiceStartRecording(options: VoiceRecordOptions): Promise<VoiceSnapshot> {
  return invoke("voice_start_recording", { options });
}

export async function voiceStopRecording(): Promise<VoiceSnapshot> {
  return invoke("voice_stop_recording");
}

export async function voiceCancel(): Promise<VoiceSnapshot> {
  return invoke("voice_cancel");
}

export async function onVoiceStateChanged(
  handler: (snapshot: VoiceSnapshot) => void,
): Promise<() => void> {
  if (!nativeAvailable) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<VoiceSnapshot>("otto-voice-state", (event) => {
    handler(event.payload);
  });
}

export async function onVoiceLevelChanged(handler: (level: number) => void): Promise<() => void> {
  if (!nativeAvailable) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<number>("otto-voice-level", (event) => {
    if (typeof event.payload === "number" && Number.isFinite(event.payload)) {
      handler(Math.max(0, Math.min(1, event.payload)));
    }
  });
}

export async function onVoiceToggle(toggle: () => void): Promise<() => void> {
  if (!nativeAvailable) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen("otto-voice-toggle", toggle);
}
