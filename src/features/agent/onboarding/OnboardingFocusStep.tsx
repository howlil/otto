import type { KeyboardEvent } from "react";
import type { AssistantProfile } from "../../../platform/tauri";
import { Text, TextField } from "../../../shared/ui";
import { MAX_PROFILE_FOCUS_LENGTH } from "../model/assistant-profile";
import {
  focusSuggestionsForRole,
  hasFocusTopic,
  toggleFocusTopic,
} from "../model/onboarding-presets";

export function OnboardingFocusStep({
  profile,
  onPatch,
  onEnterNext,
}: {
  profile: AssistantProfile;
  onPatch: (patch: Partial<AssistantProfile>) => void;
  onEnterNext: () => void;
}) {
  const { placeholder, suggestions } = focusSuggestionsForRole(profile.role);
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    onEnterNext();
  };

  return (
    <div className="space-y-2.5">
      <div className="min-w-0">
        <Text
          as="label"
          variant="caption"
          htmlFor="otto-onboarding-focus"
          className="mb-1 block text-otto-text-tertiary"
        >
          Topics, subjects, or work you focus on
        </Text>
        <TextField
          id="otto-onboarding-focus"
          value={profile.focus}
          maxLength={MAX_PROFILE_FOCUS_LENGTH}
          placeholder={placeholder}
          density="compact"
          onKeyDown={handleKeyDown}
          onChange={(event) => onPatch({ focus: event.target.value })}
        />
      </div>
      <div className="min-w-0">
        <Text as="span" variant="caption" className="mb-1.5 block text-otto-text-tertiary">
          Quick picks (tap to add)
        </Text>
        <div className="flex flex-wrap gap-1.5">
          {suggestions.map((topic) => {
            const selected = hasFocusTopic(profile.focus, topic);
            return (
              <button
                key={topic}
                type="button"
                aria-pressed={selected}
                onClick={() => onPatch({ focus: toggleFocusTopic(profile.focus, topic) })}
                className={`inline-flex h-7 items-center rounded-otto-chip border px-2.5 text-otto-xs font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-otto-input-selected ${
                  selected
                    ? "border-otto-line-focused bg-otto-selected text-otto-text"
                    : "border-otto-line-mid bg-otto-field-deep text-otto-text-secondary hover:border-otto-line-hover hover:bg-otto-control-hover hover:text-otto-text"
                }`}
              >
                {topic}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
