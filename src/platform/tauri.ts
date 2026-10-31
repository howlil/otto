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
export async function subscribeAgent(
  onSnapshot: (snapshot: AgentSnapshot) => void,
): Promise<Channel<AgentSnapshot>> {
  const channel = new Channel<AgentSnapshot>();
  channel.onmessage = onSnapshot;
  await invoke("agent_subscribe", { onEvent: channel });
  return channel;
}
export async function askCodex(text: string, cwd: string, mode: AgentMode): Promise<void> {
  await invoke("agent_ask", { text, cwd, mode });
}
export async function decideAgentApproval(
  approvalId: string,
  decision: "allowOnce" | "deny",
): Promise<void> {
  await invoke("agent_decide_approval", { approvalId, decision });
}
export async function stopCodex(): Promise<void> {
  await invoke("agent_stop");
}
export async function newAgentSession(): Promise<void> {
  await invoke("agent_new_session");
}
export async function setNotchSurface(
  surface: NotchSurface,
  topOffset = 20,
  animate = true,
): Promise<void> {
  if (nativeAvailable) await invoke("notch_set_surface", { surface, topOffset, animate });
}
