import type { AgentActivity, AgentActivityKind } from "../../../platform/tauri";

export type TrailItem = {
  key: string;
  kind?: AgentActivityKind;
  label: string;
  summary?: string;
  detail?: string;
  done: boolean;
};

export const MAX_VISIBLE_ACTIVE = 4;

const activityLabels: Record<AgentActivityKind, string> = {
  thinking: "Thinking",
  search: "Searching",
  read: "Reading context",
  edit: "Updating context",
  command: "Checking system",
  other: "Working",
};

function normalizeText(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function groupActivities(activity: AgentActivity[] | undefined): TrailItem[] {
  if (!Array.isArray(activity)) return [];
  const items: Array<TrailItem & { kind: AgentActivityKind; count: number }> = [];
  for (const entry of activity) {
    const summary = normalizeText(entry.summary);
    const detail = normalizeText(entry.detail);
    const last = items.at(-1);
    const mergeable = !summary && !detail && last && !last.summary && !last.detail;
    if (mergeable && last.kind === entry.kind) {
      last.count += 1;
      last.done = last.done && entry.done;
      last.label = `${activityLabels[entry.kind]} ×${last.count}`;
    } else {
      items.push({
        key: entry.id,
        kind: entry.kind,
        count: 1,
        done: entry.done,
        label: activityLabels[entry.kind],
        summary,
        detail,
      });
    }
  }
  return items;
}

export function buildActiveTrail(
  observed: string[],
  activity: AgentActivity[],
  current: string | null,
): TrailItem[] {
  const grouped = groupActivities(activity);
  const running = grouped.some((item) => !item.done);
  const items: TrailItem[] = [
    ...observed.map((label) => ({ key: `observed:${label}`, label, done: true })),
    ...grouped,
  ];
  if (current && !running) items.push({ key: `current:${current}`, label: current, done: false });
  return items;
}

export function buildCompletedTrail(activity: AgentActivity[]): TrailItem[] {
  return groupActivities(activity);
}

export function buildTrail(
  observed: string[],
  activity: AgentActivity[],
  current: string | null,
): TrailItem[] {
  return buildActiveTrail(observed, activity, current).slice(-MAX_VISIBLE_ACTIVE);
}

export function stepCountLabel(count: number): string {
  return count === 1 ? "1 step" : `${count} steps`;
}
