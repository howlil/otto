import type { CSSProperties, ReactNode, RefObject } from "react";
import type { SurfaceSize } from "./useNotchSurfaceSync";
import type { Placement } from "./preferences";

export function ShellFrame({
  placement,
  gutter,
  size,
  nativeSize,
  morphMs,
  stageRef,
  children,
}: {
  placement: Placement;
  gutter: number;
  size: SurfaceSize | null;
  nativeSize: SurfaceSize | null;
  morphMs: number;
  stageRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  const attached = placement === "attached" && gutter > 0;
  const style: CSSProperties = {
    ...(attached ? { paddingLeft: gutter, paddingRight: gutter } : {}),
    ["--otto-morph-duration" as string]: `${morphMs}ms`,
  };
  return (
    <div
      className="relative h-full w-full"
      data-placement={attached ? "attached" : "floating"}
      style={style}
    >
      {attached && (
        <>
          <span className="otto-shoulder-l" aria-hidden="true" />
          <span className="otto-shoulder-r" aria-hidden="true" />
        </>
      )}
      <div
        data-surface-window="true"
        className="pointer-events-none relative mx-auto overflow-hidden bg-otto-surface"
        style={{
          width: nativeSize?.width ?? size?.width,
          height: nativeSize?.height ?? size?.height,
        }}
      >
        <div
          ref={stageRef}
          data-surface-stage="true"
          className="pointer-events-auto relative mx-auto h-full w-full overflow-hidden bg-otto-surface transition-[width,height] ease-otto"
          style={{
            width: size?.width,
            height: size?.height,
            transitionDuration: "var(--otto-morph-duration)",
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
