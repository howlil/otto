import { Icon, Text } from "../../../shared/ui";
import { Bars } from "../conversation/AgentControls";
import type { TrailItem } from "./activity-trail";

function StepMarker({ done, working }: { done: boolean; working: boolean }) {
  if (done) {
    return (
      <span className="inline-flex w-[29px] flex-none justify-center">
        <Icon name="check" size={12} />
      </span>
    );
  }
  if (working) return <Bars />;
  return (
    <span className="inline-flex w-[29px] flex-none justify-center text-otto-text-tertiary">
      <Icon name="unavailable" size={11} />
    </span>
  );
}

function StepDetail({ item }: { item: TrailItem }) {
  if (!item.detail) return null;
  if (item.kind === "thinking") {
    return (
      <div className="otto-scrollbar-hidden mb-1 ml-[36px] mt-0.5 max-h-[140px] overflow-y-auto whitespace-pre-wrap break-words border-l border-otto-line pl-2.5 text-otto-xs leading-[1.45] text-otto-text-secondary">
        {item.detail}
      </div>
    );
  }
  return (
    <pre className="otto-scrollbar-hidden mb-1 ml-[36px] mt-0.5 max-h-[120px] overflow-y-auto whitespace-pre-wrap break-words rounded-otto-chip border border-otto-line bg-otto-ink-deep px-2 py-1.5 font-mono text-otto-2xs leading-[1.45] text-otto-text-secondary">
      {item.detail}
    </pre>
  );
}

export function ActivityStepRow({
  item,
  active,
  working,
  open,
  onToggle,
}: {
  item: TrailItem;
  active: boolean;
  working: boolean;
  open: boolean;
  onToggle: (key: string) => void;
}) {
  const tone = active ? "text-otto-text-secondary" : "text-otto-text-tertiary";
  const content = (
    <>
      <StepMarker done={item.done} working={working} />
      <Text as="span" variant="status" className="shrink-0">
        {item.label}
      </Text>
      {item.summary && (
        <Text as="span" variant="status" className="min-w-0 truncate text-otto-text-tertiary">
          {item.summary}
        </Text>
      )}
    </>
  );

  if (!item.detail) {
    return (
      <div className={`flex min-h-6 min-w-0 items-center gap-[7px] px-1 py-0.5 ${tone}`}>
        {content}
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => onToggle(item.key)}
        className={`group flex min-h-6 w-full min-w-0 items-center gap-[7px] rounded-otto-chip border-0 bg-transparent px-1 py-0.5 text-left transition-colors duration-150 hover:bg-otto-control/70 focus-visible:outline-1 focus-visible:outline-otto-line-focused ${tone}`}
      >
        {content}
        <Icon
          name={open ? "chevronDown" : "chevronRight"}
          size={12}
          className="ml-auto shrink-0 text-otto-text-tertiary transition-colors group-hover:text-otto-text-secondary"
        />
      </button>
      {open && <StepDetail item={item} />}
    </div>
  );
}
