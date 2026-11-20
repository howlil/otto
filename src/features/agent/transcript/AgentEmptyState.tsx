import type { CaptureSource, LearningMode } from "../../../platform/tauri";
import { Text } from "../../../shared/ui";
import { EMPTY_STARTERS, type EmptyStarter } from "../model/learning-mode";

export function CaptureAlerts({
  captureFailure,
  captureActionError,
  captureSource,
  onCapture,
  onConfigureCapture,
}: {
  captureFailure: string | null;
  captureActionError: string | null;
  captureSource: CaptureSource;
  onCapture: () => void;
  onConfigureCapture: () => void;
}) {
  return (
    <>
      {captureFailure && (
        <div role="alert" className="mx-[18px] mb-1 text-otto-xs text-otto-danger">
          {captureFailure}{" "}
          {captureSource !== "selectedText" && (
            <>
              <button type="button" className="underline" onClick={onCapture}>
                Retry capture
              </button>{" "}
            </>
          )}
          <button type="button" className="underline" onClick={onConfigureCapture}>
            Capture settings
          </button>
        </div>
      )}
      {captureActionError && (
        <div role="alert" className="mx-[18px] mb-1 text-otto-xs text-otto-danger">
          {captureActionError}{" "}
          <button type="button" className="underline" onClick={onConfigureCapture}>
            Capture settings
          </button>
        </div>
      )}
    </>
  );
}

export function AgentEmptyState({
  captureShortcut,
  onSelectStarter,
}: {
  captureShortcut?: string;
  onSelectStarter: (mode: LearningMode, prompt: string) => void;
}) {
  const pick = (starter: EmptyStarter) => {
    onSelectStarter(starter.mode, starter.prompt);
  };

  return (
    <div className="flex flex-col gap-3 py-2">
      <div className="px-0.5">
        <Text as="p" variant="body-compact" className="m-0 text-otto-text-bright">
          What would you like to learn or figure out?
        </Text>
        <Text as="p" variant="caption" className="m-0 mt-0.5 text-otto-text-tertiary">
          Switch styles anytime with /solve, /mentor, /simple, /write, or /practice
          {captureShortcut ? ` · Capture with ${captureShortcut}` : ""}.
        </Text>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {EMPTY_STARTERS.map((starter) => (
          <button
            key={starter.id}
            type="button"
            onClick={() => pick(starter)}
            className="flex flex-col items-start rounded-otto-panel border border-otto-line-soft bg-otto-control/70 px-2.5 py-2 text-left transition-colors duration-150 hover:border-otto-line-hover hover:bg-otto-control-hover focus-visible:outline-1 focus-visible:outline-otto-line-focused"
          >
            <Text as="span" variant="status" className="text-otto-text-bright">
              {starter.title}
            </Text>
            <Text as="span" variant="caption" className="mt-0.5 text-otto-text-tertiary">
              {starter.hint}
            </Text>
          </button>
        ))}
      </div>
    </div>
  );
}
