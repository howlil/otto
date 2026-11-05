import type { CSSProperties } from "react";
import { ShellFrame, SurfaceError } from "./features/shell";
import type { RefObject } from "react";
import { morphMilliseconds } from "./features/shell";
import type { SurfaceSize, useAppUpdate, useNotchShell } from "./features/shell";
import type { useAgent } from "./features/agent";
import type { OsEventView } from "./platform/tauri";
import { ShellContent } from "./ShellContent";

type AgentModel = ReturnType<typeof useAgent>;
type ShellModel = ReturnType<typeof useNotchShell>;

export function ShellView({
  agent,
  shell,
  surfaceError,
  agentHomeCopy,
  artProps,
  gutter,
  size,
  nativeSize,
  morphMs,
  stageRef,
  onContentMeasured,
  appUpdate,
  osEvent,
  onDismissOsEvent,
}: {
  agent: AgentModel;
  shell: ShellModel;
  surfaceError: string | null;
  agentHomeCopy: string;
  onContentMeasured: (height: number) => void;
  appUpdate: ReturnType<typeof useAppUpdate>;
  gutter: number;
  size: SurfaceSize | null;
  nativeSize: SurfaceSize | null;
  morphMs: number;
  stageRef: RefObject<HTMLDivElement | null>;
  artProps: {
    tilt: number;
    gradient: number;
  };
  osEvent: OsEventView | null;
  onDismissOsEvent: () => void;
}) {
  const attached = shell.placement.applied === "attached";
  return (
    <ShellFrame
      placement={shell.placement.applied}
      gutter={gutter}
      size={size}
      nativeSize={nativeSize}
      morphMs={morphMs}
      stageRef={stageRef}
    >
      <main
        className={`relative h-full w-full overflow-hidden border border-otto-line bg-otto-surface text-otto-text ${attached ? "rounded-t-none rounded-b-otto-attached border-t-transparent" : shell.expanded ? "rounded-otto-expanded" : "rounded-otto-island"} transition-[border-radius] duration-[var(--otto-morph-duration)] ease-otto`}
        style={
          {
            "--otto-morph-duration": morphMilliseconds(shell.prefs.motion),
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
            shell={shell}
            agentHomeCopy={agentHomeCopy}
            artProps={artProps}
            onContentMeasured={onContentMeasured}
            appUpdate={appUpdate}
            osEvent={osEvent}
            frameSize={size}
          />
          <SurfaceError message={surfaceError} expanded={shell.expanded} />
        </div>
      </main>
    </ShellFrame>
  );
}
