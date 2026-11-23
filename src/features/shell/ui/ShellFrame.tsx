import type { CSSProperties, ReactNode, RefObject } from "react";
import type { HostAnchor } from "../../../platform/tauri/shell";
import type { SurfaceSize } from "../surface-sync/useNotchSurfaceSync";
import type { BackgroundStyle, Placement } from "../model/preferences";
import type { RecoveryFrame } from "../surface-sync/useRenderedRegion";

const defaultAnchor: HostAnchor = { horizontal: "center", vertical: "top" };

function horizontalPositionStyle(
  horizontal: HostAnchor["horizontal"],
  correction: number,
): CSSProperties {
  if (horizontal === "left") return { left: 0 };
  if (horizontal === "right") return { right: 0 };
  return { left: 0, right: 0, marginInline: "auto", translate: `${correction}px` };
}

function stageAnchorStyle(
  recovery: RecoveryFrame | null | undefined,
  anchor: HostAnchor,
  correction: number,
): CSSProperties {
  if (recovery) {
    return {
      position: "absolute",
      margin: 0,
      left: recovery.region.body.x / recovery.scale,
      top: recovery.region.body.y / recovery.scale,
    };
  }
  if (anchor.horizontal === "center" && anchor.vertical === "top") {
    return { translate: `${correction}px` };
  }
  return {
    position: "absolute",
    ...(anchor.vertical === "bottom" ? { bottom: 0 } : { top: 0 }),
    ...horizontalPositionStyle(anchor.horizontal, correction),
  };
}

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
  expanded = false,
  surfaceOpacity = 100,
  backgroundStyle,
  anchor = defaultAnchor,
}: {
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
  surfaceOpacity?: number;
  backgroundStyle?: BackgroundStyle;
  anchor?: HostAnchor;
}) {
  const attached = placement === "attached" && gutter > 0;
  const effectiveAnchor = attached ? defaultAnchor : anchor;
  const defaultOrigin =
    effectiveAnchor.horizontal === "center" && effectiveAnchor.vertical === "top";
  const center = ((nativeSize?.width ?? size?.width ?? 0) - (size?.width ?? 0)) / 2;
  const correction = (Math.round(center * scale) - center * scale) / scale;
  const style: CSSProperties = {
    ["--otto-morph-duration" as string]: `${morphMs}ms`,
    ["--otto-surface-opacity" as string]: `${surfaceOpacity}%`,
    ...(recovery
      ? { ["--otto-shoulder" as string]: `${recovery.region.shoulder / recovery.scale}px` }
      : {}),
  };
  const anchoredStyle = stageAnchorStyle(recovery, effectiveAnchor, correction);
  const resolvedBackground: BackgroundStyle =
    backgroundStyle ?? (surfaceOpacity < 100 ? "blur" : "solid");
  return (
    <div
      className="relative h-full w-full"
      data-placement={attached ? "attached" : "floating"}
      data-background={resolvedBackground}
      data-sizing="mac-native"
      data-expanded={expanded ? "true" : "false"}
      data-anchor-x={effectiveAnchor.horizontal}
      data-anchor-y={effectiveAnchor.vertical}
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
          className={`pointer-events-auto h-full w-full transition-[width,height,translate] ease-otto ${defaultOrigin && !recovery ? "relative mx-auto" : ""}`}
          style={{
            width: size?.width,
            height: size?.height,
            transitionDuration: "var(--otto-morph-duration)",
            ...anchoredStyle,
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
