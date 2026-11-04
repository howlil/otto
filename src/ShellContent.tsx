import { useState } from "react";
import type { useAgent } from "./features/agent";
import type { AppUpdateState, useNotchShell } from "./features/shell";
import type { OsEventView } from "./platform/tauri";
import { CompactEyesButton, SurfaceBody } from "./ShellSurfaces";
import { TransitionContent } from "./shared/ui";

type Direction = "forward" | "back" | "center";
type FrameSize = { width: number; height: number } | null;
type AgentModel = ReturnType<typeof useAgent>;
type ShellModel = ReturnType<typeof useNotchShell>;

function surfaceKey(
  expanded: boolean,
  isAgent: boolean,
  page: string,
  osEvent: OsEventView | null,
) {
  if (osEvent) return `os-event-${osEvent.id}`;
  if (!expanded) return isAgent ? "compact-agent" : "compact-home";
  return isAgent ? "agent" : page;
}

function isCompactExpandedPair(a: string, b: string): boolean {
  return (
    (a === "compact-home" && b === "home") ||
    (a === "home" && b === "compact-home") ||
    (a === "compact-agent" && b === "agent") ||
    (a === "agent" && b === "compact-agent")
  );
}

function transitionDirection(previousKey: string | null, currentKey: string): Direction {
  if (!previousKey || previousKey === currentKey) return "center";
  if (isCompactExpandedPair(previousKey, currentKey)) return "center";
  if (previousKey.startsWith("os-event-") || currentKey.startsWith("os-event-")) return "center";
  if (currentKey === "home" || currentKey === "compact-home") return "back";
  if (previousKey === "home" || previousKey === "compact-home") return "forward";
  return "center";
}

export function ShellContent({
  agent,
  shell,
  agentHomeCopy,
  artProps,
  onContentMeasured,
  appUpdate,
  osEvent,
  frameSize,
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
  artProps: { tilt: number; gradient: number };
  osEvent: OsEventView | null;
  frameSize?: FrameSize;
}) {
  const { expanded, isAgent, page } = shell;
  const currentKey = surfaceKey(expanded, isAgent, page, osEvent);
  const [directionState, setDirectionState] = useState<{ key: string; direction: Direction }>({
    key: currentKey,
    direction: "center",
  });
  if (directionState.key !== currentKey) {
    setDirectionState({
      key: currentKey,
      direction: transitionDirection(directionState.key, currentKey),
    });
  }
  const nudgeMotion = shell.reducedMotion
    ? ""
    : shell.eventMotion === "otto-nudge"
      ? "animate-otto-nudge motion-reduce:animate-none"
      : "";
  return (
    <>
      {!isAgent && page === "home" && !osEvent && (
        <CompactEyesButton
          expanded={expanded}
          prefs={shell.prefs}
          buttonRef={shell.compactButton}
          reducedMotion={shell.reducedMotion}
          onToggle={() => {
            if (!expanded) shell.open("home");
            else if (shell.pinned) shell.collapse();
            else shell.pin();
          }}
        />
      )}
      <TransitionContent
        transitionKey={currentKey}
        kind={expanded ? "page" : "compact"}
        direction={directionState.direction}
        reducedMotion={shell.reducedMotion}
        className="h-full w-full"
        frameSize={frameSize}
      >
        <SurfaceBody
          agent={agent}
          shell={shell}
          agentHomeCopy={agentHomeCopy}
          artProps={artProps}
          appUpdate={appUpdate}
          onContentMeasured={onContentMeasured}
          nudgeMotion={nudgeMotion}
          osEvent={osEvent}
        />
      </TransitionContent>
    </>
  );
}
