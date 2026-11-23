import type { AgentSnapshot, ProviderReadiness } from "../../../platform/tauri";
import type { EyeExpression } from "../../../shared/ui";
import { agentIsWorking, captureIsWorking } from "./status";

export type CircleStateTone =
  | "idle"
  | "checking"
  | "capturing"
  | "working"
  | "completed"
  | "attention"
  | "error";

export type CircleRingTone =
  | "idle"
  | "checking"
  | "capturing"
  | "working"
  | "streaming"
  | "stopping"
  | "completed"
  | "attention"
  | "error";

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

type StateExtras = {
  ringTone?: CircleRingTone;
  active?: boolean;
  pipClass?: string | null;
  cue?: CircleTransitionCue;
};

function makeState(
  tone: CircleStateTone,
  phaseKey: string,
  eyeExpression: EyeExpression,
  extras: StateExtras = {},
): CircleStateDescriptor {
  return {
    tone,
    ringTone: extras.ringTone ?? tone,
    phaseKey,
    active: extras.active ?? false,
    pipClass: extras.pipClass ?? null,
    cue: extras.cue ?? "shift",
    eyeExpression,
  };
}

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
    return makeState("capturing", `capturing:${snapshot.capture.phase}`, "thinking", {
      active: true,
      pipClass: "bg-otto-hljs-function",
      cue: startingCapture ? "wake" : "shift",
    });
  }
  if (!agentIsWorking(snapshot.status) && snapshot.status !== "stopping") return null;
  const ringTone: CircleRingTone =
    snapshot.status === "streaming"
      ? "streaming"
      : snapshot.status === "stopping"
        ? "stopping"
        : "working";
  const pipClass = snapshot.status === "stopping" ? "bg-otto-text-tertiary" : "bg-otto-text-bright";
  return makeState("working", `working:${snapshot.status}`, "working", {
    ringTone,
    active: true,
    pipClass,
    cue: snapshot.status === "starting" ? "wake" : "shift",
  });
}

function resolveRestState(
  snapshot: AgentSnapshot,
  readiness: ProviderReadiness,
): CircleStateDescriptor {
  if (readiness.status === "authRequired" || snapshot.status === "stopped") {
    const reason = readiness.status === "authRequired" ? "auth" : "stopped";
    return makeState("attention", `attention:${reason}`, "attention", {
      pipClass: "bg-otto-warn",
      cue: "attention",
    });
  }
  if (snapshot.status === "completed") {
    return makeState("completed", `completed:${snapshot.runId}`, "completed", {
      pipClass: "bg-otto-ok",
      cue: "complete",
    });
  }
  if (snapshot.status === "idle" && readiness.status === "checking") {
    return makeState("checking", "checking", "thinking", { active: true });
  }
  return makeState("idle", "idle", "idle", { cue: "settle" });
}

export function resolveCircleState(
  snapshot: AgentSnapshot,
  installed: boolean | null,
  readiness: ProviderReadiness,
  error: string | null,
): CircleStateDescriptor {
  const failure = errorReason(snapshot, installed, error);
  if (failure) {
    return makeState("error", `error:${failure}`, "error", {
      pipClass: "bg-otto-danger",
      cue: "error",
    });
  }
  return resolveActiveState(snapshot) ?? resolveRestState(snapshot, readiness);
}

export function resolveCircleTransitionCue(
  previousPhaseKey: string,
  next: CircleStateDescriptor,
): CircleTransitionCue | null {
  return previousPhaseKey === next.phaseKey ? null : next.cue;
}
