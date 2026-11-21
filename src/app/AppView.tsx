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
import type { VoiceViewModel } from "../features/voice";
import type { NotchHost, NotchPlacement } from "../platform/tauri/shell";
import { ShellContent } from "./ShellContent";

export function ShellView({
  agent,
  shell,
  voice,
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
  recovery,
  onRetrySurface,
  sizingHost,
}: {
  sizingHost?: NotchHost | null;
  agent: AgentViewModel;
  shell: ShellViewModel;
  voice?: VoiceViewModel;
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
    >
      <main
        className={`otto-shell-surface relative isolate h-full w-full cursor-grab overflow-hidden border border-otto-line bg-otto-surface-glass text-otto-text active:cursor-grabbing ${attached ? "rounded-t-none rounded-b-otto-attached border-t-transparent" : shell.expanded ? "rounded-otto-expanded" : "rounded-otto-island"} ${shell.expanded ? "" : attached ? "origin-top active:scale-[0.97]" : "origin-center active:scale-[0.97]"}`}
        style={
          {
            ...(recovery
              ? {
                  borderTopLeftRadius: recovery.region.radius.top / recovery.scale,
                  borderTopRightRadius: recovery.region.radius.top / recovery.scale,
                  borderBottomLeftRadius: recovery.region.radius.bottom / recovery.scale,
                  borderBottomRightRadius: recovery.region.radius.bottom / recovery.scale,
                }
              : compactRadius !== undefined
                ? { borderRadius: compactRadius }
                : {}),
          } as CSSProperties
        }
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
            voice={voice}
            onContentMeasured={onContentMeasured}
            appUpdate={appUpdate}
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
