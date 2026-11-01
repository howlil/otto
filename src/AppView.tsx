import { AgentCapsule, AgentPanel } from "./features/agent";
import type { useAgent } from "./features/agent";
import { HomeSurface } from "./features/home";
import { GlobalSettings, SurfaceError } from "./features/shell";
import type { useNotchShell } from "./features/shell";
import { Eyes, VisuallyHidden } from "./shared/ui";

type AgentModel = ReturnType<typeof useAgent>;
type ShellModel = ReturnType<typeof useNotchShell>;

export function ShellView({
  agent,
  shell,
  surfaceError,
  agentHomeCopy,
  artProps,
}: {
  agent: AgentModel;
  shell: ShellModel;
  surfaceError: string | null;
  agentHomeCopy: string;
  artProps: {
    parallax: boolean;
    reduced: boolean;
    amount: number;
    tilt: number;
    gradient: number;
  };
}) {
  return (
    <main
      className={`relative h-full w-full overflow-hidden border border-otto-line bg-otto-surface text-otto-text ${shell.expanded ? "rounded-[28px]" : "rounded-otto-island"} ${shell.reducedMotion ? "transition-none" : "transition-[border-radius] duration-[420ms] ease-otto"} data-[reduced=true]:[&_*]:animate-none data-[reduced=true]:[&_*]:transition-none motion-reduce:[&_*]:animate-none motion-reduce:[&_*]:transition-none`}
      data-reduced={shell.reducedMotion ? "true" : undefined}
      onPointerEnter={shell.handleEnter}
      onPointerLeave={shell.handleLeave}
      onKeyDown={shell.handleEscape}
      onPointerDown={() => {
        if (shell.expanded && !shell.pinned) shell.pin();
      }}
    >
      <ShellContent agent={agent} shell={shell} agentHomeCopy={agentHomeCopy} artProps={artProps} />
      <SurfaceError message={surfaceError} expanded={shell.expanded} />
    </main>
  );
}

function ShellContent({
  agent,
  shell,
  agentHomeCopy,
  artProps,
}: {
  agent: AgentModel;
  shell: ShellModel;
  agentHomeCopy: string;
  artProps: {
    parallax: boolean;
    reduced: boolean;
    amount: number;
    tilt: number;
    gradient: number;
  };
}) {
  const { expanded, isAgent, page } = shell;
  const surfaceMotion = shell.reducedMotion
    ? ""
    : expanded
      ? "animate-otto-enter motion-reduce:animate-none"
      : "";
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
          className={`absolute left-0 top-0 z-[4] grid h-[42px] w-[92px] place-items-center border-0 bg-transparent p-0 text-inherit transition-[left,top,width,height] duration-[420ms] ease-otto ${expanded ? "left-4 top-[15px] h-7 w-[34px]" : ""} ${shell.reducedMotion ? "transition-none" : ""}`}
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
      ) : page === "home" ? (
        <HomeSurface
          notice={shell.notice}
          homeGear={shell.homeGear}
          agentSubtitle={agentHomeCopy}
          artProps={artProps}
          onOpenSettings={() => shell.open("global-settings")}
          onOpenAgent={() => shell.open("agent")}
          onNotice={shell.setNotice}
          motionClass={`${surfaceMotion} ${nudgeMotion} ${expanded && !shell.reducedMotion ? "animate-otto-home-reveal motion-reduce:animate-none" : ""}`.trim()}
        />
      ) : page === "global-settings" ? (
        <GlobalSettings
          prefs={shell.prefs}
          change={shell.change}
          onBack={shell.back}
          motionClass={`${surfaceMotion} ${nudgeMotion}`.trim()}
        />
      ) : (
        <AgentPanel
          agent={agent}
          settings={page === "agent-settings"}
          onSettings={() => shell.open("agent-settings")}
          onSettingsBack={() => shell.setPage("agent")}
          onBack={() => shell.open("home")}
          motionClass={`${surfaceMotion} ${nudgeMotion}`.trim()}
          eventMotion={shell.eventMotion}
        />
      )}
    </>
  );
}
