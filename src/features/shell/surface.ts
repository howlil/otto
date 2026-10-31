import type { NotchSurface } from "../../platform/tauri";

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
