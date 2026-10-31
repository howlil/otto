import type { AgentSnapshot, NotchSurface } from "../../platform/tauri";

// Shell owns the native surface variant for Home, Settings and Agent.
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
