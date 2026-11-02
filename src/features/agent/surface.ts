import type { AgentSnapshot, NotchSurface, ProviderReadiness } from "../../platform/tauri";
import { agentStatusLabel, captureIsWorking, capturePhaseLabel } from "./status";

export function resolveAgentSurface(
  snapshot: AgentSnapshot,
  installed: boolean | null,
  error: string | null,
): NotchSurface {
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
  return snapshot.provider === "pi" ? "Pi" : snapshot.provider === "agy" ? "Agy" : "Codex";
}

export function compactDetail(
  snapshot: AgentSnapshot,
  installed: boolean | null,
  readiness: ProviderReadiness,
  error?: string | null,
): string {
  const provider =
    snapshot.provider === "pi" ? "Pi" : snapshot.provider === "agy" ? "Agy" : "Codex";
  if (captureIsWorking(snapshot.capture.phase)) {
    return `${provider} · ${capturePhaseLabel(snapshot.capture.phase)}`;
  }
  if (snapshot.capture.phase === "failed") {
    return `${provider} · Retry or open settings`;
  }
  if (error) return `${provider} · Connection issue`;
  if (installed === false) return `${provider} · ${readiness.message}`;
  if (readiness.status === "checking") return `${provider} · Open Agent to check`;
  if (snapshot.status === "idle") return `${provider} · Ready`;
  return `${provider} · ${agentStatusLabel(snapshot.status)}`;
}
