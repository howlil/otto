import { useLayoutEffect, useRef, useState } from "react";
import { Icon, Text } from "../../../shared/ui";
import type { AgentSnapshot } from "../../../platform/tauri";
import { agentIsWorking, captureIsWorking } from "../model/status";
import { ActivityStepRow } from "./ActivityStepRow";
import {
  MAX_VISIBLE_ACTIVE,
  buildActiveTrail,
  buildCompletedTrail,
  stepCountLabel,
} from "./activity-trail";
import { useObservedSteps } from "./useObservedSteps";

export function ActivityTrail({
  snapshot,
  current,
}: {
  snapshot: AgentSnapshot;
  current?: string | null;
}) {
  const normalizedCurrent = current ?? null;
  const isActive = normalizedCurrent !== null;
  const observed = useObservedSteps(normalizedCurrent);
  const [listExpanded, setListExpanded] = useState(false);
  const [openSteps, setOpenSteps] = useState<Record<string, boolean>>({});
  const previous = useRef({ runId: snapshot.runId, active: isActive });

  useLayoutEffect(() => {
    const runChanged = previous.current.runId !== snapshot.runId;
    const finished = previous.current.active && !isActive;
    previous.current = { runId: snapshot.runId, active: isActive };
    if (runChanged || finished) {
      setListExpanded(false);
      setOpenSteps({});
    }
  }, [snapshot.runId, isActive]);

  const toggleStep = (key: string) => {
    setOpenSteps((state) => ({ ...state, [key]: !state[key] }));
  };

  if (!isActive) {
    const completed = buildCompletedTrail(snapshot.activity);
    if (completed.length === 0) return null;
    const toggleCompleted = () => {
      const next = !listExpanded;
      setListExpanded(next);
      if (next && completed.length === 1 && completed[0].detail) {
        setOpenSteps({ [completed[0].key]: true });
      }
    };
    return (
      <div className="flex min-w-0 flex-col gap-1">
        <button
          type="button"
          aria-expanded={listExpanded}
          onClick={toggleCompleted}
          className="inline-flex min-h-6 w-fit items-center gap-1.5 rounded-otto-chip border-0 bg-transparent px-1 py-0.5 text-left text-otto-text-tertiary transition-colors duration-150 hover:bg-otto-control/70 hover:text-otto-text-secondary focus-visible:outline-1 focus-visible:outline-otto-line-focused"
        >
          <Icon name={listExpanded ? "chevronDown" : "chevronRight"} size={12} />
          <Text as="span" variant="status">
            {stepCountLabel(completed.length)}
          </Text>
        </button>
        {listExpanded && (
          <div className="flex min-w-0 flex-col gap-0.5">
            {completed.map((item) => (
              <ActivityStepRow
                key={item.key}
                item={item}
                active={false}
                working={false}
                open={Boolean(openSteps[item.key])}
                onToggle={toggleStep}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  const allItems = buildActiveTrail(observed, snapshot.activity, normalizedCurrent);
  if (allItems.length === 0) return null;
  const hiddenCount = Math.max(0, allItems.length - MAX_VISIBLE_ACTIVE);
  const items = listExpanded ? allItems : allItems.slice(-MAX_VISIBLE_ACTIVE);
  const working = agentIsWorking(snapshot.status) || captureIsWorking(snapshot.capture.phase);

  return (
    <div className="flex min-w-0 flex-col gap-0.5" aria-live="polite">
      {hiddenCount > 0 && (
        <button
          type="button"
          aria-expanded={listExpanded}
          onClick={() => setListExpanded((open) => !open)}
          className="inline-flex min-h-6 w-fit items-center gap-1.5 rounded-otto-chip border-0 bg-transparent px-1 py-0.5 text-left text-otto-text-tertiary transition-colors duration-150 hover:bg-otto-control/70 hover:text-otto-text-secondary focus-visible:outline-1 focus-visible:outline-otto-line-focused"
        >
          <Icon name={listExpanded ? "chevronDown" : "chevronRight"} size={12} />
          <Text as="span" variant="status">
            {listExpanded ? "Show fewer steps" : `Show all ${allItems.length} steps`}
          </Text>
        </button>
      )}
      {items.map((item, index) => (
        <ActivityStepRow
          key={item.key}
          item={item}
          active={!item.done && index === items.length - 1}
          working={working}
          open={Boolean(openSteps[item.key])}
          onToggle={toggleStep}
        />
      ))}
    </div>
  );
}
