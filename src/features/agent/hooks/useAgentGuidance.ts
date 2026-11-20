import { useCallback, useEffect, useState } from "react";
import {
  nativeAvailable,
  setAgentGuidance,
  type AssistantProfile,
  type LearningMode,
} from "../../../platform/tauri";
import {
  emptyAssistantProfile,
  loadAssistantGuidance,
  normalizeAssistantProfile,
  saveAssistantGuidance,
  type AssistantGuidance,
} from "../model/assistant-profile";

export function useAgentGuidance() {
  const [guidance, setGuidance] = useState<AssistantGuidance>(() => loadAssistantGuidance());

  const persist = useCallback((next: AssistantGuidance) => {
    saveAssistantGuidance(next);
    if (nativeAvailable && typeof setAgentGuidance === "function") {
      void setAgentGuidance(next.mode, next.profile).catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (!nativeAvailable || typeof setAgentGuidance !== "function") return;
    void setAgentGuidance(guidance.mode, guidance.profile).catch(() => {});
  }, [guidance.mode, guidance.profile]);

  const setMode = useCallback(
    (mode: LearningMode) => {
      setGuidance((current) => {
        if (current.mode === mode) return current;
        const next = { ...current, mode };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const setProfile = useCallback(
    (profile: AssistantProfile) => {
      const normalized = normalizeAssistantProfile(profile);
      setGuidance((current) => {
        const next = { ...current, profile: normalized };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const clearProfile = useCallback(() => {
    setProfile(emptyAssistantProfile);
  }, [setProfile]);

  return {
    mode: guidance.mode,
    profile: guidance.profile,
    setMode,
    setProfile,
    clearProfile,
  };
}
