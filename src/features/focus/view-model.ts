import type { TimerPhase, TimerSnapshot, TimerStatus } from "../../platform/tauri/focus";

export const durationBounds = { minimum: 1, maximum: 120 } as const;

export const phaseChoices: ReadonlyArray<{ value: TimerPhase; label: string }> = [
  { value: "focus", label: "Focus" },
  { value: "short", label: "Short" },
  { value: "long", label: "Long" },
];

export function formatRemaining(remainingSeconds: number): string {
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function phaseLabel(phase: TimerPhase): string {
  if (phase === "short") return "Short break";
  if (phase === "long") return "Long break";
  return "Focus";
}

export function statusLabel(status: TimerStatus): string {
  if (status === "running") return "In progress";
  if (status === "paused") return "Paused";
  if (status === "completed") return "Completed";
  return "Ready";
}

export function timerHint(snapshot: TimerSnapshot): string {
  if (snapshot.status === "running") return `${phaseLabel(snapshot.phase)} · Keep going`;
  if (snapshot.status === "paused") return `${phaseLabel(snapshot.phase)} · Timer paused`;
  return `${phaseLabel(snapshot.phase)} · Ready to start`;
}

export function completedFocusCycle(completedFocusSessions: number): number {
  if (completedFocusSessions === 0) return 0;
  return ((completedFocusSessions - 1) % 4) + 1;
}

export function nextPhase(snapshot: TimerSnapshot): TimerPhase {
  if (snapshot.phase !== "focus") return "focus";
  return snapshot.completedFocusSessions % 4 === 0 ? "long" : "short";
}

export function nextActionLabel(snapshot: TimerSnapshot): string {
  return `Start ${phaseLabel(nextPhase(snapshot)).toLowerCase()}`;
}

export function completionTitle(snapshot: TimerSnapshot): string {
  return snapshot.phase === "focus" ? "Focus complete" : "Break complete";
}

export function completionHint(snapshot: TimerSnapshot): string {
  return snapshot.phase === "focus"
    ? `${phaseLabel(nextPhase(snapshot))} is ready when you are.`
    : "Return to focus when you are ready.";
}

export function durationNote(status: TimerStatus): string {
  if (status === "running" || status === "paused") {
    return "Changes apply to the next session. Current countdown stays unchanged.";
  }
  return "Current ready timer uses the selected duration. Breaks start manually.";
}

export function clampDuration(value: number): number {
  return Math.min(durationBounds.maximum, Math.max(durationBounds.minimum, value));
}
