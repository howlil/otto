import { Channel, invoke, isTauri } from "@tauri-apps/api/core";

export type AgentStatus =
  | "idle"
  | "starting"
  | "streaming"
  | "approvalRequired"
  | "stopping"
  | "completed"
  | "stopped"
  | "failed";

export type AgentMode = "quickAsk" | "agentSession";
export type AgentProvider = "codex" | "pi" | "agy";
export type CaptureSource = "window" | "fullScreen";

export type ProviderReadiness = {
  status: "checking" | "ready" | "authRequired" | "missing" | "unsupported" | "unavailable";
  message: string;
  recovery: string;
  imageInput: boolean;
  imageTransport: boolean;
  agentSession: boolean;
};

export type AgentApproval = {
  approvalId: string;
  runId: number;
  kind: "command" | "fileChange" | "network";
  title: string;
  detail: string;
  reason: string | null;
};

export type AgentActivity = { kind: "command" | "fileChange"; summary: string };

export type AgentSnapshot = {
  runId: number;
  seq: number;
  status: AgentStatus;
  mode: AgentMode;
  provider: AgentProvider;
  cwd: string;
  threadId: string | null;
  messages: Array<{ id: string; role: "user" | "assistant"; text: string }>;
  activity?: AgentActivity;
  approval?: AgentApproval;
  error: string | null;
};

export type NotchSurface =
  | "idle"
  | "home"
  | "homeSettings"
  | "agentCompact"
  | "agentReady"
  | "agentThinking"
  | "agentApproval"
  | "agentFull"
  | "agentError"
  | "agentSettings";

export const nativeAvailable = isTauri();

export async function getAgentSnapshot(): Promise<AgentSnapshot> {
  return invoke<AgentSnapshot>("agent_snapshot");
}
export async function codexInstalled(): Promise<boolean> {
  return invoke<boolean>("agent_codex_installed");
}
export async function getCodexReadiness(cwd?: string): Promise<ProviderReadiness> {
  return invoke<ProviderReadiness>("agent_codex_readiness", { cwd });
}
export async function getAgentReadiness(
  provider: AgentProvider,
  cwd?: string,
): Promise<ProviderReadiness> {
  return invoke<ProviderReadiness>("agent_provider_readiness", { provider, cwd });
}
export type AgentSubscription = {
  channel: Channel<AgentSnapshot>;
  unsubscribe: () => Promise<void>;
};

export async function subscribeAgent(
  onSnapshot: (snapshot: AgentSnapshot) => void,
): Promise<AgentSubscription> {
  const channel = new Channel<AgentSnapshot>();
  channel.onmessage = onSnapshot;
  const subscriptionId = await invoke<number>("agent_subscribe", { onEvent: channel });
  return {
    channel,
    unsubscribe: () => invoke("agent_unsubscribe", { subscriptionId }),
  };
}
export async function selectAgentProvider(provider: AgentProvider): Promise<void> {
  await invoke("agent_select_provider", { provider });
}

export async function askAgent(
  text: string,
  cwd: string,
  mode: AgentMode,
  provider: AgentProvider,
): Promise<void> {
  await invoke("agent_ask", { text, cwd, mode, provider });
}
export async function decideAgentApproval(
  approvalId: string,
  decision: "allowOnce" | "deny",
): Promise<void> {
  await invoke("agent_decide_approval", { approvalId, decision });
}
export async function configureCaptureShortcut(shortcut: string): Promise<void> {
  await invoke("agent_configure_capture_shortcut", { shortcut });
}

export async function configureCaptureSource(source: CaptureSource): Promise<void> {
  await invoke("agent_configure_capture_source", { source });
}

export async function captureAgentNow(): Promise<void> {
  if (!nativeAvailable) throw new Error("Screen capture requires Otto on Windows.");
  await invoke("agent_capture_now");
}

export async function getCaptureTargetTitle(): Promise<string> {
  return invoke<string>("agent_capture_target_title");
}

export async function stopCodex(): Promise<void> {
  await invoke("agent_stop");
}
export async function newAgentSession(): Promise<void> {
  await invoke("agent_new_session");
}

export async function onNotchFocusChanged(
  onFocus: (focused: boolean) => void,
): Promise<() => void> {
  if (!nativeAvailable) return () => {};
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow().onFocusChanged(({ payload }) => onFocus(payload));
}

export async function setNotchSurface(
  surface: NotchSurface,
  topOffset = 20,
  animate = true,
  contentHeight?: number,
): Promise<void> {
  if (nativeAvailable) await invoke("notch_set_surface", { surface, topOffset, animate, contentHeight });
}
