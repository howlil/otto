import type {
  AgentMode,
  AgentSnapshot,
  CaptureSource,
  ProviderReadiness,
} from "../../platform/tauri";
import type { AgentErrorKind } from "./useAgent";

export type AgentTranscriptModel = {
  snapshot: AgentSnapshot;
  readiness: ProviderReadiness;
  draft: string;
  setDraft: (draft: string) => void;
  error: string | null;
  busy: boolean;
  send: () => Promise<void>;
  stop: () => Promise<void>;
  decide: (approvalId: string, decision: "allowOnce" | "deny") => Promise<boolean>;
  refreshProvider: () => Promise<void>;
  retryConnection: () => Promise<void>;
  clearError: () => void;
  errorKind: AgentErrorKind;
};

export type CaptureShortcutModel = {
  source: CaptureSource;
  selectSource: (source: CaptureSource) => Promise<void>;
  shortcut: string;
  setShortcut: (value: string) => void;
  captureMessage: string;
  savingCapture: boolean;
  available: boolean;
  saveShortcut: () => Promise<void>;
};

export type AgentPanelModel = AgentTranscriptModel & {
  capture: CaptureShortcutModel;
  cwd: string;
  setCwd: (cwd: string) => void;
  mode: AgentMode;
  setMode: (mode: AgentMode) => void;
  locked: boolean;
  newSession: () => Promise<boolean>;
};
