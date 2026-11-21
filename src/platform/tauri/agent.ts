import { Channel, invoke } from "@tauri-apps/api/core";
import { toGuidancePayload } from "./agent-guidance";
import type {
  AcceptedAgentRun,
  AgentConversationSummary,
  AgentProvider,
  AgentProviderDescriptor,
  AgentSnapshot,
  AskAgentOptions,
  ProviderReadiness,
} from "./agent-types";

export type * from "./agent-types";

export type AgentSubscription = {
  channel: Channel<AgentSnapshot>;
  unsubscribe: () => Promise<void>;
};

export async function getAgentSnapshot(): Promise<AgentSnapshot> {
  return invoke<AgentSnapshot>("agent_snapshot");
}

export async function listAgentHistory(): Promise<AgentConversationSummary[]> {
  return invoke<AgentConversationSummary[]>("agent_history_list");
}

export async function openAgentHistory(id: string): Promise<AgentSnapshot> {
  return invoke<AgentSnapshot>("agent_history_open", { conversationId: id });
}

export async function renameAgentHistory(id: string, title: string): Promise<void> {
  await invoke("agent_history_rename", { conversationId: id, title });
}

export async function deleteAgentHistory(id: string): Promise<void> {
  await invoke("agent_history_delete", { conversationId: id });
}

export async function deleteAllAgentHistory(): Promise<void> {
  await invoke("agent_history_delete_all");
}

export async function listAgentProviders(): Promise<AgentProviderDescriptor[]> {
  return invoke<AgentProviderDescriptor[]>("agent_provider_catalog");
}

export async function getAgentReadiness(
  provider: AgentProvider,
  requestId: number,
  model: string | null = null,
  force = false,
): Promise<ProviderReadiness> {
  return invoke<ProviderReadiness>("agent_provider_readiness", {
    provider,
    model,
    requestId,
    ...(force ? { force: true } : {}),
  });
}

export async function cancelAgentReadiness(requestId: number): Promise<void> {
  await invoke("agent_cancel_provider_readiness", { requestId });
}

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

export async function selectAgentRuntimeOptions(
  model: string | null,
  thinkingEffort: string | null,
): Promise<void> {
  await invoke("agent_select_runtime_options", { model, thinkingEffort });
}

export async function askAgent(
  text: string,
  provider: AgentProvider,
  options: AskAgentOptions,
): Promise<AcceptedAgentRun> {
  const { mode, profile, model, thinkingEffort } = options;
  return invoke<AcceptedAgentRun>("agent_ask", {
    text,
    provider,
    model,
    thinkingEffort,
    ...(mode ? { mode } : {}),
    ...(profile ? { profile: toGuidancePayload(profile) } : {}),
  });
}

export async function stopAgent(): Promise<void> {
  await invoke("agent_stop");
}

export async function newAgentChat(): Promise<void> {
  await invoke("agent_new_chat");
}
