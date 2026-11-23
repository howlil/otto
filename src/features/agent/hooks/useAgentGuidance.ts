import { useCallback, useEffect, useState } from "react";
import {
  nativeAvailable,
  setAgentGuidance,
  type AssistantProfile,
  type LearningMode,
} from "../../../platform/tauri";
import {
  emptyAssistantProfile,
  hasAssistantProfile,
  loadAssistantGuidance,
  normalizeAssistantProfile,
  saveAssistantGuidance,
  type AssistantGuidance,
} from "../model/assistant-profile";

function persistGuidance(next: AssistantGuidance): void {
  saveAssistantGuidance(next);
  if (nativeAvailable && typeof setAgentGuidance === "function") {
    void setAgentGuidance(next.mode, next.profile).catch(() => {});
  }
}

export function useAgentGuidance() {
  const [guidance, setGuidance] = useState<AssistantGuidance>(() => loadAssistantGuidance());
  const [onboardingOpen, setOnboardingOpen] = useState(false);

  const updateGuidance = useCallback(
    (updater: (current: AssistantGuidance) => AssistantGuidance) => {
      setGuidance((current) => {
        const next = updater(current);
        if (next === current) return current;
        persistGuidance(next);
        return next;
      });
    },
    [],
  );

  useEffect(() => {
    if (!nativeAvailable || typeof setAgentGuidance !== "function") return;
    void setAgentGuidance(guidance.mode, guidance.profile).catch(() => {});
  }, [guidance.mode, guidance.profile]);

  const setMode = useCallback(
    (mode: LearningMode) =>
      updateGuidance((current) => (current.mode === mode ? current : { ...current, mode })),
    [updateGuidance],
  );

  const setProfile = useCallback(
    (profile: AssistantProfile) => {
      const normalized = normalizeAssistantProfile(profile);
      updateGuidance((current) => ({
        ...current,
        profile: normalized,
        onboardingCompleted: current.onboardingCompleted || hasAssistantProfile(normalized),
      }));
    },
    [updateGuidance],
  );

  const clearProfile = useCallback(() => {
    updateGuidance((current) => ({
      ...current,
      profile: { ...emptyAssistantProfile },
      onboardingCompleted: true,
    }));
  }, [updateGuidance]);

  const completeOnboarding = useCallback(
    (profile: AssistantProfile) => {
      setOnboardingOpen(false);
      updateGuidance((current) => ({
        ...current,
        profile: normalizeAssistantProfile(profile),
        onboardingCompleted: true,
      }));
    },
    [updateGuidance],
  );

  const skipOnboarding = useCallback(() => {
    setOnboardingOpen(false);
    updateGuidance((current) =>
      current.onboardingCompleted ? current : { ...current, onboardingCompleted: true },
    );
  }, [updateGuidance]);

  const openOnboarding = useCallback(() => setOnboardingOpen(true), []);
  const closeOnboarding = useCallback(() => setOnboardingOpen(false), []);

  return {
    mode: guidance.mode,
    profile: guidance.profile,
    onboardingPending: !guidance.onboardingCompleted,
    onboardingOpen,
    setMode,
    setProfile,
    clearProfile,
    completeOnboarding,
    skipOnboarding,
    openOnboarding,
    closeOnboarding,
  };
}
