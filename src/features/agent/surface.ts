import type { AgentSnapshot, NotchSurface, ProviderReadiness } from "../../platform/tauri";
import { agentStatusLabel, captureIsWorking, capturePhaseLabel } from "./status";

export function resolveAgentSurface(
  snapshot: AgentSnapshot,
  installed: boolean | null,
  error: string | null,
): NotchSurface {
  if (snapshot.status === "approvalRequired") return "agentApproval";
  if (installed === false || snapshot.status === "failed" || error) return "agentError";
  if (snapshot.status === "starting") return "agentThinking";
  if (snapshot.status === "streaming" || snapshot.status === "stopping") return "agentFull";
  return snapshot.messages.length === 0 ? "agentReady" : "agentFull";
}

export function compactLabel(
  snapshot: AgentSnapshot,
  installed: boolean | null,
  error?: string | null,
  readiness?: ProviderReadiness["status"],
): string {
  if (captureIsWorking(snapshot.capture.phase)) return capturePhaseLabel(snapshot.capture.phase);
  if (snapshot.capture.phase === "failed") return "Capture failed";
  if (error) return "Attention";
  if (readiness === "authRequired") return "Sign in required";
  if (installed === false) return "Unavailable";
  if (snapshot.status === "completed") return "Answer ready";
  if (snapshot.status === "approvalRequired") return "Approval needed";
  return snapshot.provider === "pi" ? "Pi" : snapshot.provider === "agy" ? "Agy" : "Codex";
}

export function compactDetail(
  snapshot: AgentSnapshot,
  installed: boolean | null,
  readiness: ProviderReadiness,
  error?: string | null,
): string {
  const project = snapshot.cwd.split(/[\\/]/).filter(Boolean).pop() || "Local CLI";
  if (captureIsWorking(snapshot.capture.phase)) {
    return `${project} · ${capturePhaseLabel(snapshot.capture.phase)}`;
  }
  if (snapshot.capture.phase === "failed") {
    return `${project} · Retry or open settings`;
  }
  if (error) return `${project} · Connection issue`;
  if (installed === false) return `${project} · ${readiness.message}`;
  if (readiness.status === "checking")
    return `${project} · Checking ${snapshot.provider === "pi" ? "Pi" : snapshot.provider === "agy" ? "Agy" : "Codex"}`;
  if (snapshot.status === "idle") return `${project} · Ready`;
  return `${project} · ${agentStatusLabel(snapshot.status)}`;
}
