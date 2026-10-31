import type { NotchSurface } from "../../platform/tauri";

// Shell owns the native surface for the active page. Agent owns its own
// status-specific surface descriptor, passed in by the App composition root.
export function resolveSurface({
  expanded,
  isAgent,
  page,
  agentSurface,
}: {
  expanded: boolean;
  isAgent: boolean;
  page: string;
  agentSurface: NotchSurface;
}): NotchSurface {
  if (!expanded) return isAgent ? "agentCompact" : "idle";
  if (page === "global-settings") return "homeSettings";
  if (page === "agent-settings") return "agentSettings";
  if (page === "home") return "home";
  return agentSurface;
}
