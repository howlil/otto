import type { LearningMode } from "../../../platform/tauri";

export type LearningModeOption = {
  id: LearningMode;
  label: string;
  shortLabel: string;
  slash: string;
  aliases: readonly string[];
  description: string;
};

export const LEARNING_MODES: readonly LearningModeOption[] = [
  {
    id: "direct",
    label: "Direct",
    shortLabel: "Direct",
    slash: "/direct",
    aliases: ["direct", "fast", "answer"],
    description: "Clear, concise answer",
  },
  {
    id: "solve",
    label: "Solve",
    shortLabel: "Solve",
    slash: "/solve",
    aliases: ["solve", "math", "logic", "cp", "algo", "verify"],
    description: "Verified math, logic & optimal algorithms",
  },
  {
    id: "mentor",
    label: "Mentor",
    shortLabel: "Mentor",
    slash: "/mentor",
    aliases: ["mentor", "coach", "guide", "socratic"],
    description: "Step-by-step guidance & questions",
  },
  {
    id: "simple",
    label: "Simple",
    shortLabel: "Simple",
    slash: "/simple",
    aliases: ["simple", "eli5", "easy", "explain"],
    description: "Plain language & analogies",
  },
  {
    id: "write",
    label: "Write & Translate",
    shortLabel: "Write",
    slash: "/write",
    aliases: ["write", "translate", "rewrite", "polish"],
    description: "Draft, rewrite & translate",
  },
  {
    id: "practice",
    label: "Practice",
    shortLabel: "Practice",
    slash: "/practice",
    aliases: ["practice", "quiz", "drill", "test"],
    description: "Quiz & check understanding",
  },
] as const;

export type EmptyStarter = {
  id: string;
  title: string;
  hint: string;
  mode: LearningMode;
  prompt: string;
};

export const EMPTY_STARTERS: readonly EmptyStarter[] = [
  {
    id: "solve",
    title: "Solve a complex problem",
    hint: "Math, logic & optimal CP",
    mode: "solve",
    prompt: "Solve this problem with the most efficient approach and verify the final answer: ",
  },
  {
    id: "mentor",
    title: "Learn step by step",
    hint: "Guided mentoring",
    mode: "mentor",
    prompt: "Guide me step by step to understand ",
  },
  {
    id: "explain",
    title: "Explain simply",
    hint: "Plain analogies",
    mode: "simple",
    prompt: "Explain this simply with an everyday analogy: ",
  },
  {
    id: "quiz",
    title: "Quiz my understanding",
    hint: "Short recall drill",
    mode: "practice",
    prompt: "Quiz me with 3 short questions on ",
  },
];

export function learningModeOption(mode: LearningMode): LearningModeOption {
  return LEARNING_MODES.find((option) => option.id === mode) ?? LEARNING_MODES[0];
}

export function isLearningMode(value: unknown): value is LearningMode {
  return (
    value === "direct" ||
    value === "solve" ||
    value === "mentor" ||
    value === "simple" ||
    value === "write" ||
    value === "practice"
  );
}

export function parseSlashMode(draft: string): { mode: LearningMode; remainder: string } | null {
  const match = draft.match(/^\s*\/([a-z0-9-]+)(?:\s+([\s\S]*))?$/i);
  if (!match) return null;
  const token = match[1].toLowerCase();
  const found = LEARNING_MODES.find((option) => option.aliases.includes(token));
  if (!found) return null;
  return { mode: found.id, remainder: (match[2] ?? "").trim() };
}

export function resolveDraftSubmission(draft: string, mode: LearningMode) {
  const parsed = parseSlashMode(draft);
  if (!parsed) {
    return {
      switchedMode: null,
      activeMode: mode,
      question: draft.trim(),
      requestText: draft,
    };
  }
  return {
    switchedMode: parsed.mode,
    activeMode: parsed.mode,
    question: parsed.remainder,
    requestText: parsed.remainder,
  };
}

export function matchingSlashModes(draft: string): LearningModeOption[] {
  const match = draft.match(/^\s*\/([a-z0-9-]*)$/i);
  if (!match) return [];
  const query = match[1].toLowerCase();
  if (!query) return [...LEARNING_MODES];
  return LEARNING_MODES.filter(
    (option) =>
      option.id.startsWith(query) ||
      option.label.toLowerCase().startsWith(query) ||
      (query.length >= 2 && option.aliases.some((alias) => alias.startsWith(query))),
  );
}
