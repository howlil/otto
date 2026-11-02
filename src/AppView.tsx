import {
  CompactHomeButton,
  CompactSurface,
  ExpandedContent,
  nudgeMotionClass,
} from "./AppSurfaces";
import type { useAgent } from "./features/agent";
import { SurfaceError } from "./features/shell";
import type { AppUpdateState, useAppUpdate, useNotchShell } from "./features/shell";
import type { OsEventView } from "./platform/tauri";
import { TransitionContent } from "./shared/ui";

type AgentModel = ReturnType<typeof useAgent>;
type ShellModel = ReturnType<typeof useNotchShell>;

type ArtProps = {
  tilt: number;
  gradient: number;
};

export function ShellView({
  agent,
  shell,
  surfaceError,
  agentHomeCopy,
  artProps,
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
  osEvent: OsEventView | null;
  onDismissOsEvent: () => void;
  artProps: ArtProps;
}) {
  return (
    <main
      className={`relative h-full w-full overflow-hidden border border-otto-line bg-otto-surface text-otto-text ${shell.expanded ? "rounded-[27px]" : "rounded-otto-island"} ${shell.reducedMotion ? "transition-none" : "transition-[border-radius] duration-[420ms] ease-otto"} data-[reduced=true]:[&_*]:animate-none data-[reduced=true]:[&_*]:transition-none motion-reduce:[&_*]:animate-none motion-reduce:[&_*]:transition-none`}
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
      <ShellContent
        agent={agent}
        shell={shell}
        agentHomeCopy={agentHomeCopy}
        artProps={artProps}
        onContentMeasured={onContentMeasured}
        appUpdate={appUpdate}
        osEvent={osEvent}
      />
      <SurfaceError message={surfaceError} expanded={shell.expanded} />
    </main>
  );
}

function contentKey(
  shell: Pick<ShellModel, "expanded" | "isAgent" | "page">,
  osEvent: OsEventView | null,
) {
  if (shell.expanded) return shell.isAgent ? "agent" : shell.page;
  if (osEvent) return `os-event-${osEvent.id}`;
  return shell.isAgent ? "compact-agent" : "compact-home";
}

function ShellContent({
  agent,
  shell,
  agentHomeCopy,
  artProps,
  onContentMeasured,
  appUpdate,
  osEvent,
}: {
  agent: AgentModel;
  shell: ShellModel;
  agentHomeCopy: string;
  onContentMeasured: (height: number) => void;
  appUpdate: {
    state: AppUpdateState;
    checkForUpdate: () => Promise<void>;
    installUpdate: () => Promise<void>;
  };
  osEvent: OsEventView | null;
  artProps: ArtProps;
}) {
  const { expanded, isAgent, page } = shell;
  const motionClass = nudgeMotionClass(shell);
  return (
    <>
      {!isAgent && page === "home" && !osEvent && <CompactHomeButton shell={shell} />}
      <TransitionContent
        transitionKey={contentKey(shell, osEvent)}
        kind={expanded ? "page" : "compact"}
        direction={!expanded ? "center" : page === "home" ? "back" : "forward"}
        reducedMotion={shell.reducedMotion}
        className="h-full w-full"
      >
        {expanded ? (
          <ExpandedContent
            agent={agent}
            shell={shell}
            agentHomeCopy={agentHomeCopy}
            artProps={artProps}
            onContentMeasured={onContentMeasured}
            appUpdate={appUpdate}
            motionClass={motionClass}
          />
        ) : (
          <CompactSurface agent={agent} shell={shell} osEvent={osEvent} motionClass={motionClass} />
        )}
      </TransitionContent>
    </>
  );
}
