import type { AgentSnapshot, ProviderReadiness } from "../../platform/tauri";
import { agentStatusLabel } from "./status";

// Resolve the notch surface from the shell page and the run state. One owner
// for the decision, so both the window size and the rendered content agree.
// The Rust side only knows sizes; this mapping must not drift from it.
// Derive the compact capsule copy from the run state in one place.
export function compactLabel(snapshot: AgentSnapshot, installed: boolean | null): string {
  if (installed === false) return "Unavailable";
  if (snapshot.status === "completed") return "Answer ready";
  if (snapshot.status === "approvalRequired") return "Approval needed";
  return "Codex";
}

export function compactDetail(snapshot: AgentSnapshot, installed: boolean | null, readiness: ProviderReadiness): string {
  const project = snapshot.cwd.split(/[\\/]/).filter(Boolean).pop() || "Local CLI";
  if (installed === false) return `${project} · ${readiness.message}`;
  if (readiness.status === "checking") return `${project} · Checking Codex`;
  if (snapshot.status === "idle") return `${project} · Ready`;
  return `${project} · ${agentStatusLabel(snapshot.status)}`;
}
