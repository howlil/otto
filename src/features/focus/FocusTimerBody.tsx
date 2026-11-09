import type { TimerPhase, TimerSnapshot } from "../../platform/tauri/focus";
import { Button, IconButton, Text } from "../../shared/ui";
import { focusStatusMotionClass, useFocusFeedbackMotion } from "./focus-motion";
import {
  completedFocusCycle,
  completionHint,
  completionTitle,
  formatRemaining,
  nextActionLabel,
  phaseChoices,
  timerHint,
} from "./view-model";

function PhaseSelector({
  phase,
  disabled,
  onSelect,
}: {
  phase: TimerPhase;
  disabled: boolean;
  onSelect: (phase: TimerPhase, trigger: HTMLButtonElement) => void;
}) {
  return (
    <fieldset className="m-0 flex min-w-0 gap-1 border-0 p-0">
      <legend className="sr-only">Choose timer phase</legend>
      {phaseChoices.map((choice) => (
        <button
          type="button"
          key={choice.value}
          aria-pressed={choice.value === phase}
          disabled={disabled}
          className={`min-h-7 rounded-otto-chip border px-2.5 py-1 text-otto-xs transition-colors duration-[var(--otto-selection-duration)] ease-otto ${choice.value === phase ? "border-otto-line-focused bg-otto-selected text-otto-text" : "border-otto-line-mid bg-otto-field-deep text-otto-text-secondary hover:bg-otto-control-hover"}`}
          onClick={(event) => onSelect(choice.value, event.currentTarget)}
        >
          {choice.label}
        </button>
      ))}
    </fieldset>
  );
}

function SessionCycle({ completedFocusSessions }: { completedFocusSessions: number }) {
  const cycle = completedFocusCycle(completedFocusSessions);
  return (
    <div className="flex shrink-0 items-center gap-1.5" title={`${cycle} of 4 focus sessions`}>
      <span className="flex gap-1" aria-hidden="true">
        {[1, 2, 3, 4].map((index) => (
          <i
            key={index}
            className={`h-1.5 w-1.5 rounded-full ${index <= cycle ? "bg-otto-completion-soft" : "bg-otto-line-strong"}`}
          />
        ))}
      </span>
      <Text as="span" variant="caption" className="text-otto-label-muted">
        {cycle}/4
      </Text>
    </div>
  );
}

export function FocusTimerBody({
  snapshot,
  pending,
  onStart,
  onPause,
  onReset,
  onStartNext,
  onSelectPhase,
}: {
  snapshot: TimerSnapshot;
  pending: boolean;
  onStart: () => void;
  onPause: () => void;
  onReset: () => void;
  onStartNext: () => void;
  onSelectPhase: (phase: TimerPhase, trigger: HTMLButtonElement) => void;
}) {
  const motion = useFocusFeedbackMotion(snapshot);
  const statusMotionClass = focusStatusMotionClass(motion.statusMotion);
  const phaseMotionClass =
    motion.phaseKey > 0 ? "animate-otto-focus-phase motion-reduce:animate-none" : "";

  if (snapshot.status === "completed") {
    return (
      <div className="flex min-h-0 flex-1 flex-col justify-between px-4 pb-3 pt-3">
        <div className="min-w-0" role="status">
          <div key={motion.statusKey} className={`relative ${statusMotionClass}`}>
            {motion.statusMotion === "complete" && (
              <span
                className="pointer-events-none absolute right-0 top-0 flex gap-1"
                aria-hidden="true"
              >
                {[1, 2, 3].map((spark) => (
                  <i
                    key={spark}
                    className="otto-focus-spark h-1 w-1 rounded-full bg-otto-completion-soft animate-otto-focus-spark motion-reduce:animate-none"
                  />
                ))}
              </span>
            )}
            <Text as="h2" variant="heading" className="m-0 text-otto-completion-soft">
              {completionTitle(snapshot)}
            </Text>
            <Text as="p" variant="meta" className="mb-0 mt-1 text-otto-text-secondary">
              {completionHint(snapshot)}
            </Text>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3">
          <Text as="span" variant="caption" className="text-otto-label-muted">
            {snapshot.phase === "focus"
              ? `${completedFocusCycle(snapshot.completedFocusSessions)} of 4 focus sessions`
              : "Ready for your next focus"}
          </Text>
          <div className="flex items-center gap-1.5">
            <IconButton
              icon="reset"
              label="Reset current session"
              variant="outlined"
              disabled={pending}
              onClick={onReset}
            />
            <Button variant="primary" size="xs" disabled={pending} onClick={onStartNext}>
              {nextActionLabel(snapshot)}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const running = snapshot.status === "running";
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-between px-4 pb-3 pt-3">
      <div className="flex items-center justify-between gap-4">
        <div key={motion.statusKey} className={`min-w-0 ${statusMotionClass}`}>
          <Text as="p" variant="caption" className="m-0 text-otto-label-muted">
            {snapshot.phase === "focus"
              ? "Focus session"
              : snapshot.phase === "short"
                ? "Short break"
                : "Long break"}
          </Text>
          <div key={motion.phaseKey} className={phaseMotionClass}>
            <Text as="p" variant="display" className="m-0 mt-0.5 font-otto-mono tabular-nums">
              {formatRemaining(snapshot.remainingSeconds)}
            </Text>
            <Text as="p" variant="meta" className="m-0 mt-0.5 text-otto-text-secondary">
              {timerHint(snapshot)}
            </Text>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <IconButton
            icon={running ? "pause" : "play"}
            label={
              running
                ? "Pause timer"
                : snapshot.status === "paused"
                  ? "Resume timer"
                  : "Start timer"
            }
            variant={running ? "outlined" : "primary"}
            disabled={pending}
            onClick={running ? onPause : onStart}
          />
          <IconButton
            icon="reset"
            label="Reset current session"
            variant="outlined"
            disabled={pending}
            onClick={onReset}
          />
        </div>
      </div>
      <footer className="flex items-center justify-between gap-3">
        <PhaseSelector phase={snapshot.phase} disabled={pending} onSelect={onSelectPhase} />
        <SessionCycle completedFocusSessions={snapshot.completedFocusSessions} />
      </footer>
    </div>
  );
}
