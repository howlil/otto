import type { AgentCapture } from "./capture";
import type { AssistantProfile, LearningMode } from "./agent-guidance";

export type AgentStatus =
  | "idle"
  | "starting"
  | "streaming"
  | "stopping"
  | "completed"
  | "stopped"
  | "failed";

export type AgentProvider =
  | "codex"
  | "pi"
  | "agy"
  | "opencode"
  | "claude"
  | "gemini"
  | "copilot"
  | "qwen"
  | "cursor"
  | "goose"
  | "vibe"
  | "amp"
  | "kilo"
  | "junie"
  | "cline"
  | "augment"
  | "droid"
  | "grok"
  | "devin";

export type AgentProviderDescriptor = {
  id: AgentProvider;
  displayName: string;
  command: string;
  installed: boolean;
};

export type AgentModelOption = {
  id: string;
  displayName: string;
  contextWindow: number | null;
  imageInput: boolean;
  thinkingEfforts: string[];
  defaultThinkingEffort: string | null;
};

export type AgentUsage = {
  contextTokens: number | null;
  sessionTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number | null;
  modelContextWindow: number | null;
};

export type AgentConversationSummary = {
  id: string;
  title: string;
  provider: AgentProvider;
  preview?: string;
  updatedAt: number;
  messageCount: number;
  interrupted: boolean;
};

export type AgentRateLimit = {
  id: string;
  label: string;
  window: string;
  usedPercent: number;
  remainingPercent: number;
  resetsAt: string | null;
  group: string | null;
};

export type ProviderReadiness = {
  status: "checking" | "ready" | "authRequired" | "missing" | "unsupported" | "unavailable";
  message: string;
  recovery: string;
  imageInput: boolean;
  imageTransport: boolean;
  model: string | null;
  models: AgentModelOption[];
  thinkingEffort: string | null;
  thinkingEfforts: string[];
  rateLimits?: AgentRateLimit[];
  stale?: boolean;
};

export type AgentRuntimePrefs = {
  version: number;
  provider: AgentProvider;
  models: Record<string, string>;
  thinkingEfforts: Record<string, string>;
  pinnedModels: Record<string, string[]>;
};

export type AgentActivityKind = "thinking" | "search" | "read" | "edit" | "command" | "other";

export type AgentActivity = {
  id: string;
  kind: AgentActivityKind;
  done: boolean;
  summary?: string | null;
  detail?: string | null;
};

export type AgentPendingPermission = {
  requestId: string;
  runId: number;
  engine: string;
  title: string;
  summary: string;
};

export type AgentTurnTiming = {
  runId: number;
  startedAtMs: number;
  firstTokenMs?: number | null;
  totalMs?: number | null;
};

export type AgentSnapshot = {
  runId: number;
  seq: number;
  status: AgentStatus;
  provider: AgentProvider;
  conversationId?: string;
  threadId: string | null;
  model: string | null;
  thinkingEffort: string | null;
  usage: AgentUsage | null;
  rateLimits?: AgentRateLimit[];
  messages: Array<{ id: string; role: "user" | "assistant"; text: string }>;
  activity: AgentActivity[];
  capture: AgentCapture;
  queuedFollowup?: string | null;
  pendingPermission?: AgentPendingPermission | null;
  turnTiming?: AgentTurnTiming | null;
  error: string | null;
};

export type AcceptedAgentRun = { runId: number };

export type AskAgentOptions = {
  model: string | null;
  thinkingEffort: string | null;
  mode?: LearningMode;
  profile?: AssistantProfile;
};
