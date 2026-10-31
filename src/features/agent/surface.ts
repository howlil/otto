import type { AgentSnapshot, NotchSurface } from "../../platform/tauri";
import { agentStatusLabel } from "./status";

// Resolve the notch surface from the shell page and the run state. One owner
// for the decision, so both the window size and the rendered content agree.
// The Rust side only knows sizes; this mapping must not drift from it.
export function resolveSurface({
  expanded,
  isAgent,
  page,
  installed,
  error,
  snapshot,
}: {
  expanded: boolean;
  isAgent: boolean;
  page: string;
  installed: boolean | null;
  error: string | null;
  snapshot: AgentSnapshot;
}): NotchSurface {
  if (!expanded) return isAgent ? "agentCompact" : "idle";
  if (page === "global-settings") return "homeSettings";
  if (page === "agent-settings") return "agentSettings";
  if (page === "home") return "home";
  if (installed === false || snapshot.status === "failed") return "agentError";
  // A pending approval outranks a transient error: hiding the card would leave
  // the provider waiting with no way to answer.
  if (snapshot.status === "approvalRequired") return "agentApproval";
  if (error) return "agentError";
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

export function compactDetail(snapshot: AgentSnapshot, installed: boolean | null): string {
  const project = snapshot.cwd.split(/[\\/]/).filter(Boolean).pop() || "Local CLI";
  if (installed === false) return `${project} · Codex not found`;
  if (snapshot.status === "idle") return `${project} · Ready`;
  return `${project} · ${agentStatusLabel(snapshot.status)}`;
}
