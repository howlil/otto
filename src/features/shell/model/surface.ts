import type { NotchSurface } from "../../../platform/tauri";

export function resolveSurface({
  expanded,
  page,
  agentSurface,
}: {
  expanded: boolean;
  page: string;
  agentSurface: NotchSurface;
}): NotchSurface {
  if (!expanded) return "agentCompact";
  if (page === "settings") return "settings";
  return agentSurface;
}

export function shouldCollapseOnBlur(
  mode: "compact" | "preview" | "pinned",
  clickOutside: boolean,
): boolean {
  return mode === "pinned" && clickOutside;
}
