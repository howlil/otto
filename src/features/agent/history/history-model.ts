import type { AgentConversationSummary, AgentProvider } from "../../../platform/tauri";

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
export const TITLE_MAX = 120;

export type HistoryDateBucket = "Today" | "Yesterday" | "Earlier this week" | "Older";

export type HistoryConversationGroup = {
  label: HistoryDateBucket;
  items: AgentConversationSummary[];
};

const providerLabels: Record<AgentProvider, string> = {
  codex: "Codex",
  pi: "Pi",
  agy: "Agy",
  opencode: "OpenCode",
  claude: "Claude Code",
  gemini: "Gemini CLI",
  copilot: "GitHub Copilot",
  qwen: "Qwen Code",
  cursor: "Cursor Agent",
  goose: "Goose",
  vibe: "Mistral Vibe",
  amp: "Amp",
  kilo: "Kilo Code",
  junie: "Junie",
  cline: "Cline",
  augment: "Augment Code",
  droid: "Factory Droid",
  grok: "Grok Build",
  devin: "Devin",
};

export function providerLabel(provider: AgentProvider): string {
  return providerLabels[provider];
}

export function toTimestampMs(updatedAt: number): number {
  return updatedAt > 0 && updatedAt < 1_000_000_000_000 ? updatedAt * 1000 : updatedAt;
}

export function orderConversations(
  conversations: readonly AgentConversationSummary[],
): AgentConversationSummary[] {
  return [...conversations].sort(
    (left, right) =>
      toTimestampMs(right.updatedAt) - toTimestampMs(left.updatedAt) ||
      left.id.localeCompare(right.id),
  );
}

export function filterConversations(
  conversations: readonly AgentConversationSummary[],
  query: string,
): AgentConversationSummary[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [...conversations];
  return conversations.filter((conversation) => {
    const searchable = [
      conversation.title,
      conversation.preview ?? "",
      providerLabel(conversation.provider),
      conversation.provider,
      conversation.interrupted ? "interrupted" : "",
    ]
      .join(" ")
      .toLowerCase();
    return tokens.every((token) => searchable.includes(token));
  });
}

export function normalizeTitle(raw: string): string | null {
  const title = raw.replace(/\s+/g, " ").trim();
  return title ? title.slice(0, TITLE_MAX) : null;
}

export function conversationPreview(conversation: AgentConversationSummary): string | null {
  const preview = (conversation.preview ?? "").replace(/\s+/g, " ").trim();
  if (!preview) return null;
  const title = conversation.title.replace(/\s+/g, " ").trim();
  if (preview.toLowerCase() === title.toLowerCase()) return null;
  return preview;
}

export function updatedLabel(updatedAt: number, now: number): string {
  const updatedMs = toTimestampMs(updatedAt);
  const elapsed = Math.max(0, now - updatedMs);
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`;
  if (elapsed < 7 * DAY) return `${Math.floor(elapsed / DAY)}d ago`;
  return new Date(updatedMs).toISOString().slice(0, 10);
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

function classifyDateBucket(updatedAt: number, now: number): HistoryDateBucket {
  const updatedMs = toTimestampMs(updatedAt);
  const nowDate = new Date(now);
  const todayStart = new Date(
    nowDate.getFullYear(),
    nowDate.getMonth(),
    nowDate.getDate(),
  ).getTime();
  const yesterdayStart = todayStart - DAY;
  const weekStart = todayStart - 6 * DAY;
  if (updatedMs >= todayStart || now - updatedMs < DAY) return "Today";
  if (updatedMs >= yesterdayStart) return "Yesterday";
  if (updatedMs >= weekStart) return "Earlier this week";
  return "Older";
}

export function groupConversationsByDate(
  conversations: readonly AgentConversationSummary[],
  now: number,
): HistoryConversationGroup[] {
  const buckets = new Map<HistoryDateBucket, AgentConversationSummary[]>();
  for (const conversation of conversations) {
    const label = classifyDateBucket(conversation.updatedAt, now);
    const group = buckets.get(label);
    if (group) group.push(conversation);
    else buckets.set(label, [conversation]);
  }
  const order: HistoryDateBucket[] = ["Today", "Yesterday", "Earlier this week", "Older"];
  return order
    .filter((label) => buckets.has(label))
    .map((label) => ({ label, items: buckets.get(label) ?? [] }));
}
