import type { VoiceLanguage, VoiceModelId } from "../../platform/tauri";

export type ReadAloudMode = "off" | "voice-only" | "always";

export type VoicePreferences = {
  modelId: VoiceModelId;
  language: VoiceLanguage;
  deviceId: string;
  autoStopSilence: boolean;
  autoSend: boolean;
  readAloudMode: ReadAloudMode;
  ttsVoiceUri: string;
  ttsRate: number;
};

export const VOICE_PREFS_STORAGE_KEY = "otto.voice.preferences.v1";
export const DEFAULT_VOICE_SHORTCUT = "Ctrl+Alt+V";
export const TTS_RATE_RANGE = [0.75, 1.5] as const;

export const defaultVoicePreferences: VoicePreferences = {
  modelId: "small-q5_1",
  language: "auto",
  deviceId: "default",
  autoStopSilence: true,
  autoSend: false,
  readAloudMode: "off",
  ttsVoiceUri: "auto",
  ttsRate: 1.0,
};

const VALID_MODELS: readonly VoiceModelId[] = ["small-q5_1", "base-q5_1"];
const VALID_LANGUAGES: readonly VoiceLanguage[] = ["auto", "id", "en"];
const VALID_READ_ALOUD: readonly ReadAloudMode[] = ["off", "voice-only", "always"];

export function clampTtsRate(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return defaultVoicePreferences.ttsRate;
  const [min, max] = TTS_RATE_RANGE;
  return Math.round(Math.max(min, Math.min(max, value)) * 100) / 100;
}

export function readVoicePreferences(): VoicePreferences {
  try {
    const raw = localStorage.getItem(VOICE_PREFS_STORAGE_KEY);
    if (!raw) return { ...defaultVoicePreferences };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ...defaultVoicePreferences };
    }
    const record = parsed as Record<string, unknown>;
    return {
      modelId: VALID_MODELS.includes(record.modelId as VoiceModelId)
        ? (record.modelId as VoiceModelId)
        : defaultVoicePreferences.modelId,
      language: VALID_LANGUAGES.includes(record.language as VoiceLanguage)
        ? (record.language as VoiceLanguage)
        : defaultVoicePreferences.language,
      deviceId:
        typeof record.deviceId === "string" && record.deviceId.trim().length > 0
          ? record.deviceId.trim()
          : defaultVoicePreferences.deviceId,
      autoStopSilence:
        typeof record.autoStopSilence === "boolean"
          ? record.autoStopSilence
          : defaultVoicePreferences.autoStopSilence,
      autoSend:
        typeof record.autoSend === "boolean" ? record.autoSend : defaultVoicePreferences.autoSend,
      readAloudMode: VALID_READ_ALOUD.includes(record.readAloudMode as ReadAloudMode)
        ? (record.readAloudMode as ReadAloudMode)
        : defaultVoicePreferences.readAloudMode,
      ttsVoiceUri:
        typeof record.ttsVoiceUri === "string" && record.ttsVoiceUri.trim().length > 0
          ? record.ttsVoiceUri.trim()
          : defaultVoicePreferences.ttsVoiceUri,
      ttsRate: clampTtsRate(record.ttsRate),
    };
  } catch {
    return { ...defaultVoicePreferences };
  }
}

export function writeVoicePreferences(prefs: VoicePreferences): void {
  try {
    localStorage.setItem(VOICE_PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {}
}

export function formatModelMegabytes(bytes: number): string {
  const mb = Math.max(1, Math.round(bytes / 1_000_000));
  return `~${mb} MB`;
}
