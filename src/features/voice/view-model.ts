import type {
  VoiceDownloadProgress,
  VoiceInputDevice,
  VoiceModelId,
  VoiceModelInfo,
  VoicePhase,
  VoiceSnapshot,
} from "../../platform/tauri";
import type { ReadAloudMode, VoicePreferences } from "./preferences";

export type TtsVoiceOption = {
  uri: string;
  name: string;
  lang: string;
};

export type VoiceViewModel = {
  snapshot: VoiceSnapshot;
  prefs: VoicePreferences;
  updatePrefs: (patch: Partial<VoicePreferences>) => void;
  devices: VoiceInputDevice[];
  refreshDevices: () => Promise<void>;
  shortcut: string;
  shortcutMessage: string;
  shortcutBusy: boolean;
  saveShortcut: (next?: string) => Promise<void>;
  level: number;
  activeModelInfo: VoiceModelInfo | null;
  activeModelReady: boolean;
  listening: boolean;
  transcribing: boolean;
  downloading: boolean;
  downloadProgress: VoiceDownloadProgress | null;
  toggleRecording: () => Promise<void>;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  cancelVoice: () => Promise<void>;
  downloadModel: (modelId?: VoiceModelId) => Promise<void>;
  cancelDownload: () => Promise<void>;
  deleteModel: (modelId: VoiceModelId) => Promise<void>;
  speaking: boolean;
  speakingMessageId: string | null;
  ttsSupported: boolean;
  ttsVoices: TtsVoiceOption[];
  speakMessage: (messageId: string, text: string) => void;
  stopSpeaking: () => void;
  toggleSpeakMessage: (messageId: string, text: string) => void;
  noteVoiceSubmission: () => void;
};

export type { ReadAloudMode, VoicePreferences, VoicePhase, VoiceModelId, VoiceModelInfo };
