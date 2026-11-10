import type { CSSProperties, ReactNode, RefObject } from "react";
import type { NotchHost } from "../../platform/tauri";
import type { SurfaceSize } from "./useNotchSurfaceSync";
import type { Placement } from "./preferences";
import type { RecoveryFrame } from "./surface-sync/useRenderedRegion";

export function ShellFrame({
  placement,
  gutter,
  size,
  nativeSize,
  scale = 1,
  morphMs,
  stageRef,
  children,
  recovery,
  sizingHost,
  expanded = false,
}: {
  sizingHost?: NotchHost | null;
  expanded?: boolean;
  placement: Placement;
  gutter: number;
  size: SurfaceSize | null;
  nativeSize: SurfaceSize | null;
  scale?: number;
  morphMs: number;
  stageRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
  recovery?: RecoveryFrame | null;
}) {
  const attached = placement === "attached" && gutter > 0;
  const center = ((nativeSize?.width ?? size?.width ?? 0) - (size?.width ?? 0)) / 2;
  const correction = (Math.round(center * scale) - center * scale) / scale;
  const style: CSSProperties = {
    ["--otto-morph-duration" as string]: `${morphMs}ms`,
    ["--otto-idle-width" as string]: `${sizingHost?.layouts.idle[0] ?? 185}px`,
    ["--otto-idle-height" as string]: `${(sizingHost?.layouts.idle[1] ?? 32) - (sizingHost?.contentTop ?? 0)}px`,
    ...(recovery
      ? { ["--otto-shoulder" as string]: `${recovery.region.shoulder / recovery.scale}px` }
      : {}),
  };
  return (
    <div
      className="relative h-full w-full"
      data-placement={attached ? "attached" : "floating"}
      data-sizing="mac-native"
      data-expanded={expanded ? "true" : "false"}
      style={style}
    >
      <div
        data-surface-window="true"
        className="pointer-events-none relative mx-auto overflow-hidden"
        style={{
          width: nativeSize?.width ?? size?.width,
          height: nativeSize?.height ?? size?.height,
        }}
      >
        <div
          ref={stageRef}
          data-surface-stage="true"
          className="pointer-events-auto relative mx-auto h-full w-full transition-[width,height,translate] ease-otto"
          style={{
            width: size?.width,
            height: size?.height,
            translate: recovery ? undefined : `${correction}px`,
            transitionDuration: "var(--otto-morph-duration)",
            ...(recovery
              ? {
                  position: "absolute",
                  margin: 0,
                  left: recovery.region.body.x / recovery.scale,
                  top: recovery.region.body.y / recovery.scale,
                }
              : {}),
          }}
        >
          {attached && (
            <>
              <span className="otto-shoulder-l" aria-hidden="true" />
              <span className="otto-shoulder-r" aria-hidden="true" />
            </>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}
