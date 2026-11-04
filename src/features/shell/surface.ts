import type { NotchSurface } from "../../platform/tauri";

export function resolveSurface({
  expanded,
  isAgent,
  page,
  agentSurface,
  osEvent,
}: {
  expanded: boolean;
  isAgent: boolean;
  page: string;
  agentSurface: NotchSurface;
  osEvent: boolean;
}): NotchSurface {
  if (!expanded) {
    if (osEvent) return "osEvent";
    return isAgent ? "agentCompact" : "idle";
  }
  if (page === "global-settings") return "homeSettings";
  if (page === "agent-settings") return "agentSettings";
  if (page === "home") return "home";
  return agentSurface;
}

export function shouldCollapseOnBlur(
  mode: "compact" | "preview" | "pinned",
  clickOutside: boolean,
): boolean {
  return mode === "pinned" && clickOutside;
}
