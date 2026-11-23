import { invoke } from "@tauri-apps/api/core";

export type LearningMode = "direct" | "solve" | "mentor" | "simple" | "write" | "practice";

export type AssistantProfile = {
  name: string;
  role: string;
  focus: string;
  language: string;
  level: string;
  instructions: string;
};

export type AssistantGuidancePayload = {
  name: string | null;
  role: string | null;
  focus: string | null;
  language: string | null;
  level: string | null;
  instructions: string | null;
};

export function toGuidancePayload(profile: AssistantProfile): AssistantGuidancePayload {
  return {
    name: profile.name?.trim() || null,
    role: profile.role?.trim() || null,
    focus: profile.focus?.trim() || null,
    language: profile.language?.trim() || null,
    level: profile.level?.trim() || null,
    instructions: profile.instructions?.trim() || null,
  };
}

export async function setAgentGuidance(
  mode: LearningMode,
  profile: AssistantProfile,
): Promise<void> {
  await invoke("agent_set_guidance", {
    mode,
    profile: toGuidancePayload(profile),
  });
}
