import type { AssistantProfile, LearningMode } from "../../../platform/tauri";
import { isLearningMode } from "./learning-mode";

const STORAGE_KEY = "otto.assistant-guidance.v1";
export const MAX_PROFILE_FIELD_LENGTH = 80;
export const MAX_PROFILE_INSTRUCTIONS_LENGTH = 800;

export type AssistantGuidance = {
  mode: LearningMode;
  profile: AssistantProfile;
};

export const emptyAssistantProfile: AssistantProfile = {
  language: "",
  level: "",
  instructions: "",
};

export const defaultAssistantGuidance: AssistantGuidance = {
  mode: "direct",
  profile: emptyAssistantProfile,
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
    language: sanitizeSingleLine(record.language, MAX_PROFILE_FIELD_LENGTH),
    level: sanitizeSingleLine(record.level, MAX_PROFILE_FIELD_LENGTH),
    instructions: sanitizeMultiline(record.instructions, MAX_PROFILE_INSTRUCTIONS_LENGTH),
  };
}

export function hasAssistantProfile(profile: AssistantProfile): boolean {
  return Boolean(profile.language.trim() || profile.level.trim() || profile.instructions.trim());
}

export function loadAssistantGuidance(): AssistantGuidance {
  if (typeof localStorage === "undefined") return defaultAssistantGuidance;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultAssistantGuidance;
    const parsed = JSON.parse(raw) as { mode?: unknown; profile?: unknown };
    return {
      mode: isLearningMode(parsed.mode) ? parsed.mode : "direct",
      profile: normalizeAssistantProfile(parsed.profile),
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
      }),
    );
  } catch {
    return;
  }
}
