import { Channel, invoke, isTauri } from "@tauri-apps/api/core";

export type AgentStatus =
  | "idle"
  | "starting"
  | "streaming"
  | "stopping"
  | "completed"
  | "stopped"
  | "failed";

export type AgentSnapshot = {
  runId: number;
  seq: number;
  status: AgentStatus;
  cwd: string;
  threadId: string | null;
  messages: Array<{ id: string; role: "user" | "assistant"; text: string }>;
  error: string | null;
};

export type NotchSurface =
  | "idle"
  | "home"
  | "homeSettings"
  | "agentCompact"
  | "agentReady"
  | "agentThinking"
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
export async function askCodex(text: string, cwd: string): Promise<void> {
  await invoke("agent_ask", { text, cwd });
}
export async function stopCodex(): Promise<void> {
  await invoke("agent_stop");
}
export async function setNotchSurface(
  surface: NotchSurface,
  topOffset = 20,
  animate = true,
): Promise<void> {
  if (nativeAvailable) await invoke("notch_set_surface", { surface, topOffset, animate });
}
