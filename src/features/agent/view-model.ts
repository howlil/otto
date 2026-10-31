import type { AgentMode, AgentSnapshot, ProviderReadiness } from "../../platform/tauri";
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

export type AgentPanelModel = AgentTranscriptModel & {
  cwd: string;
  setCwd: (cwd: string) => void;
  mode: AgentMode;
  setMode: (mode: AgentMode) => void;
  locked: boolean;
  newSession: () => Promise<boolean>;
};
