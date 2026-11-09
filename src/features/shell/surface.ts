import type { NotchSurface } from "../../platform/tauri";

export function resolveSurface({
  expanded,
  isAgent,
  isMusic,
  page,
  agentSurface,
  osEvent,
}: {
  expanded: boolean;
  isAgent: boolean;
  isMusic: boolean;
  page: string;
  agentSurface: NotchSurface;
  osEvent: boolean;
}): NotchSurface {
  if (!expanded) {
    if (osEvent) return "osEvent";
    if (isMusic) return "musicCompact";
    return isAgent ? "agentCompact" : "idle";
  }
  if (page === "global-settings") return "homeSettings";
  if (page === "agent-settings") return "agentSettings";
  if (page === "home") return "home";
  if (isMusic) return "musicPlayer";
  return agentSurface;
}

export function shouldCollapseOnBlur(
  mode: "compact" | "preview" | "pinned",
  clickOutside: boolean,
): boolean {
  return mode === "pinned" && clickOutside;
}
