import type { AssistantProfile, LearningMode } from "../../../platform/tauri";
import { isLearningMode } from "./learning-mode";

const STORAGE_KEY = "otto.assistant-guidance.v1";
export const MAX_PROFILE_NAME_LENGTH = 40;
export const MAX_PROFILE_ROLE_LENGTH = 60;
export const MAX_PROFILE_FOCUS_LENGTH = 160;
export const MAX_PROFILE_FIELD_LENGTH = 80;
export const MAX_PROFILE_INSTRUCTIONS_LENGTH = 800;

export type AssistantGuidance = {
  mode: LearningMode;
  profile: AssistantProfile;
  onboardingCompleted: boolean;
};

export const emptyAssistantProfile: AssistantProfile = {
  name: "",
  role: "",
  focus: "",
  language: "",
  level: "",
  instructions: "",
};

export const defaultAssistantGuidance: AssistantGuidance = {
  mode: "direct",
  profile: emptyAssistantProfile,
  onboardingCompleted: false,
};

function sanitizeSingleLine(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\r?\n/g, " ").slice(0, maxLength);
}

function sanitizeMultiline(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\r\n?/g, "\n").slice(0, maxLength);
}

export function normalizeAssistantProfile(input: unknown): AssistantProfile {
  if (!input || typeof input !== "object") return { ...emptyAssistantProfile };
  const record = input as Partial<Record<keyof AssistantProfile, unknown>>;
  return {
    name: sanitizeSingleLine(record.name, MAX_PROFILE_NAME_LENGTH),
    role: sanitizeSingleLine(record.role, MAX_PROFILE_ROLE_LENGTH),
    focus: sanitizeSingleLine(record.focus, MAX_PROFILE_FOCUS_LENGTH),
    language: sanitizeSingleLine(record.language, MAX_PROFILE_FIELD_LENGTH),
    level: sanitizeSingleLine(record.level, MAX_PROFILE_FIELD_LENGTH),
    instructions: sanitizeMultiline(record.instructions, MAX_PROFILE_INSTRUCTIONS_LENGTH),
  };
}

export function hasAssistantProfile(profile: AssistantProfile): boolean {
  return Boolean(
    profile.name.trim() ||
      profile.role.trim() ||
      profile.focus.trim() ||
      profile.language.trim() ||
      profile.level.trim() ||
      profile.instructions.trim(),
  );
}

export function profileSummaryLabel(profile: AssistantProfile): string {
  const parts = [
    profile.name.trim(),
    profile.role.trim(),
    profile.language.trim(),
    profile.level.trim(),
  ].filter(Boolean);
  if (parts.length > 0) return parts.slice(0, 3).join(" · ");
  if (profile.focus.trim()) return profile.focus.trim();
  return profile.instructions.trim() ? "Custom instructions" : "";
}

export function loadAssistantGuidance(): AssistantGuidance {
  if (typeof localStorage === "undefined") return defaultAssistantGuidance;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultAssistantGuidance;
    const parsed = JSON.parse(raw) as {
      mode?: unknown;
      profile?: unknown;
      onboardingCompleted?: unknown;
    };
    const profile = normalizeAssistantProfile(parsed.profile);
    const onboardingCompleted =
      typeof parsed.onboardingCompleted === "boolean"
        ? parsed.onboardingCompleted
        : hasAssistantProfile(profile);
    return {
      mode: isLearningMode(parsed.mode) ? parsed.mode : "direct",
      profile,
      onboardingCompleted,
    };
  } catch {
    return defaultAssistantGuidance;
  }
}

export function saveAssistantGuidance(guidance: AssistantGuidance): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        mode: guidance.mode,
        profile: normalizeAssistantProfile(guidance.profile),
        onboardingCompleted: Boolean(guidance.onboardingCompleted),
      }),
    );
  } catch {
    return;
  }
}
