import type { MediaSnapshot } from "../../platform/tauri/media";

export function trackKey(snapshot: MediaSnapshot): string {
  return JSON.stringify([
    snapshot.sourceId ?? null,
    snapshot.title,
    snapshot.artist,
    snapshot.album ?? null,
    snapshot.durationMs,
    snapshot.sessionRevision ?? null,
  ]);
}

export type LyricLine = { timeMs: number; text: string };

export function parseLyrics(value: string | null): LyricLine[] {
  const lines: LyricLine[] = [];
  const seen = new Set<string>();
  for (const row of (value ?? "").split(/\r?\n/).slice(0, 2000)) {
    const text = row.replace(/\[\d{1,4}:\d{2}(?:\.\d{1,3})?\]/g, "").trim();
    if (!text) continue;
    for (const stamp of row.matchAll(/\[(\d{1,4}):(\d{2})(?:\.(\d{1,3}))?\]/g)) {
      const seconds = Number(stamp[2]);
      if (seconds >= 60) continue;
      const timeMs =
        (Number(stamp[1]) * 60 + seconds) * 1000 + Number((stamp[3] ?? "").padEnd(3, "0"));
      const identity = `${timeMs}:${text.slice(0, 2000)}`;
      if (seen.has(identity) || lines.length >= 2000) continue;
      seen.add(identity);
      lines.push({ timeMs, text: text.slice(0, 2000) });
    }
  }
  return lines.sort((a, b) => a.timeMs - b.timeMs);
}

export function playbackPosition(snapshot: MediaSnapshot, now: number): number {
  const position = snapshot.positionMs ?? 0;
  const rate = snapshot.playbackRate ?? 1;
  const elapsed =
    snapshot.playback === "playing" && snapshot.observedAtMs != null && rate > 0 && rate <= 16
      ? Math.max(0, now - snapshot.observedAtMs) * rate
      : 0;
  return Math.max(0, Math.min(snapshot.durationMs ?? Number.MAX_SAFE_INTEGER, position + elapsed));
}

export function formatPlaybackTime(positionMs: number): string {
  const seconds = Math.floor(positionMs / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
