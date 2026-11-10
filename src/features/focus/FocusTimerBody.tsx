import type { TimerPhase, TimerSnapshot } from "../../platform/tauri/focus";
import { Button, IconButton, Text } from "../../shared/ui";
import { focusStatusMotionClass, useFocusFeedbackMotion } from "./focus-motion";
import {
  completedFocusCycle,
  completionTitle,
  formatRemaining,
  nextActionLabel,
  phaseChoices,
  primaryActionLabel,
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
    <fieldset className="m-0 flex min-w-0 gap-[3px] border-0 p-0">
      <legend className="sr-only">Choose timer phase</legend>
      {phaseChoices.map((choice) => (
        <button
          type="button"
          key={choice.value}
          aria-pressed={choice.value === phase}
          disabled={disabled}
          className={`rounded-otto-chip border-0 px-[9px] py-2 text-otto-xs! leading-[normal]! transition-colors duration-[170ms] ${choice.value === phase ? "bg-otto-focus-selected text-otto-invert-line" : "bg-transparent text-otto-focus-inactive hover:bg-otto-focus-selected"}`}
          onClick={(event) => onSelect(choice.value, event.currentTarget)}
        >
          {choice.label}
        </button>
      ))}
    </fieldset>
  );
}

function SessionCycle({ snapshot }: { snapshot: TimerSnapshot }) {
  const cycle = completedFocusCycle(snapshot);
  return (
    <div
      className="flex shrink-0 items-center gap-[5px] text-otto-focus-secondary"
      title={`${cycle} of 4 focus sessions`}
    >
      <span className="flex gap-[5px]" aria-hidden="true">
        {[1, 2, 3, 4].map((index) => (
          <i
            key={index}
            className={`h-[5px] w-[5px] rounded-full ${index <= cycle ? "bg-otto-focus-text" : "bg-otto-focus-dot"}`}
          />
        ))}
      </span>
      <Text as="span" variant="meta" className="ml-[5px]">
        {cycle}/4
      </Text>
    </div>
  );
}

type TimerBodyProps = {
  snapshot: TimerSnapshot;
  pending: boolean;
  onStart: () => void;
  onPause: () => void;
  onReset: () => void;
  onStartNext: () => void;
  onSelectPhase: (phase: TimerPhase, trigger: HTMLButtonElement) => void;
};

function CompletedBody({ snapshot, pending, onReset, onStartNext }: TimerBodyProps) {
  return (
    <>
      <div className="flex min-h-0 flex-1 items-center gap-2 px-5 pb-[5px] pt-[9px]">
        <div className="min-w-0 flex-1" role="status">
          <Text
            as="h2"
            variant="heading"
            className="m-0 text-otto-focus-completion! font-medium! tracking-[-0.035em]"
          >
            {completionTitle(snapshot)}
          </Text>
        </div>
        <Button
          variant="primary"
          disabled={pending}
          onClick={onStartNext}
          className="rounded-full! px-3 py-2.5 text-otto-sm! font-[550]! leading-[normal]!"
        >
          {nextActionLabel(snapshot)}
        </Button>
      </div>
      <footer className="flex h-[49px] shrink-0 items-center justify-between gap-2 px-[18px] pb-[11px] pt-[3px]">
        {snapshot.phase === "focus" && (
          <Text as="span" variant="meta" className="text-otto-label-faded">
            {completedFocusCycle(snapshot)} of 4 focus sessions
          </Text>
        )}
        <IconButton
          icon="reset"
          label="Reset current session"
          variant="round"
          disabled={pending}
          onClick={onReset}
          className="ml-auto otto-focus-control"
        />
      </footer>
    </>
  );
}

export function FocusTimerBody(props: TimerBodyProps) {
  const { snapshot, pending, onStart, onPause, onReset, onSelectPhase } = props;
  const motion = useFocusFeedbackMotion(snapshot);
  const statusMotionClass = focusStatusMotionClass(motion.statusMotion);
  const phaseMotionClass =
    motion.phaseKey > 0 ? "animate-otto-focus-phase motion-reduce:animate-none" : "";
  const running = snapshot.status === "running";
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {snapshot.status === "completed" ? (
        <div key={motion.statusKey} className={`flex min-h-0 flex-1 flex-col ${statusMotionClass}`}>
          {motion.statusMotion === "complete" && (
            <span
              className="pointer-events-none absolute right-[30px] top-3 flex gap-1"
              aria-hidden="true"
            >
              {[1, 2, 3].map((spark) => (
                <i
                  key={spark}
                  className="otto-focus-spark h-1 w-1 rounded-full bg-otto-focus-running animate-otto-focus-spark motion-reduce:animate-none"
                />
              ))}
            </span>
          )}
          <CompletedBody {...props} />
        </div>
      ) : (
        <>
          <div className="flex min-h-0 flex-1 items-center gap-3 px-5 pb-[5px] pt-[9px]">
            <div key={motion.statusKey} className={`min-w-0 flex-1 ${statusMotionClass}`}>
              <div key={motion.phaseKey} className={phaseMotionClass}>
                <Text
                  as="p"
                  variant="display"
                  className="m-0 text-otto-focus-countdown! font-normal! leading-[1.05]! tracking-[-0.045em] tabular-nums"
                >
                  {formatRemaining(snapshot.remainingSeconds)}
                </Text>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-[5px]">
              <IconButton
                icon={running ? "pause" : "play"}
                label={primaryActionLabel(snapshot)}
                variant={running ? "round" : "primary"}
                disabled={pending}
                onClick={running ? onPause : onStart}
                className={`otto-focus-control ${running ? "" : "otto-focus-primary"}`}
              />
              <IconButton
                icon="reset"
                label="Reset current session"
                variant="round"
                disabled={pending}
                onClick={onReset}
                className="otto-focus-control"
              />
            </div>
          </div>
          <footer className="flex h-[49px] shrink-0 items-center justify-between gap-2 px-[18px] pb-[11px] pt-[3px]">
            <PhaseSelector phase={snapshot.phase} disabled={pending} onSelect={onSelectPhase} />
            <SessionCycle snapshot={snapshot} />
          </footer>
        </>
      )}
    </div>
  );
}
