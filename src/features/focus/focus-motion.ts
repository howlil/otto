import { useEffect, useRef, useState } from "react";
import type { TimerSnapshot } from "../../platform/tauri/focus";

type FocusSnapshotState = Pick<TimerSnapshot, "phase" | "status">;

export type FocusStatusMotion = "start" | "pause" | "reset" | "complete" | null;

export type FocusFeedbackMotion = {
  phaseKey: number;
  statusKey: number;
  statusMotion: FocusStatusMotion;
};

function statusMotionForTransition(
  previous: FocusSnapshotState,
  next: FocusSnapshotState,
): FocusStatusMotion {
  if (previous.status === next.status) return null;
  if (next.status === "running") return "start";
  if (next.status === "paused") return "pause";
  if (next.status === "completed") return "complete";
  if (next.status === "ready" && previous.phase === next.phase) return "reset";
  return null;
}

export function focusStatusMotionClass(motion: FocusStatusMotion): string {
  if (motion === "start") return "animate-otto-focus-start motion-reduce:animate-none";
  if (motion === "pause") return "animate-otto-focus-pause motion-reduce:animate-none";
  if (motion === "reset") return "animate-otto-focus-reset motion-reduce:animate-none";
  if (motion === "complete") return "animate-otto-focus-complete motion-reduce:animate-none";
  return "";
}

export function useFocusFeedbackMotion(snapshot: FocusSnapshotState): FocusFeedbackMotion {
  const { phase, status } = snapshot;
  const previous = useRef<FocusSnapshotState>({
    phase,
    status,
  });
  const [motion, setMotion] = useState<FocusFeedbackMotion>({
    phaseKey: 0,
    statusKey: 0,
    statusMotion: null,
  });

  useEffect(() => {
    const prior = previous.current;
    const next = { phase, status };
    const statusMotion = statusMotionForTransition(prior, next);
    const phaseChanged = prior.phase !== phase;
    previous.current = next;
    if (!statusMotion && !phaseChanged) return;
    setMotion((current) => ({
      phaseKey: phaseChanged ? current.phaseKey + 1 : current.phaseKey,
      statusKey: statusMotion ? current.statusKey + 1 : current.statusKey,
      statusMotion,
    }));
  }, [phase, status]);

  return motion;
}
