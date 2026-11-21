import type { AgentSnapshot, ProviderReadiness } from "../../../platform/tauri";
import type { EyeExpression } from "../../../shared/ui";
import { agentIsWorking, captureIsWorking } from "./status";

export type CircleStateTone =
  | "idle"
  | "checking"
  | "capturing"
  | "listening"
  | "speaking"
  | "working"
  | "completed"
  | "attention"
  | "error";

export type CircleRingTone =
  | "idle"
  | "checking"
  | "capturing"
  | "listening"
  | "speaking"
  | "working"
  | "streaming"
  | "stopping"
  | "completed"
  | "attention"
  | "error";

export type CircleVoiceOverlay = {
  listening?: boolean;
  transcribing?: boolean;
  speaking?: boolean;
  error?: string | null;
};

export type CircleTransitionCue = "wake" | "shift" | "complete" | "attention" | "error" | "settle";

export type CircleStateDescriptor = {
  tone: CircleStateTone;
  ringTone: CircleRingTone;
  phaseKey: string;
  active: boolean;
  pipClass: string | null;
  cue: CircleTransitionCue;
  eyeExpression: EyeExpression;
};

function errorReason(snapshot: AgentSnapshot, installed: boolean | null, error: string | null) {
  if (snapshot.capture.phase === "failed") return "capture";
  if (snapshot.status === "failed") return "run";
  if (installed === false) return "missing";
  if (error) return "connection";
  return null;
}

function resolveActiveState(snapshot: AgentSnapshot): CircleStateDescriptor | null {
  if (captureIsWorking(snapshot.capture.phase)) {
    const startingCapture =
      snapshot.capture.phase === "preparing" || snapshot.capture.phase === "capturing";
    return {
      tone: "capturing",
      ringTone: "capturing",
      phaseKey: `capturing:${snapshot.capture.phase}`,
      active: true,
      pipClass: "bg-otto-hljs-function",
      cue: startingCapture ? "wake" : "shift",
      eyeExpression: "thinking",
    };
  }
  if (!agentIsWorking(snapshot.status) && snapshot.status !== "stopping") return null;
  const ringTone: CircleRingTone =
    snapshot.status === "streaming"
      ? "streaming"
      : snapshot.status === "stopping"
        ? "stopping"
        : "working";
  return {
    tone: "working",
    ringTone,
    phaseKey: `working:${snapshot.status}`,
    active: true,
    pipClass: snapshot.status === "stopping" ? "bg-otto-text-tertiary" : "bg-otto-text-bright",
    cue: snapshot.status === "starting" ? "wake" : "shift",
    eyeExpression: "working",
  };
}

function resolveRestState(
  snapshot: AgentSnapshot,
  readiness: ProviderReadiness,
): CircleStateDescriptor {
  if (readiness.status === "authRequired" || snapshot.status === "stopped") {
    const reason = readiness.status === "authRequired" ? "auth" : "stopped";
    return {
      tone: "attention",
      ringTone: "attention",
      phaseKey: `attention:${reason}`,
      active: false,
      pipClass: "bg-otto-warn",
      cue: "attention",
      eyeExpression: "attention",
    };
  }
  if (snapshot.status === "completed") {
    return {
      tone: "completed",
      ringTone: "completed",
      phaseKey: `completed:${snapshot.runId}`,
      active: false,
      pipClass: "bg-otto-ok",
      cue: "complete",
      eyeExpression: "completed",
    };
  }
  if (snapshot.status === "idle" && readiness.status === "checking") {
    return {
      tone: "checking",
      ringTone: "checking",
      phaseKey: "checking",
      active: true,
      pipClass: null,
      cue: "shift",
      eyeExpression: "thinking",
    };
  }
  return {
    tone: "idle",
    ringTone: "idle",
    phaseKey: "idle",
    active: false,
    pipClass: null,
    cue: "settle",
    eyeExpression: "idle",
  };
}

export function resolveCircleState(
  snapshot: AgentSnapshot,
  installed: boolean | null,
  readiness: ProviderReadiness,
  error: string | null,
  voice?: CircleVoiceOverlay,
): CircleStateDescriptor {
  if (voice?.listening) {
    return {
      tone: "listening",
      ringTone: "listening",
      phaseKey: "voice:listening",
      active: true,
      pipClass: "bg-otto-ok",
      cue: "wake",
      eyeExpression: "listening",
    };
  }
  if (voice?.transcribing) {
    return {
      tone: "working",
      ringTone: "working",
      phaseKey: "voice:transcribing",
      active: true,
      pipClass: "bg-otto-text-bright",
      cue: "shift",
      eyeExpression: "thinking",
    };
  }
  if (voice?.speaking) {
    return {
      tone: "speaking",
      ringTone: "speaking",
      phaseKey: "voice:speaking",
      active: true,
      pipClass: "bg-otto-ok",
      cue: "shift",
      eyeExpression: "speaking",
    };
  }
  const failure = errorReason(snapshot, installed, error) ?? (voice?.error ? "voice" : null);
  if (failure) {
    return {
      tone: "error",
      ringTone: "error",
      phaseKey: `error:${failure}`,
      active: false,
      pipClass: "bg-otto-danger",
      cue: "error",
      eyeExpression: "error",
    };
  }
  return resolveActiveState(snapshot) ?? resolveRestState(snapshot, readiness);
}

export function resolveCircleTransitionCue(
  previousPhaseKey: string,
  next: CircleStateDescriptor,
): CircleTransitionCue | null {
  if (previousPhaseKey === next.phaseKey) return null;
  return next.cue;
}
