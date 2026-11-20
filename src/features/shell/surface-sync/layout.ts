import type { NotchHost, NotchSurface } from "../../../platform/tauri";
import { SHOULDER_PX, type NotchShape } from "../model/placement";

export type SurfaceSize = { width: number; height: number };
export const HOST_CAPACITY: SurfaceSize = { width: 550, height: 610 };
const fallbackLayouts = {
  agentCompact: [228, 40],
  agentReady: [526, 170],
  agentThinking: [526, 236],
  agentFull: [526, 346],
  agentError: [526, 270],
  settings: [526, 420],
} satisfies Record<NotchSurface, readonly [number, number]>;

export function surfaceLayout(
  surface: NotchSurface,
  shape: NotchShape,
  contentHeight: number | undefined,
  host: Pick<NotchHost, "width" | "height" | "layouts" | "scale" | "contentTop"> | null,
): SurfaceSize {
  const [width, baseHeight] = host?.layouts[surface] ?? fallbackLayouts[surface];
  const dynamic =
    (surface.startsWith("agent") && surface !== "agentCompact") || surface === "settings";
  const minimum = surface.startsWith("agent") && surface !== "agentCompact" ? 170 : 1;
  const height =
    dynamic && contentHeight !== undefined && Number.isFinite(contentHeight)
      ? Math.max(minimum, contentHeight) + (host?.contentTop ?? 0)
      : baseHeight;
  const bounds = host ?? HOST_CAPACITY;
  const scale = host?.scale ?? 1;
  const maxWidth = bounds.width - (shape === "attached" ? 2 * SHOULDER_PX : 0);
  return {
    width: Math.max(1, Math.min(Math.round(width * scale), Math.floor(maxWidth * scale))) / scale,
    height: Math.max(1, Math.min(Math.round(height * scale) / scale, bounds.height)),
  };
}
