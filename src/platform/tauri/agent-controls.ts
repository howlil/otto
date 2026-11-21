import { invoke } from "@tauri-apps/api/core";
import { toGuidancePayload } from "./agent-guidance";
import type {
  AcceptedAgentRun,
  AgentConversationSummary,
  AgentProvider,
  AgentProviderDescriptor,
  AgentRuntimePrefs,
  AskAgentOptions,
} from "./agent-types";

export async function searchAgentHistory(query?: string): Promise<AgentConversationSummary[]> {
  const trimmed = query?.trim();
  return invoke<AgentConversationSummary[]>(
    "agent_history_list",
    trimmed ? { query: trimmed } : {},
  );
}

export async function exportAgentHistoryMarkdown(id: string): Promise<string> {
  return invoke<string>("agent_history_export_markdown", { conversationId: id });
}

export async function retryAgentLastTurn(
  provider: AgentProvider,
  options: AskAgentOptions,
): Promise<AcceptedAgentRun> {
  const { mode, profile, model, thinkingEffort } = options;
  return invoke<AcceptedAgentRun>("agent_retry_last", {
    provider,
    model,
    thinkingEffort,
    ...(mode ? { mode } : {}),
    ...(profile ? { profile: toGuidancePayload(profile) } : {}),
  });
}

export async function editAndRerunAgentTurn(
  messageId: string,
  text: string,
  provider: AgentProvider,
  options: AskAgentOptions,
): Promise<AcceptedAgentRun> {
  const { mode, profile, model, thinkingEffort } = options;
  return invoke<AcceptedAgentRun>("agent_edit_and_rerun", {
    messageId,
    text,
    options: {
      provider,
      model,
      thinkingEffort,
      ...(mode ? { mode } : {}),
      ...(profile ? { profile: toGuidancePayload(profile) } : {}),
    },
  });
}

export async function queueAgentFollowup(
  text: string,
  provider: AgentProvider,
  options: AskAgentOptions,
): Promise<string> {
  const { mode, profile, model, thinkingEffort } = options;
  return invoke<string>("agent_queue_followup", {
    text,
    provider,
    model,
    thinkingEffort,
    ...(mode ? { mode } : {}),
    ...(profile ? { profile: toGuidancePayload(profile) } : {}),
  });
}

export async function clearQueuedAgentFollowup(): Promise<string | null> {
  return invoke<string | null>("agent_clear_queued_followup");
}

export async function respondAgentPermission(requestId: string, allow: boolean): Promise<void> {
  return invoke("agent_respond_permission", { requestId, allow });
}

export async function refreshAgentProviders(): Promise<AgentProviderDescriptor[]> {
  return invoke<AgentProviderDescriptor[]>("agent_refresh_provider_catalog");
}

export async function getAgentRuntimePrefs(): Promise<AgentRuntimePrefs> {
  return invoke<AgentRuntimePrefs>("agent_runtime_prefs");
}

export async function togglePinnedAgentModel(
  provider: AgentProvider,
  modelId: string,
): Promise<string[]> {
  return invoke<string[]>("agent_toggle_pinned_model", { provider, modelId });
}

export async function warmAgentProvider(): Promise<void> {
  return invoke("agent_warm_provider");
}
