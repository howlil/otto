import type { NotchSurface } from "../../../platform/tauri";

export function resolveSurface({
  expanded,
  page,
  agentSurface,
  compactCircle = false,
}: {
  expanded: boolean;
  page: string;
  agentSurface: NotchSurface;
  compactCircle?: boolean;
}): NotchSurface {
  if (!expanded) return compactCircle ? "agentCompactCircle" : "agentCompact";
  if (page === "settings") return "settings";
  return agentSurface;
}

export function shouldCollapseOnBlur(
  mode: "compact" | "preview" | "pinned",
  clickOutside: boolean,
): boolean {
  return mode === "pinned" && clickOutside;
}
