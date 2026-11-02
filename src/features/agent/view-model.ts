import type {
  AgentConversationSummary,
  AgentProvider,
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
  captureBusy: boolean;
  send: () => Promise<void>;
  stop: () => Promise<void>;
  refreshProvider: () => Promise<void>;
  retryConnection: () => Promise<void>;
  clearError: () => void;
  errorKind: AgentErrorKind;
};

export type CaptureShortcutModel = {
  source: CaptureSource;
  targetTitle: string | null;
  targetWarning: string | null;
  targetPending: boolean;
  refreshTarget: () => Promise<void>;
  selectSource: (source: CaptureSource) => Promise<void>;
  sourceReady: boolean;
  sourcePending: boolean;
  shortcut: string;
  setShortcut: (value: string) => void;
  captureMessage: string;
  savingCapture: boolean;
  available: boolean;
  saveShortcut: () => Promise<void>;
};

export type AgentHistoryModel = {
  conversations: AgentConversationSummary[];
  query: string;
  setQuery: (query: string) => void;
  pending: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  open: (id: string) => Promise<boolean>;
  rename: (id: string, title: string) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
};

export type AgentPanelModel = AgentTranscriptModel & {
  capture: CaptureShortcutModel;
  captureNow: () => Promise<void>;
  history: AgentHistoryModel;
  provider: AgentProvider;
  model: string | null;
  setModel: (model: string | null) => void;
  thinkingEffort: string | null;
  setThinkingEffort: (effort: string | null) => void;
  setProvider: (provider: AgentProvider) => void;
  locked: boolean;
  newSession: () => Promise<boolean>;
};
