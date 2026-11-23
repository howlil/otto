import type { CaptureSource, LearningMode } from "../../../platform/tauri";
import { Text } from "../../../shared/ui";
import { EMPTY_STARTERS, type EmptyStarter } from "../model/learning-mode";
import type { AgentTranscriptModel } from "../model/view-model";
import { AgentOnboardingCard } from "../onboarding/AgentOnboardingCard";

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
  onSelectStarter,
}: {
  onSelectStarter: (mode: LearningMode, prompt: string) => void;
}) {
  const pick = (starter: EmptyStarter) => {
    onSelectStarter(starter.mode, starter.prompt);
  };

  return (
    <div className="grid grid-cols-2 gap-1.5 py-2">
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
  );
}

export function TranscriptIntro({
  agent,
  showOnboarding,
  showEmptyState,
  reducedMotion,
}: {
  agent: AgentTranscriptModel;
  showOnboarding: boolean;
  showEmptyState: boolean;
  reducedMotion?: boolean;
}) {
  if (showOnboarding && agent.completeOnboarding && agent.skipOnboarding && agent.closeOnboarding) {
    return (
      <AgentOnboardingCard
        key={agent.onboardingOpen ? "onboarding-reopen" : "onboarding-initial"}
        initialProfile={agent.profile}
        forcedOpen={Boolean(agent.onboardingOpen)}
        reducedMotion={reducedMotion}
        onComplete={agent.completeOnboarding}
        onSkip={agent.skipOnboarding}
        onClose={agent.closeOnboarding}
      />
    );
  }
  if (!showEmptyState) return null;
  return (
    <AgentEmptyState
      onSelectStarter={(mode, prompt) => {
        agent.setMode?.(mode);
        agent.setDraft(prompt);
        document.getElementById("otto-prompt")?.focus({ preventScroll: true });
      }}
    />
  );
}
