import type { CSSProperties } from "react";
import { ShellFrame, SurfaceError, surfaceOpacityPercent } from "../features/shell";
import type { RefObject } from "react";
import type {
  AppUpdateViewModel,
  RecoveryFrame,
  ShellViewModel,
  SurfaceSize,
} from "../features/shell";
import type { AgentViewModel } from "../features/agent";
import type { HostAnchor, NotchHost, NotchPlacement } from "../platform/tauri/shell";
import { ShellContent } from "./ShellContent";

function surfaceRadiusStyle(
  recovery: RecoveryFrame | null | undefined,
  compactRadius: number | undefined,
): CSSProperties {
  if (recovery) {
    return {
      borderTopLeftRadius: recovery.region.radius.top / recovery.scale,
      borderTopRightRadius: recovery.region.radius.top / recovery.scale,
      borderBottomLeftRadius: recovery.region.radius.bottom / recovery.scale,
      borderBottomRightRadius: recovery.region.radius.bottom / recovery.scale,
    };
  }
  return compactRadius !== undefined ? { borderRadius: compactRadius } : {};
}

function surfaceShapeClasses(attached: boolean, expanded: boolean): string {
  const radius = attached
    ? "rounded-t-none rounded-b-otto-attached border-t-transparent"
    : expanded
      ? "rounded-otto-expanded"
      : "rounded-otto-island";
  const press = expanded
    ? ""
    : attached
      ? "origin-top active:scale-[0.97]"
      : "origin-center active:scale-[0.97]";
  return `${radius} ${press}`.trim();
}

export function ShellView({
  agent,
  shell,
  surfaceError,
  gutter,
  size,
  nativeSize,
  scale = 1,
  morphMs,
  stageRef,
  onContentMeasured,
  appUpdate,
  placement = shell.placement.applied,
  anchor,
  recovery,
  onRetrySurface,
  sizingHost,
}: {
  sizingHost?: NotchHost | null;
  agent: AgentViewModel;
  shell: ShellViewModel;
  surfaceError: string | null;
  onContentMeasured: (height: number) => void;
  appUpdate: AppUpdateViewModel;
  gutter: number;
  size: SurfaceSize | null;
  nativeSize: SurfaceSize | null;
  scale?: number;
  morphMs: number;
  stageRef: RefObject<HTMLDivElement | null>;
  placement?: NotchPlacement;
  anchor?: HostAnchor;
  recovery?: RecoveryFrame | null;
  onRetrySurface?: () => void;
}) {
  const attached = placement === "attached";
  const compactRadius =
    !attached && !shell.expanded && size ? Math.min(size.width, size.height) / 2 : undefined;
  return (
    <ShellFrame
      placement={placement}
      gutter={gutter}
      size={size}
      nativeSize={nativeSize}
      scale={scale}
      morphMs={morphMs}
      stageRef={stageRef}
      recovery={recovery}
      expanded={shell.expanded}
      surfaceOpacity={surfaceOpacityPercent(shell.prefs)}
      backgroundStyle={shell.prefs.backgroundStyle}
      anchor={anchor}
    >
      <main
        className={`otto-shell-surface relative isolate h-full w-full cursor-grab overflow-hidden border border-otto-line bg-otto-surface-glass text-otto-text active:cursor-grabbing ${surfaceShapeClasses(attached, shell.expanded)}`}
        style={surfaceRadiusStyle(recovery, compactRadius)}
        data-reduced={shell.reducedMotion ? "true" : undefined}
        onPointerEnter={shell.handleEnter}
        onPointerLeave={shell.handleLeave}
        onKeyDown={(event) => {
          shell.handleEscape(event);
        }}
        onPointerDown={shell.handlePanelPointerDown}
        onPointerMove={shell.handlePanelPointerMove}
        onPointerUp={shell.handlePanelPointerUp}
        onPointerCancel={shell.handlePanelPointerUp}
      >
        <div className="absolute inset-x-0 bottom-0" style={{ top: sizingHost?.contentTop ?? 0 }}>
          <ShellContent
            agent={agent}
            shell={shell}
            onContentMeasured={onContentMeasured}
            appUpdate={appUpdate}
            anchor={attached ? undefined : anchor}
            frameSize={
              size
                ? {
                    width: size.width,
                    height: Math.max(1, size.height - (sizingHost?.contentTop ?? 0)),
                  }
                : size
            }
          />
          <SurfaceError message={surfaceError} expanded={shell.expanded} onRetry={onRetrySurface} />
        </div>
      </main>
    </ShellFrame>
  );
}
