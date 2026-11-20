import type {
  AgentProvider,
  AgentRateLimit,
  AgentSnapshot,
  ProviderReadiness,
} from "../../../platform/tauri";

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

function windowSortRank(window: string): number {
  const normalized = window.toLowerCase();
  if (normalized === "5h") return 0;
  if (normalized === "weekly" || normalized === "7d") return 1;
  return 2;
}

export function resolveRateLimits(
  provider: AgentProvider | undefined,
  readiness: ProviderReadiness | undefined,
  snapshot: Pick<AgentSnapshot, "provider" | "rateLimits"> | null | undefined,
): AgentRateLimit[] {
  const merged = new Map<string, AgentRateLimit>();
  for (const item of readiness?.rateLimits ?? []) {
    merged.set(item.id, item);
  }
  const snapshotMatches = !provider || !snapshot?.provider || snapshot.provider === provider;
  if (snapshotMatches) {
    for (const item of snapshot?.rateLimits ?? []) {
      merged.set(item.id, item);
    }
  }
  return Array.from(merged.values()).sort(
    (left, right) =>
      (left.group ?? "").localeCompare(right.group ?? "") ||
      windowSortRank(left.window) - windowSortRank(right.window) ||
      left.id.localeCompare(right.id),
  );
}

export function rateLimitTone(usedPercent: number) {
  if (usedPercent >= 95) {
    return { bar: "bg-otto-danger", text: "text-otto-danger" };
  }
  if (usedPercent >= 80) {
    return { bar: "bg-otto-warn", text: "text-otto-warn" };
  }
  return { bar: "bg-otto-line-focused", text: "text-otto-text-secondary" };
}

export function formatResetTime(
  resetsAt: string | null | undefined,
  now = Date.now(),
): string | null {
  if (!resetsAt) return null;
  const targetMs = Date.parse(resetsAt);
  if (!Number.isFinite(targetMs)) return null;
  const remaining = targetMs - now;
  if (remaining <= 0) return "Resets soon";
  if (remaining < MINUTE) return "Resets in <1m";
  if (remaining < HOUR) return `Resets in ${Math.ceil(remaining / MINUTE)}m`;
  if (remaining < DAY) {
    const hours = Math.floor(remaining / HOUR);
    const mins = Math.floor((remaining % HOUR) / MINUTE);
    return mins > 0 ? `Resets in ${hours}h ${mins}m` : `Resets in ${hours}h`;
  }
  const days = Math.floor(remaining / DAY);
  const hours = Math.floor((remaining % DAY) / HOUR);
  return hours > 0 ? `Resets in ${days}d ${hours}h` : `Resets in ${days}d`;
}

export function rateLimitDisplayLabel(limit: AgentRateLimit, compact = false): string {
  const base = compact
    ? limit.window === "5h"
      ? "5h"
      : limit.window === "weekly"
        ? "Weekly"
        : limit.label
    : limit.label;
  return limit.group ? `${limit.group} · ${base}` : base;
}
