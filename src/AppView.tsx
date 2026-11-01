import { AgentCapsule, AgentPanel } from "./features/agent";
import type { useAgent } from "./features/agent";
import { HomeSurface } from "./features/home";
import { GlobalSettings, SurfaceError } from "./features/shell";
import type { AppUpdateState, useAppUpdate, useNotchShell } from "./features/shell";
import { Eyes, TransitionContent, VisuallyHidden } from "./shared/ui";

type AgentModel = ReturnType<typeof useAgent>;
type ShellModel = ReturnType<typeof useNotchShell>;

export function ShellView({
  agent,
  shell,
  surfaceError,
  agentHomeCopy,
  artProps,
  onContentMeasured,
  appUpdate,
}: {
  agent: AgentModel;
  shell: ShellModel;
  surfaceError: string | null;
  agentHomeCopy: string;
  onContentMeasured: (height: number) => void;
  appUpdate: ReturnType<typeof useAppUpdate>;
  artProps: {
    tilt: number;
    gradient: number;
  };
}) {
  return (
    <main
      className={`relative h-full w-full overflow-hidden border border-otto-line bg-otto-surface text-otto-text ${shell.expanded ? "rounded-[27px]" : "rounded-otto-island"} ${shell.reducedMotion ? "transition-none" : "transition-[border-radius] duration-[420ms] ease-otto"} data-[reduced=true]:[&_*]:animate-none data-[reduced=true]:[&_*]:transition-none motion-reduce:[&_*]:animate-none motion-reduce:[&_*]:transition-none`}
      data-reduced={shell.reducedMotion ? "true" : undefined}
      onPointerEnter={shell.handleEnter}
      onPointerLeave={shell.handleLeave}
      onKeyDown={shell.handleEscape}
      onPointerDown={() => {
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
      />
      <SurfaceError message={surfaceError} expanded={shell.expanded} />
    </main>
  );
}

function ShellContent({
  agent,
  shell,
  agentHomeCopy,
  artProps,
  onContentMeasured,
  appUpdate,
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
  artProps: {
    tilt: number;
    gradient: number;
  };
}) {
  const { expanded, isAgent, page } = shell;
  const nudgeMotion = shell.reducedMotion
    ? ""
    : shell.eventMotion === "otto-nudge"
      ? "animate-otto-nudge motion-reduce:animate-none"
      : "";
  return (
    <>
      {!isAgent && page === "home" && (
        <button
          ref={shell.compactButton}
          className={`group absolute left-0 top-0 z-[4] grid h-[42px] w-[92px] place-items-center border-0 bg-transparent p-0 text-inherit transition-[left,top,width,height,background,transform] duration-[420ms] ease-otto ${expanded ? "left-4 top-3 h-[34px] w-[34px] rounded-otto-panel bg-otto-raised-soft text-otto-control-text hover:bg-otto-line-mid active:scale-[0.96]" : ""} ${shell.reducedMotion ? "transition-none" : ""}`}
          type="button"
          aria-expanded={expanded}
          onClick={() => (expanded ? shell.collapse() : shell.open("home"))}
        >
          <Eyes
            expression={shell.prefs.expression}
            reactive={shell.prefs.reactive}
            compact={!expanded}
          />
          <VisuallyHidden>{expanded ? "Collapse Otto" : "Open Otto"}</VisuallyHidden>
        </button>
      )}
      {!expanded ? (
        isAgent ? (
          <AgentCapsule
            snapshot={agent.snapshot}
            installed={agent.installed}
            readiness={agent.readiness}
            error={agent.error}
            buttonRef={shell.compactButton}
            onOpen={() => shell.open("agent")}
            motionClass={nudgeMotion}
          />
        ) : null
      ) : (
        <TransitionContent
          transitionKey={isAgent ? "agent" : page}
          direction={page === "home" ? "back" : "forward"}
          reducedMotion={shell.reducedMotion}
          className="h-full w-full"
        >
          {page === "home" ? (
            <HomeSurface
              notice={shell.notice}
              homeGear={shell.homeGear}
              agentSubtitle={agentHomeCopy}
              artProps={artProps}
              onOpenSettings={() => shell.open("global-settings")}
              onOpenAgent={() => shell.open("agent")}
              onNotice={shell.setNotice}
              motionClass={nudgeMotion}
            />
          ) : page === "global-settings" ? (
            <GlobalSettings
              prefs={shell.prefs}
              change={shell.change}
              onBack={shell.back}
              onMeasured={onContentMeasured}
              update={appUpdate}
              reducedMotion={shell.reducedMotion}
              motionClass={nudgeMotion}
            />
          ) : (
            <AgentPanel
              agent={agent}
              settings={page === "agent-settings"}
              onSettings={() => shell.open("agent-settings")}
              onSettingsBack={() => shell.setPage("agent")}
              onBack={() => shell.open("home")}
              motionClass={nudgeMotion}
              eventMotion={shell.eventMotion}
              onMeasured={onContentMeasured}
              reducedMotion={shell.reducedMotion}
            />
          )}
        </TransitionContent>
      )}
    </>
  );
}
