import type { AgentModelOption, AgentTurnTiming } from "../../../platform/tauri";

export type PartitionedModels = {
  pinned: AgentModelOption[];
  rest: AgentModelOption[];
  filtered: AgentModelOption[];
};

export function sortAndFilterModels(
  models: AgentModelOption[],
  pinnedModels: readonly string[],
  query: string,
): PartitionedModels {
  const needle = query.trim().toLowerCase();
  const matched = needle
    ? models.filter(
        (option) =>
          option.displayName.toLowerCase().includes(needle) ||
          option.id.toLowerCase().includes(needle),
      )
    : models;
  const pinnedSet = new Set(pinnedModels);
  const pinnedMap = new Map<string, AgentModelOption>();
  const rest: AgentModelOption[] = [];
  for (const option of matched) {
    if (pinnedSet.has(option.id)) {
      pinnedMap.set(option.id, option);
    } else {
      rest.push(option);
    }
  }
  const pinned: AgentModelOption[] = [];
  for (const id of pinnedModels) {
    const option = pinnedMap.get(id);
    if (option) pinned.push(option);
  }
  return { pinned, rest, filtered: [...pinned, ...rest] };
}

export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(Math.round(ms / 100) / 10).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

export type LatencyDisplay = {
  label: string;
  detail: string;
};

export function formatLatencyMeta(
  timing: AgentTurnTiming | null | undefined,
  runId: number,
): LatencyDisplay | null {
  if (!timing || timing.runId !== runId || typeof timing.totalMs !== "number") return null;
  if (timing.totalMs < 0) return null;
  const total = formatDurationMs(timing.totalMs);
  const detail =
    typeof timing.firstTokenMs === "number" && timing.firstTokenMs >= 0
      ? `First token ${formatDurationMs(timing.firstTokenMs)} · Total ${total}`
      : `Completed in ${total}`;
  return { label: total, detail };
}
