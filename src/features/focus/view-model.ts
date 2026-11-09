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
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
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
  const phase = snapshot.phase === "focus" ? "Focus session" : phaseLabel(snapshot.phase);
  if (snapshot.status === "running") return `${phase} · Keep going`;
  if (snapshot.status === "paused") return `${phase} · Timer paused`;
  return `${phase} · Ready to start`;
}

export function primaryActionLabel(snapshot: TimerSnapshot): string {
  if (snapshot.status === "completed") return nextActionLabel(snapshot);
  if (snapshot.status === "running") return "Pause timer";
  return snapshot.status === "paused" ? "Resume timer" : "Start timer";
}

export function compactPhaseLabel(snapshot: TimerSnapshot): string {
  if (snapshot.status === "completed")
    return snapshot.phase === "focus" ? "Session done" : "Break done";
  const phase = phaseLabel(snapshot.phase);
  return snapshot.status === "paused" ? `${phase} · Paused` : phase;
}

export function completedFocusCycle(snapshot: TimerSnapshot): number {
  const { completedFocusSessions, phase, status } = snapshot;
  const cycle = completedFocusSessions % 4;
  if (
    completedFocusSessions > 0 &&
    cycle === 0 &&
    (phase === "long" || (phase === "focus" && status === "completed"))
  )
    return 4;
  return cycle;
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
  return snapshot.phase === "focus" ? "Your focus session is complete." : "Your break is complete.";
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
