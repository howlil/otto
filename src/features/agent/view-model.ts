import type { AgentMode, AgentSnapshot, ProviderReadiness } from "../../platform/tauri";

// Presentation accepts only the state and actions it renders; the native
// session controller is free to evolve independently of these view contracts.
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
};

export type AgentPanelModel = AgentTranscriptModel & {
  cwd: string;
  setCwd: (cwd: string) => void;
  mode: AgentMode;
  setMode: (mode: AgentMode) => void;
  locked: boolean;
  newSession: () => Promise<boolean>;
};
