import type { RefObject } from "react";
import type { TimerSnapshot } from "../../platform/tauri/focus";
import { Icon, IconButton, Text, VisuallyHidden } from "../../shared/ui";
import { focusStatusMotionClass, useFocusFeedbackMotion } from "./focus-motion";
import type { FocusTimerModel } from "./useFocusTimer";
import { compactPhaseLabel, formatRemaining, primaryActionLabel } from "./view-model";

export function FocusCapsule({
  snapshot,
  pending,
  buttonRef,
  onOpen,
  onStart,
  onPause,
  onStartNext,
  motionClass = "",
}: {
  snapshot: TimerSnapshot;
  pending: boolean;
  buttonRef: RefObject<HTMLButtonElement | null>;
  onOpen: () => void;
  onStart: () => void;
  onPause: () => void;
  onStartNext: () => void;
  motionClass?: string;
}) {
  const motion = useFocusFeedbackMotion(snapshot);
  const completed = snapshot.status === "completed";
  const statusMotionClass = focusStatusMotionClass(motion.statusMotion);
  const phaseMotionClass =
    motion.phaseKey > 0 ? "animate-otto-focus-phase motion-reduce:animate-none" : "";
  const primary =
    snapshot.status === "running"
      ? {
          icon: "pause" as const,
          action: onPause,
          variant: "round" as const,
        }
      : completed
        ? {
            icon: "play" as const,
            action: onStartNext,
            variant: "primary" as const,
          }
        : {
            icon: "play" as const,
            action: onStart,
            variant: "primary" as const,
          };
  const statusTone = {
    ready: "bg-otto-focus-ready",
    running: "bg-otto-focus-running",
    paused: "bg-otto-focus-paused",
    completed: "bg-otto-focus-running",
  }[snapshot.status];
  return (
    <section
      className={`flex h-full w-full items-center gap-[9px] px-2.5 font-otto-focus ${motionClass}`}
      data-status={snapshot.status}
      data-phase={snapshot.phase}
      data-surface="focus"
    >
      <button
        ref={buttonRef}
        type="button"
        className="otto-focus-open flex h-full min-w-0 flex-1 items-center gap-2.5 rounded-otto-control border-0 bg-transparent p-0 text-left"
        onClick={onOpen}
      >
        <span
          key={motion.statusKey}
          className={`flex min-w-0 flex-1 items-center gap-2.5 ${statusMotionClass}`}
        >
          <span className="otto-focus-icon grid h-[31px] w-[31px] shrink-0 place-items-center rounded-full transition-colors duration-[180ms]">
            <Icon name={completed ? "check" : "clock"} size={16} />
          </span>
          <span
            key={motion.phaseKey}
            className={`flex min-w-0 flex-1 flex-col gap-0.5 ${phaseMotionClass}`}
          >
            <Text
              as="span"
              variant="meta"
              className={`block truncate ${completed ? "text-otto-focus-running" : "text-otto-label-faded"}`}
            >
              {compactPhaseLabel(snapshot)}
            </Text>
            <Text
              as="span"
              variant="code"
              className={`block truncate font-otto-focus! font-[550] leading-none! tracking-[-0.03em] text-otto-text ${completed ? "text-otto-lg!" : "text-otto-focus-compact!"}`}
            >
              {completed ? "Complete" : formatRemaining(snapshot.remainingSeconds)}
            </Text>
          </span>
        </span>
        <VisuallyHidden>Open focus timer</VisuallyHidden>
      </button>
      <span className={`h-1 w-1 shrink-0 rounded-full ${statusTone}`} aria-hidden="true" />
      <IconButton
        icon={completed ? "forward" : primary.icon}
        label={primaryActionLabel(snapshot)}
        variant={primary.variant}
        className={`otto-focus-control ${primary.variant === "primary" ? "otto-focus-primary" : ""}`}
        disabled={pending}
        onClick={primary.action}
      />
    </section>
  );
}

export function FocusCompactSurface({
  focus,
  buttonRef,
  onOpen,
}: {
  focus: FocusTimerModel;
  buttonRef: RefObject<HTMLButtonElement | null>;
  onOpen: () => void;
}) {
  return (
    <FocusCapsule
      snapshot={focus.snapshot}
      pending={focus.pending}
      buttonRef={buttonRef}
      onOpen={onOpen}
      onStart={() => void focus.start()}
      onPause={() => void focus.pause()}
      onStartNext={() => void focus.startNext()}
    />
  );
}
