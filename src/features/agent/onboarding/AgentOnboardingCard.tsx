import { useState, type KeyboardEvent } from "react";
import type { AssistantProfile } from "../../../platform/tauri";
import { TransitionContent } from "../../../shared/ui";
import { emptyAssistantProfile } from "../model/assistant-profile";
import { OnboardingFooter, OnboardingHeader, type OnboardingStep } from "./OnboardingChrome";
import { OnboardingFocusStep } from "./OnboardingFocusStep";
import { OnboardingIdentityStep } from "./OnboardingIdentityStep";
import { OnboardingStyleStep } from "./OnboardingStyleStep";

export function AgentOnboardingCard({
  initialProfile = emptyAssistantProfile,
  forcedOpen = false,
  reducedMotion = false,
  onComplete,
  onSkip,
  onClose,
}: {
  initialProfile?: AssistantProfile;
  forcedOpen?: boolean;
  reducedMotion?: boolean;
  onComplete: (profile: AssistantProfile) => void;
  onSkip: () => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState<OnboardingStep>(0);
  const [draft, setDraft] = useState<AssistantProfile>(() => ({ ...initialProfile }));
  const [customLanguageOpen, setCustomLanguageOpen] = useState(false);

  const patchDraft = (patch: Partial<AssistantProfile>) => {
    setDraft((current) => ({ ...current, ...patch }));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape" && forcedOpen) {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };

  return (
    <section
      aria-labelledby="otto-onboarding-heading"
      onKeyDown={handleKeyDown}
      className="rounded-otto-card border border-otto-line-soft bg-otto-nav-bg/85 p-3.5"
      data-onboarding-step={step + 1}
    >
      <OnboardingHeader
        step={step}
        dismissLabel={forcedOpen ? "Close" : "Skip for now"}
        onDismiss={forcedOpen ? onClose : onSkip}
      />
      <div className="mt-3">
        <TransitionContent
          transitionKey={`onboarding-step-${step}`}
          kind="tab"
          reducedMotion={reducedMotion}
        >
          {step === 0 && (
            <OnboardingIdentityStep
              profile={draft}
              onPatch={patchDraft}
              onEnterNext={() => setStep(1)}
            />
          )}
          {step === 1 && (
            <OnboardingFocusStep
              profile={draft}
              onPatch={patchDraft}
              onEnterNext={() => setStep(2)}
            />
          )}
          {step === 2 && (
            <OnboardingStyleStep
              profile={draft}
              customLanguageOpen={customLanguageOpen}
              onToggleCustomLanguage={setCustomLanguageOpen}
              onPatch={patchDraft}
              onEnterFinish={() => onComplete(draft)}
            />
          )}
        </TransitionContent>
      </div>
      <OnboardingFooter
        step={step}
        onBack={() => setStep((current) => (current === 2 ? 1 : 0))}
        onNext={() => setStep((current) => (current === 0 ? 1 : 2))}
        onFinish={() => onComplete(draft)}
      />
    </section>
  );
}
