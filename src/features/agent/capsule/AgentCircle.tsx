import { useEffect, useState, type CSSProperties, type Ref } from "react";
import type { AgentSnapshot, ProviderReadiness } from "../../../platform/tauri";
import { OttoLogo, VisuallyHidden } from "../../../shared/ui";
import {
  resolveCircleState,
  resolveCircleTransitionCue,
  type CircleStateDescriptor,
  type CircleStateTone,
  type CircleTransitionCue,
  type CircleVoiceOverlay,
} from "../model/circle-state";
import { compactDetail, compactLabel } from "../model/surface";

const CIRCLE_CUE_DURATION_MS = 540;

export type AgentCircleVoiceProps = CircleVoiceOverlay & {
  level?: number;
  onStopListening?: () => void;
  onCancelListening?: () => void;
  onStopSpeaking?: () => void;
};

function logoMotionClass(state: CircleStateDescriptor, cue: CircleTransitionCue | null): string {
  if (cue === "error") return "otto-circle-logo-error";
  if (cue === "complete") return "otto-circle-logo-complete";
  if (cue === "wake" || cue === "shift" || cue === "attention") return "otto-circle-logo-shift";
  if (state.active) return "otto-circle-logo-active";
  return "";
}

function useCircleTransition(state: CircleStateDescriptor) {
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

  return transition;
}

function handleCircleContextMenu(
  event: React.MouseEvent<HTMLButtonElement>,
  voice?: AgentCircleVoiceProps,
  onToggleCompactStyle?: () => void,
) {
  if (voice?.listening && voice.onCancelListening) {
    event.preventDefault();
    voice.onCancelListening();
    return;
  }
  if (voice?.speaking && voice.onStopSpeaking) {
    event.preventDefault();
    voice.onStopSpeaking();
    return;
  }
  if (onToggleCompactStyle) {
    event.preventDefault();
    onToggleCompactStyle();
  }
}

export function AgentCircle({
  snapshot,
  installed,
  readiness,
  error,
  voice,
  buttonRef,
  onOpen,
  onToggleCompactStyle,
}: {
  snapshot: AgentSnapshot;
  installed: boolean | null;
  readiness: ProviderReadiness;
  error: string | null;
  voice?: AgentCircleVoiceProps;
  buttonRef: Ref<HTMLButtonElement>;
  onOpen: () => void;
  onToggleCompactStyle?: () => void;
}) {
  const state = resolveCircleState(snapshot, installed, readiness, error, voice);
  const transition = useCircleTransition(state);
  const voiceLevel = Math.max(0, Math.min(1, voice?.level ?? 0));
  const ringStyle: CSSProperties | undefined =
    voice?.listening && voiceLevel > 0
      ? { transform: `scale(${(1 + voiceLevel * 0.14).toFixed(3)})` }
      : undefined;

  return (
    <button
      ref={buttonRef}
      data-otto-drag-surface="true"
      data-circle-tone={state.tone}
      data-circle-phase={state.phaseKey}
      data-circle-motion={transition.cue ?? undefined}
      className="group relative flex h-full w-full items-center justify-center overflow-hidden rounded-full border-0 bg-transparent p-0 text-inherit [&_[data-otto-logo]]:bg-transparent"
      type="button"
      onClick={() => {
        if (voice?.listening && voice.onStopListening) voice.onStopListening();
        else onOpen();
      }}
      onContextMenu={(event) => handleCircleContextMenu(event, voice, onToggleCompactStyle)}
    >
      {state.ringTone !== "idle" && (
        <span
          aria-hidden="true"
          data-circle-ring={state.ringTone}
          style={ringStyle}
          className={`otto-circle-ring otto-circle-ring-${state.ringTone} pointer-events-none absolute inset-[1.5px] rounded-full transition-transform duration-75`}
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
        <OttoLogo compact expression={state.eyeExpression} expressive />
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
