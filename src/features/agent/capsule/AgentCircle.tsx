import { useEffect, useState, type Ref } from "react";
import type { AgentSnapshot, ProviderReadiness } from "../../../platform/tauri";
import { OttoLogo, VisuallyHidden } from "../../../shared/ui";
import {
  resolveCircleState,
  resolveCircleTransitionCue,
  type CircleStateDescriptor,
  type CircleStateTone,
  type CircleTransitionCue,
} from "../model/circle-state";
import { compactDetail, compactLabel } from "../model/surface";

const CIRCLE_CUE_DURATION_MS = 540;

function logoMotionClass(state: CircleStateDescriptor, cue: CircleTransitionCue | null): string {
  if (cue === "error") return "otto-circle-logo-error";
  if (cue === "complete") return "otto-circle-logo-complete";
  if (cue === "wake" || cue === "shift" || cue === "attention") return "otto-circle-logo-shift";
  if (state.active) return "otto-circle-logo-active";
  return "";
}

export function AgentCircle({
  snapshot,
  installed,
  readiness,
  error,
  buttonRef,
  onOpen,
}: {
  snapshot: AgentSnapshot;
  installed: boolean | null;
  readiness: ProviderReadiness;
  error: string | null;
  buttonRef: Ref<HTMLButtonElement>;
  onOpen: () => void;
}) {
  const state = resolveCircleState(snapshot, installed, readiness, error);
  const [transition, setTransition] = useState<{
    phaseKey: string;
    id: number;
    cue: CircleTransitionCue | null;
    tone: CircleStateTone;
  }>({
    phaseKey: state.phaseKey,
    id: 0,
    cue: null,
    tone: state.tone,
  });

  if (transition.phaseKey !== state.phaseKey) {
    const cue = resolveCircleTransitionCue(transition.phaseKey, state);
    setTransition({
      phaseKey: state.phaseKey,
      id: transition.id + 1,
      cue,
      tone: state.tone,
    });
  }

  useEffect(() => {
    if (!transition.cue) return;
    const timer = setTimeout(() => {
      setTransition((current) =>
        current.id === transition.id ? { ...current, cue: null } : current,
      );
    }, CIRCLE_CUE_DURATION_MS);
    return () => clearTimeout(timer);
  }, [transition.cue, transition.id]);

  return (
    <button
      ref={buttonRef}
      data-otto-drag-surface="true"
      data-circle-tone={state.tone}
      data-circle-phase={state.phaseKey}
      data-circle-motion={transition.cue ?? undefined}
      className="group relative flex h-full w-full items-center justify-center overflow-hidden rounded-full border-0 bg-transparent p-0 text-inherit [&_[data-otto-logo]]:bg-transparent"
      type="button"
      onClick={onOpen}
    >
      {state.ringTone !== "idle" && (
        <span
          aria-hidden="true"
          data-circle-ring={state.ringTone}
          className={`otto-circle-ring otto-circle-ring-${state.ringTone} pointer-events-none absolute inset-[1.5px] rounded-full`}
        />
      )}
      {transition.cue && (
        <span
          key={transition.id}
          aria-hidden="true"
          data-circle-wave={transition.cue}
          className={`otto-circle-wave otto-circle-wave-${transition.tone} pointer-events-none absolute inset-[1px] rounded-full`}
        />
      )}
      <span
        key={transition.cue ? `logo-${transition.id}` : "logo-steady"}
        className={`relative z-10 flex items-center justify-center ${logoMotionClass(state, transition.cue)}`}
      >
        <OttoLogo compact />
      </span>
      {state.pipClass && (
        <span
          aria-hidden="true"
          data-circle-pip={state.tone}
          className={`pointer-events-none absolute bottom-[3px] left-1/2 z-20 h-1 w-1 -translate-x-1/2 rounded-full transition-colors duration-150 ${state.pipClass}`}
        />
      )}
      <VisuallyHidden>
        Open Agent. {compactLabel(snapshot, installed, error, readiness.status)}.{" "}
        {compactDetail(snapshot, installed, readiness, error)}
      </VisuallyHidden>
    </button>
  );
}
