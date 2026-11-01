import { Icon, VisuallyHidden } from "../../shared/ui";
import type { IconName } from "../../shared/ui";
import { useCopyFeedback, type CopyFeedbackState } from "./useCopyFeedback";

const feedbackViews: ReadonlyArray<{
  state: CopyFeedbackState;
  label: string;
  icon: IconName;
}> = [
  { state: "idle", label: "Copy answer", icon: "copy" },
  { state: "copied", label: "Copied", icon: "check" },
  { state: "error", label: "Failed", icon: "unavailable" },
];

function feedbackAnnouncement(state: CopyFeedbackState) {
  if (state === "copied") return "Answer copied";
  if (state === "error") return "Clipboard unavailable";
  return "";
}

export function CopyAnswerButton({ value, label = "Copy answer" }: { value: string; label?: string }) {
  const { state, copy } = useCopyFeedback();

  return (
    <>
      <button
        type="button"
        data-copy-state={state}
        onClick={() => void copy(value)}
        className="inline-flex min-h-7 items-center gap-1.5 border-0 bg-transparent px-0 py-[5px] text-otto-xs text-otto-muted-strong hover:text-otto-text motion-safe:transition-[color,transform] motion-safe:duration-150 motion-safe:ease-otto motion-safe:active:scale-[0.97]"
      >
        <span
          className="relative grid h-[13px] w-[13px] shrink-0 place-items-center"
          aria-hidden="true"
        >
          {feedbackViews.map((view) => (
            <span
              key={view.state}
              className={`absolute inset-0 grid place-items-center motion-safe:transition-[opacity,transform] motion-safe:duration-150 motion-safe:ease-otto ${
                state === view.state
                  ? "scale-100 opacity-100"
                  : "pointer-events-none scale-[0.85] opacity-0"
              } ${
                view.state === "copied"
                  ? "text-otto-ok"
                  : view.state === "error"
                    ? "text-otto-danger"
                    : ""
              }`}
            >
              <Icon name={view.icon} size={13} />
            </span>
          ))}
        </span>
        <span className="inline-grid items-center" aria-hidden="true">
          {feedbackViews.map((view) => (
            <span
              key={view.state}
              className={`[grid-area:1/1] whitespace-nowrap motion-safe:transition-[opacity,transform] motion-safe:duration-150 motion-safe:ease-otto ${
                state === view.state
                  ? "translate-y-0 opacity-100"
                  : "pointer-events-none translate-y-0.5 opacity-0"
              }`}
            >
              {view.state === "idle" ? label : view.label}
            </span>
          ))}
        </span>
        <VisuallyHidden>{label}</VisuallyHidden>
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {feedbackAnnouncement(state)}
      </span>
    </>
  );
}
