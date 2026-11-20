import { useState } from "react";
import type { AgentViewModel } from "../features/agent";
import type { AppUpdateViewModel, ShellViewModel } from "../features/shell";
import { SurfaceBody } from "./ShellSurfaces";
import { TransitionContent } from "../shared/ui";

type Direction = "forward" | "back" | "center";
type FrameSize = { width: number; height: number } | null;
function surfaceKey(expanded: boolean, page: string) {
  return expanded ? page : "compact-agent";
}

function isCompactExpandedPair(a: string, b: string): boolean {
  return (a === "compact-agent" && b === "agent") || (a === "agent" && b === "compact-agent");
}

function transitionDirection(previousKey: string | null, currentKey: string): Direction {
  if (!previousKey || previousKey === currentKey) return "center";
  if (isCompactExpandedPair(previousKey, currentKey)) return "center";
  if (currentKey === "settings") return "forward";
  if (previousKey === "settings") return "back";
  return "center";
}

export function ShellContent({
  agent,
  shell,
  onContentMeasured,
  appUpdate,
  frameSize,
}: {
  agent: AgentViewModel;
  shell: ShellViewModel;
  onContentMeasured: (height: number) => void;
  appUpdate: AppUpdateViewModel;
  frameSize?: FrameSize;
}) {
  const { expanded, page } = shell;
  const currentKey = surfaceKey(expanded, page);
  const [directionState, setDirectionState] = useState<{
    key: string;
    direction: Direction;
  }>({
    key: currentKey,
    direction: "center",
  });
  if (directionState.key !== currentKey) {
    setDirectionState({
      key: currentKey,
      direction: transitionDirection(directionState.key, currentKey),
    });
  }
  return (
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
        appUpdate={appUpdate}
        onContentMeasured={onContentMeasured}
      />
    </TransitionContent>
  );
}
