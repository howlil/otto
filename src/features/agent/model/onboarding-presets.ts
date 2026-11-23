import type { IconName } from "../../../shared/ui";
import { MAX_PROFILE_FOCUS_LENGTH } from "./assistant-profile";

export type OnboardingRolePreset = {
  id: string;
  label: string;
  value: string;
  icon: IconName;
  focusPlaceholder: string;
  focusSuggestions: readonly string[];
};

export type OnboardingLanguagePreset = {
  value: string;
  label: string;
};

export type OnboardingStylePreset = {
  value: string;
  label: string;
  hint: string;
};

export const ONBOARDING_ROLES: readonly OnboardingRolePreset[] = [
  {
    id: "student",
    label: "Student",
    value: "Student",
    icon: "graduationCap",
    focusPlaceholder: "e.g. Calculus, algorithms, English essays",
    focusSuggestions: [
      "Math & logic",
      "Computer science",
      "Academic writing",
      "Exam prep",
      "Languages",
    ],
  },
  {
    id: "developer",
    label: "Developer",
    value: "Developer",
    icon: "code",
    focusPlaceholder: "e.g. TypeScript, Rust, system design",
    focusSuggestions: [
      "Algorithms & CP",
      "Frontend & UI",
      "Backend & systems",
      "Debugging",
      "Architecture",
    ],
  },
  {
    id: "designer",
    label: "Designer",
    value: "Designer",
    icon: "palette",
    focusPlaceholder: "e.g. Product UX, design systems, visual craft",
    focusSuggestions: ["UX & flows", "Design systems", "Visual craft", "Copywriting", "Research"],
  },
  {
    id: "researcher",
    label: "Researcher",
    value: "Researcher",
    icon: "flask",
    focusPlaceholder: "e.g. Paper analysis, statistics, methodology",
    focusSuggestions: [
      "Paper analysis",
      "Statistics",
      "Methodology",
      "Literature review",
      "Writing",
    ],
  },
  {
    id: "professional",
    label: "Professional",
    value: "Professional",
    icon: "briefcase",
    focusPlaceholder: "e.g. Strategy, communication, data analysis",
    focusSuggestions: [
      "Strategy",
      "Clear writing",
      "Data & analysis",
      "Presentations",
      "Productivity",
    ],
  },
  {
    id: "everyday",
    label: "Everyday learner",
    value: "Everyday learner",
    icon: "compass",
    focusPlaceholder: "e.g. New topics, writing, everyday questions",
    focusSuggestions: [
      "New concepts",
      "Writing & editing",
      "Problem solving",
      "Languages",
      "Productivity",
    ],
  },
];

export const ONBOARDING_LANGUAGES: readonly OnboardingLanguagePreset[] = [
  { value: "", label: "Match message" },
  { value: "Bahasa Indonesia", label: "Bahasa Indonesia" },
  { value: "English", label: "English" },
];

export const ONBOARDING_STYLES: readonly OnboardingStylePreset[] = [
  { value: "Concise & direct", label: "Concise & direct", hint: "Short, clear answers first" },
  { value: "Warm & guided", label: "Warm & guided", hint: "Step-by-step with intuition" },
  { value: "Deep & technical", label: "Deep & technical", hint: "Detailed mechanics & trade-offs" },
  { value: "Simple & everyday", label: "Simple & everyday", hint: "Plain words & analogies" },
];

export function matchOnboardingRole(role: string): OnboardingRolePreset | undefined {
  const normalized = role.trim().toLowerCase();
  if (!normalized) return undefined;
  return ONBOARDING_ROLES.find((preset) => preset.value.toLowerCase() === normalized);
}

export function focusSuggestionsForRole(role: string): {
  placeholder: string;
  suggestions: readonly string[];
} {
  const matched = matchOnboardingRole(role);
  if (matched) {
    return {
      placeholder: matched.focusPlaceholder,
      suggestions: matched.focusSuggestions,
    };
  }
  const fallback = ONBOARDING_ROLES[ONBOARDING_ROLES.length - 1];
  return {
    placeholder: fallback.focusPlaceholder,
    suggestions: fallback.focusSuggestions,
  };
}

function splitFocusTopics(focus: string): string[] {
  return focus
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function hasFocusTopic(focus: string, topic: string): boolean {
  const target = topic.toLowerCase();
  return splitFocusTopics(focus).some((item) => item.toLowerCase() === target);
}

export function toggleFocusTopic(focus: string, topic: string): string {
  const target = topic.toLowerCase();
  const topics = splitFocusTopics(focus);
  const exists = topics.some((item) => item.toLowerCase() === target);
  const next = exists ? topics.filter((item) => item.toLowerCase() !== target) : [...topics, topic];
  const joined = next.join(", ");
  return joined.length <= MAX_PROFILE_FOCUS_LENGTH ? joined : focus;
}
