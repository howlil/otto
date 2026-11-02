import type { AgentConversationSummary, AgentProvider } from "../../platform/tauri";

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
export const TITLE_MAX = 120;

const providerLabels: Record<AgentProvider, string> = {
  codex: "Codex",
  pi: "Pi",
  agy: "Agy",
};

export function providerLabel(provider: AgentProvider): string {
  return providerLabels[provider];
}

export function orderConversations(
  conversations: readonly AgentConversationSummary[],
): AgentConversationSummary[] {
  return [...conversations].sort(
    (left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id),
  );
}

export function filterConversations(
  conversations: readonly AgentConversationSummary[],
  query: string,
): AgentConversationSummary[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...conversations];
  return conversations.filter((conversation) => conversation.title.toLowerCase().includes(needle));
}

export function normalizeTitle(raw: string): string | null {
  const title = raw.replace(/\s+/g, " ").trim();
  return title ? title.slice(0, TITLE_MAX) : null;
}

export function updatedLabel(updatedAt: number, now: number): string {
  const elapsed = Math.max(0, now - updatedAt);
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`;
  if (elapsed < 7 * DAY) return `${Math.floor(elapsed / DAY)}d ago`;
  return new Date(updatedAt).toISOString().slice(0, 10);
}

export function conversationDetail(conversation: AgentConversationSummary, now: number): string {
  const messages =
    conversation.messageCount === 1 ? "1 message" : `${conversation.messageCount} messages`;
  const parts = [
    providerLabel(conversation.provider),
    messages,
    updatedLabel(conversation.updatedAt, now),
  ];
  if (conversation.interrupted) parts.push("Interrupted");
  return parts.join(" · ");
}
