import type { CSSProperties } from "react";
import { ShellFrame, SurfaceError } from "./features/shell";
import type { RefObject } from "react";
import type { SurfaceSize, useAppUpdate, useNotchShell } from "./features/shell";
import type { useAgent } from "./features/agent";
import type { FocusTimerModel } from "./features/focus";
import type { useMusic } from "./features/music";
import type { OsEventView, NotchPlacement } from "./platform/tauri";
import type { RecoveryFrame } from "./features/shell";
import { ShellContent } from "./ShellContent";
import { OttoLogoProvider } from "./shared/ui";

type AgentModel = ReturnType<typeof useAgent>;
type MusicModel = ReturnType<typeof useMusic>;
type FocusModel = FocusTimerModel;
type ShellModel = ReturnType<typeof useNotchShell>;

export function ShellView({
  agent,
  music,
  focus,
  shell,
  surfaceError,
  agentHomeCopy,
  musicHomeCopy,
  artProps,
  gutter,
  size,
  nativeSize,
  scale = 1,
  morphMs,
  stageRef,
  onContentMeasured,
  appUpdate,
  osEvent,
  onDismissOsEvent,
  placement = shell.placement.applied,
  compactRadius = 21,
  recovery,
  onRetrySurface,
}: {
  agent: AgentModel;
  music: MusicModel;
  focus: FocusModel;
  shell: ShellModel;
  surfaceError: string | null;
  agentHomeCopy: string;
  musicHomeCopy: string;
  onContentMeasured: (height: number) => void;
  appUpdate: ReturnType<typeof useAppUpdate>;
  gutter: number;
  size: SurfaceSize | null;
  nativeSize: SurfaceSize | null;
  scale?: number;
  morphMs: number;
  stageRef: RefObject<HTMLDivElement | null>;
  artProps: {
    tilt: number;
    gradient: number;
  };
  osEvent: OsEventView | null;
  onDismissOsEvent: () => void;
  placement?: NotchPlacement;
  compactRadius?: number;
  recovery?: RecoveryFrame | null;
  onRetrySurface?: () => void;
}) {
  const attached = placement === "attached";
  return (
    <OttoLogoProvider value={shell.prefs}>
      <ShellFrame
        placement={placement}
        gutter={gutter}
        size={size}
        nativeSize={nativeSize}
        scale={scale}
        morphMs={morphMs}
        stageRef={stageRef}
        recovery={recovery}
      >
        <main
          className={`relative isolate h-full w-full overflow-hidden border border-otto-line bg-otto-surface text-otto-text ${attached ? "rounded-t-none rounded-b-otto-attached border-t-transparent" : shell.expanded ? "rounded-otto-expanded" : "rounded-otto-island"} transition-[border-radius] duration-[var(--otto-morph-duration)] ease-otto`}
          style={
            {
              "--radius-otto-island": `${compactRadius}px`,
              ...(recovery
                ? {
                    borderTopLeftRadius: recovery.region.radius.top / recovery.scale,
                    borderTopRightRadius: recovery.region.radius.top / recovery.scale,
                    borderBottomLeftRadius: recovery.region.radius.bottom / recovery.scale,
                    borderBottomRightRadius: recovery.region.radius.bottom / recovery.scale,
                  }
                : {}),
            } as CSSProperties
          }
          data-reduced={shell.reducedMotion ? "true" : undefined}
          onPointerEnter={osEvent ? undefined : shell.handleEnter}
          onPointerLeave={shell.handleLeave}
          onKeyDown={(event) => {
            if (osEvent) {
              event.preventDefault();
              onDismissOsEvent();
              return;
            }
            shell.handleEscape(event);
          }}
          onPointerDown={() => {
            if (osEvent) {
              onDismissOsEvent();
              return;
            }
            if (shell.expanded && !shell.pinned) shell.pin();
          }}
        >
          <div className="absolute inset-0">
            <ShellContent
              agent={agent}
              music={music}
              focus={focus}
              shell={shell}
              agentHomeCopy={agentHomeCopy}
              musicHomeCopy={musicHomeCopy}
              artProps={artProps}
              onContentMeasured={onContentMeasured}
              appUpdate={appUpdate}
              osEvent={osEvent}
              frameSize={size}
            />
            <SurfaceError
              message={surfaceError}
              expanded={shell.expanded}
              onRetry={onRetrySurface}
            />
          </div>
        </main>
      </ShellFrame>
    </OttoLogoProvider>
  );
}
