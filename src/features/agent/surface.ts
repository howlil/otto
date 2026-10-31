import type { AgentSnapshot, NotchSurface, ProviderReadiness } from "../../platform/tauri";
import { agentStatusLabel } from "./status";

// Agent owns the mapping from CLI state to its own expanded surface.
// Shell chooses the active page and whether the island is compact.
export function resolveAgentSurface(
  snapshot: AgentSnapshot,
  installed: boolean | null,
  error: string | null,
): NotchSurface {
  // A waiting approval must stay reachable even when a transient error exists.
  if (snapshot.status === "approvalRequired") return "agentApproval";
  if (installed === false || snapshot.status === "failed" || error) return "agentError";
  if (snapshot.status === "starting") return "agentThinking";
  if (snapshot.status === "streaming" || snapshot.status === "stopping") return "agentFull";
  return snapshot.messages.length === 0 ? "agentReady" : "agentFull";
}

// Derive the compact capsule copy from the run state in one place.
export function compactLabel(snapshot: AgentSnapshot, installed: boolean | null): string {
  if (installed === false) return "Unavailable";
  if (snapshot.status === "completed") return "Answer ready";
  if (snapshot.status === "approvalRequired") return "Approval needed";
  return "Codex";
}

export function compactDetail(
  snapshot: AgentSnapshot,
  installed: boolean | null,
  readiness: ProviderReadiness,
): string {
  const project = snapshot.cwd.split(/[\\/]/).filter(Boolean).pop() || "Local CLI";
  if (installed === false) return `${project} · ${readiness.message}`;
  if (readiness.status === "checking") return `${project} · Checking Codex`;
  if (snapshot.status === "idle") return `${project} · Ready`;
  return `${project} · ${agentStatusLabel(snapshot.status)}`;
}
