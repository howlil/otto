import type { KeyboardEvent } from "react";
import type { AssistantProfile } from "../../../platform/tauri";
import { Icon, Text, TextField } from "../../../shared/ui";
import { MAX_PROFILE_NAME_LENGTH, MAX_PROFILE_ROLE_LENGTH } from "../model/assistant-profile";
import { ONBOARDING_ROLES } from "../model/onboarding-presets";

export function OnboardingIdentityStep({
  profile,
  onPatch,
  onEnterNext,
}: {
  profile: AssistantProfile;
  onPatch: (patch: Partial<AssistantProfile>) => void;
  onEnterNext: () => void;
}) {
  const activeRole = profile.role.trim().toLowerCase();
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
          htmlFor="otto-onboarding-name"
          className="mb-1 block text-otto-text-tertiary"
        >
          What should Otto call you?
        </Text>
        <TextField
          id="otto-onboarding-name"
          value={profile.name}
          maxLength={MAX_PROFILE_NAME_LENGTH}
          placeholder="Your name or nickname (optional)"
          density="compact"
          onKeyDown={handleKeyDown}
          onChange={(event) => onPatch({ name: event.target.value })}
        />
      </div>
      <div className="min-w-0">
        <Text as="span" variant="caption" className="mb-1.5 block text-otto-text-tertiary">
          What best describes you?
        </Text>
        <div className="grid grid-cols-3 gap-1.5">
          {ONBOARDING_ROLES.map((preset) => {
            const selected = activeRole === preset.value.toLowerCase();
            return (
              <button
                key={preset.id}
                type="button"
                aria-pressed={selected}
                onClick={() => onPatch({ role: selected ? "" : preset.value })}
                className={`inline-flex h-8 min-w-0 items-center gap-1.5 rounded-otto-chip border px-2 text-left text-otto-xs font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-otto-input-selected ${
                  selected
                    ? "border-otto-line-focused bg-otto-selected text-otto-text"
                    : "border-otto-line-mid bg-otto-field-deep text-otto-text-secondary hover:border-otto-line-hover hover:bg-otto-control-hover hover:text-otto-text"
                }`}
              >
                <Icon
                  name={preset.icon}
                  size={13}
                  className={
                    selected ? "shrink-0 text-otto-text" : "shrink-0 text-otto-text-tertiary"
                  }
                />
                <span className="truncate">{preset.label}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="min-w-0">
        <Text
          as="label"
          variant="caption"
          htmlFor="otto-onboarding-role"
          className="mb-1 block text-otto-text-tertiary"
        >
          Or describe your role
        </Text>
        <TextField
          id="otto-onboarding-role"
          value={profile.role}
          maxLength={MAX_PROFILE_ROLE_LENGTH}
          placeholder="e.g. CS student, Product designer, Medical resident…"
          density="compact"
          onKeyDown={handleKeyDown}
          onChange={(event) => onPatch({ role: event.target.value })}
        />
      </div>
    </div>
  );
}
