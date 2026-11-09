import type { RefObject } from "react";
import type { TimerSnapshot } from "../../platform/tauri/focus";
import { Icon, IconButton, Text, VisuallyHidden } from "../../shared/ui";
import { focusStatusMotionClass, useFocusFeedbackMotion } from "./focus-motion";
import { formatRemaining, nextActionLabel, phaseLabel } from "./view-model";

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
          label: "Pause timer",
          action: onPause,
          variant: "outlined" as const,
        }
      : completed
        ? {
            icon: "play" as const,
            label: nextActionLabel(snapshot),
            action: onStartNext,
            variant: "primary" as const,
          }
        : {
            icon: "play" as const,
            label: snapshot.status === "paused" ? "Resume timer" : "Start timer",
            action: onStart,
            variant: "primary" as const,
          };
  const statusTone = {
    ready: "bg-otto-muted",
    running: "bg-otto-ok",
    paused: "bg-otto-warn",
    completed: "bg-otto-completion-soft",
  }[snapshot.status];
  return (
    <section
      className={`flex h-full w-full items-center gap-1.5 px-2 ${motionClass}`}
      data-status={snapshot.status}
      data-surface="focus"
    >
      <button
        ref={buttonRef}
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 rounded-otto-control border-0 bg-transparent px-1.5 py-1 text-left transition-colors duration-150 hover:bg-otto-raised-soft focus-visible:bg-otto-raised-soft"
        onClick={onOpen}
      >
        <span
          key={motion.statusKey}
          className={`flex min-w-0 flex-1 items-center gap-2 ${statusMotionClass}`}
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-otto-compact-icon text-otto-control-text">
            <Icon name={completed ? "completed" : "timer"} size={16} />
          </span>
          <span key={motion.phaseKey} className={`min-w-0 flex-1 ${phaseMotionClass}`}>
            <Text as="span" variant="caption" className="block truncate text-otto-label-muted">
              {phaseLabel(snapshot.phase)}
            </Text>
            <Text as="span" variant="code" className="block truncate text-otto-text-bright">
              {completed ? "Complete" : formatRemaining(snapshot.remainingSeconds)}
            </Text>
          </span>
        </span>
        <VisuallyHidden>Open focus timer</VisuallyHidden>
      </button>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusTone}`} aria-hidden="true" />
      <IconButton
        icon={primary.icon}
        label={primary.label}
        variant={primary.variant}
        disabled={pending}
        onClick={primary.action}
      />
    </section>
  );
}
