import type {
  AgentConversationSummary,
  AgentProviderDescriptor,
  AgentProvider,
  AgentSnapshot,
  AssistantProfile,
  CaptureSource,
  LearningMode,
  ProviderReadiness,
  StagedCapture,
} from "../../../platform/tauri";

export type AgentErrorKind = "connection" | "request" | null;

export type AgentTranscriptModel = {
  snapshot: AgentSnapshot;
  readiness: ProviderReadiness;
  draft: string;
  setDraft: (draft: string) => void;
  mode?: LearningMode;
  setMode?: (mode: LearningMode) => void;
  profile?: AssistantProfile;
  onboardingPending?: boolean;
  onboardingOpen?: boolean;
  completeOnboarding?: (profile: AssistantProfile) => void;
  skipOnboarding?: () => void;
  openOnboarding?: () => void;
  closeOnboarding?: () => void;
  runQuickAction?: (mode: LearningMode, prompt: string) => Promise<void>;
  sendFollowupChip?: (mode: LearningMode, prompt: string) => Promise<void>;
  retryLast?: () => Promise<void>;
  editPrompt?: (messageId: string, text: string) => Promise<void>;
  queueFollowup?: () => Promise<void>;
  clearQueuedFollowup?: () => Promise<void>;
  respondPermission?: (requestId: string, allow: boolean) => Promise<void>;
  clearStaged?: () => Promise<void>;
  stageImage?: (file: Blob, label?: string) => Promise<StagedCapture>;
  error: string | null;
  busy: boolean;
  captureBusy: boolean;
  send: () => Promise<void>;
  sendText?: (text: string) => Promise<void>;
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
  textShortcut?: string;
  setTextShortcut?: (value: string) => void;
  saveTextShortcut?: (next?: string) => Promise<void>;
  autoSend?: boolean;
  setAutoSend?: (next: boolean) => Promise<void>;
  captureMessage: string;
  savingCapture: boolean;
  available: boolean;
  saveShortcut: (next?: string) => Promise<void>;
};

export type AgentHistoryModel = {
  conversations: AgentConversationSummary[];
  query: string;
  setQuery: (query: string) => void;
  serverFiltered?: boolean;
  exportedId?: string | null;
  pending: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  open: (id: string) => Promise<boolean>;
  rename: (id: string, title: string) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
  removeAll: () => Promise<boolean>;
  exportMarkdown?: (id: string) => Promise<boolean>;
};

export type AgentPanelModel = AgentTranscriptModel & {
  capture: CaptureShortcutModel;
  captureNow: (source?: CaptureSource) => Promise<void>;
  insertText: (text: string) => Promise<void>;
  history: AgentHistoryModel;
  providers: AgentProviderDescriptor[];
  provider: AgentProvider;
  refreshing?: boolean;
  pinnedModels?: string[];
  togglePinnedModel?: (modelId: string) => Promise<void>;
  model: string | null;
  setModel: (model: string | null) => void;
  thinkingEffort: string | null;
  setThinkingEffort: (effort: string | null) => void;
  setProvider: (provider: AgentProvider) => void;
  mode: LearningMode;
  setMode: (mode: LearningMode) => void;
  profile: AssistantProfile;
  setProfile: (profile: AssistantProfile) => void;
  clearProfile: () => void;
  locked: boolean;
  newSession: () => Promise<boolean>;
  refreshPath?: () => Promise<void>;
};

export type AgentViewModel = AgentPanelModel & {
  installed: boolean | null;
};
