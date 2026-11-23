import { useState } from "react";
import type { AgentViewModel } from "../features/agent";
import type { AppUpdateViewModel, ShellViewModel } from "../features/shell";
import type { HostAnchor } from "../platform/tauri/shell";
import { SurfaceBody } from "./ShellSurfaces";
import { TransitionContent } from "../shared/ui";

type Direction = "forward" | "back" | "center";
type FrameSize = { width: number; height: number } | null;
function surfaceKey(expanded: boolean, page: string, compactCircle: boolean) {
  if (expanded) return page;
  return compactCircle ? "compact-circle" : "compact-agent";
}

function isCompactKey(key: string): boolean {
  return key === "compact-agent" || key === "compact-circle";
}

function isCompactExpandedPair(a: string, b: string): boolean {
  return (isCompactKey(a) && b === "agent") || (a === "agent" && isCompactKey(b));
}

function transitionDirection(previousKey: string | null, currentKey: string): Direction {
  if (!previousKey || previousKey === currentKey) return "center";
  if (isCompactExpandedPair(previousKey, currentKey)) return "center";
  if (isCompactKey(previousKey) && isCompactKey(currentKey)) return "center";
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
  anchor,
}: {
  agent: AgentViewModel;
  shell: ShellViewModel;
  onContentMeasured: (height: number) => void;
  appUpdate: AppUpdateViewModel;
  frameSize?: FrameSize;
  anchor?: HostAnchor;
}) {
  const { expanded, page, compactCircle } = shell;
  const currentKey = surfaceKey(expanded, page, compactCircle);
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
      anchor={anchor}
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
