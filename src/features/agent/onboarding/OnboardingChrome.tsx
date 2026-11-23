import { Button, Eyes, Text } from "../../../shared/ui";

export type OnboardingStep = 0 | 1 | 2;

const STEP_COPY = [
  {
    title: "Let Otto get to know you",
    subtitle: "Answers automatically adapt to your background and style.",
  },
  {
    title: "What are you focusing on?",
    subtitle: "Otto will pick examples and analogies from your world.",
  },
  {
    title: "How should Otto answer?",
    subtitle: "Pick your language and explanation style. Editable anytime.",
  },
] as const;

export function OnboardingHeader({
  step,
  dismissLabel,
  onDismiss,
}: {
  step: OnboardingStep;
  dismissLabel: string;
  onDismiss: () => void;
}) {
  const currentCopy = STEP_COPY[step];
  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-otto-line-soft bg-otto-ink-deep">
            <Eyes mini expression={step === 2 ? "completed" : "idle"} />
          </span>
          <div className="min-w-0">
            <Text
              as="h2"
              id="otto-onboarding-heading"
              variant="body-compact"
              className="m-0 font-semibold text-otto-text-bright"
            >
              {currentCopy.title}
            </Text>
            <Text as="p" variant="caption" className="m-0 mt-0.5 text-otto-text-tertiary">
              {currentCopy.subtitle}
            </Text>
          </div>
        </div>
        <Button variant="quiet" size="link" onClick={onDismiss}>
          {dismissLabel}
        </Button>
      </div>
      <div className="mt-2.5 flex items-center gap-1.5">
        {STEP_COPY.map((entry, index) => (
          <span
            key={entry.title}
            className={`h-1 flex-1 rounded-full transition-colors duration-150 ${
              index <= step ? "bg-otto-text-bright" : "bg-otto-line-soft"
            }`}
          />
        ))}
        <Text as="span" variant="meta" className="ml-1 shrink-0 text-otto-text-tertiary">
          {step + 1} / 3
        </Text>
      </div>
    </>
  );
}

export function OnboardingFooter({
  step,
  onBack,
  onNext,
  onFinish,
}: {
  step: OnboardingStep;
  onBack: () => void;
  onNext: () => void;
  onFinish: () => void;
}) {
  return (
    <div className="mt-3.5 flex items-center justify-between gap-2 border-t border-otto-line-soft pt-2.5">
      {step > 0 ? (
        <Button variant="quiet" size="xs" icon="back" onClick={onBack}>
          Back
        </Button>
      ) : (
        <Text as="span" variant="caption" className="text-otto-text-tertiary">
          Stored locally · Edit anytime in Settings
        </Text>
      )}
      {step < 2 ? (
        <Button variant="primary" size="xs" onClick={onNext}>
          Next
        </Button>
      ) : (
        <Button variant="primary" size="xs" icon="check" onClick={onFinish}>
          Finish setup
        </Button>
      )}
    </div>
  );
}
