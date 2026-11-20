import type { LearningMode } from "../../../platform/tauri";
import { Icon, Text } from "../../../shared/ui";
import { CopyAnswerButton } from "./content/CopyAnswerButton";
import { InsertAnswerButton } from "./content/InsertAnswerButton";

export { UserMessageBubble } from "./UserMessageBubble";

export type LearningFollowupChip = {
  id: string;
  label: string;
  mode: LearningMode;
  prompt: string;
};

export const LEARNING_FOLLOWUP_CHIPS: readonly LearningFollowupChip[] = [
  {
    id: "simpler",
    label: "Simpler",
    mode: "simple",
    prompt: "Explain that more simply with a concrete everyday analogy.",
  },
  {
    id: "example",
    label: "Give an example",
    mode: "mentor",
    prompt: "Give a concrete step-by-step example of that.",
  },
  {
    id: "quiz",
    label: "Quiz me",
    mode: "practice",
    prompt: "Quiz me with 2 short questions to check my understanding.",
  },
  {
    id: "deeper",
    label: "Go deeper",
    mode: "direct",
    prompt: "Go deeper into the underlying details and edge cases.",
  },
];

export function AssistantTurnActions({
  text,
  isLatest,
  stoppedPartial,
  canAct,
  showFollowupChips,
  onInsert,
  onRetry,
  onFollowupChip,
}: {
  text: string;
  isLatest: boolean;
  stoppedPartial: boolean;
  canAct: boolean;
  showFollowupChips: boolean;
  onInsert?: (value: string) => Promise<void>;
  onRetry?: () => Promise<void>;
  onFollowupChip?: (mode: LearningMode, prompt: string) => Promise<void>;
}) {
  return (
    <div className="mt-1 flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-[9px]">
        {stoppedPartial && (
          <Text
            as="span"
            variant="caption"
            className="rounded-otto-chip border border-otto-line-mid bg-otto-raised-soft px-1.5 py-0.5 text-otto-text-secondary"
          >
            Stopped
          </Text>
        )}
        <CopyAnswerButton value={text} label="Copy" />
        {!stoppedPartial && onInsert && <InsertAnswerButton value={text} onInsert={onInsert} />}
        {isLatest && canAct && onRetry && (
          <button
            type="button"
            onClick={() => void onRetry()}
            title="Regenerate this answer"
            className="inline-flex min-h-7 items-center gap-1.5 border-0 bg-transparent px-0 py-[5px] text-otto-xs text-otto-muted-strong hover:text-otto-text motion-safe:transition-[color,transform] motion-safe:duration-150 motion-safe:ease-otto motion-safe:active:scale-[0.97]"
          >
            <Icon name="refresh" size={13} />
            Retry
          </button>
        )}
      </div>
      {showFollowupChips && onFollowupChip && (
        <div className="flex flex-wrap items-center gap-1.5">
          {LEARNING_FOLLOWUP_CHIPS.map((chip) => (
            <button
              key={chip.id}
              type="button"
              onClick={() => void onFollowupChip(chip.mode, chip.prompt)}
              className="rounded-full border border-otto-line-soft bg-otto-control px-2.5 py-1 text-otto-xs text-otto-text-secondary transition-colors duration-150 hover:border-otto-line-hover hover:bg-otto-control-hover hover:text-otto-text"
            >
              {chip.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
