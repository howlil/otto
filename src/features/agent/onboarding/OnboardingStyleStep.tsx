import type { KeyboardEvent } from "react";
import type { AssistantProfile } from "../../../platform/tauri";
import { Text, TextField } from "../../../shared/ui";
import { MAX_PROFILE_FIELD_LENGTH, profileSummaryLabel } from "../model/assistant-profile";
import { ONBOARDING_LANGUAGES, ONBOARDING_STYLES } from "../model/onboarding-presets";

function isPresetLanguage(language: string): boolean {
  const normalized = language.trim().toLowerCase();
  return ONBOARDING_LANGUAGES.some((item) => item.value.toLowerCase() === normalized);
}

function LanguageChipSection({
  language,
  showCustomInput,
  onSelectPreset,
  onOpenCustom,
  onChangeCustom,
  onEnterFinish,
}: {
  language: string;
  showCustomInput: boolean;
  onSelectPreset: (value: string) => void;
  onOpenCustom: () => void;
  onChangeCustom: (value: string) => void;
  onEnterFinish: () => void;
}) {
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    onEnterFinish();
  };

  return (
    <div className="min-w-0">
      <Text as="span" variant="caption" className="mb-1.5 block text-otto-text-tertiary">
        Preferred answer language
      </Text>
      <div className="flex flex-wrap gap-1.5">
        {ONBOARDING_LANGUAGES.map((item) => {
          const selected =
            !showCustomInput && language.trim().toLowerCase() === item.value.toLowerCase();
          return (
            <button
              key={item.label}
              type="button"
              aria-pressed={selected}
              onClick={() => onSelectPreset(item.value)}
              className={`inline-flex h-7 items-center rounded-otto-chip border px-2.5 text-otto-xs font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-otto-input-selected ${
                selected
                  ? "border-otto-line-focused bg-otto-selected text-otto-text"
                  : "border-otto-line-mid bg-otto-field-deep text-otto-text-secondary hover:border-otto-line-hover hover:bg-otto-control-hover hover:text-otto-text"
              }`}
            >
              {item.label}
            </button>
          );
        })}
        <button
          type="button"
          aria-pressed={showCustomInput}
          onClick={onOpenCustom}
          className={`inline-flex h-7 items-center rounded-otto-chip border px-2.5 text-otto-xs font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-otto-input-selected ${
            showCustomInput
              ? "border-otto-line-focused bg-otto-selected text-otto-text"
              : "border-otto-line-mid bg-otto-field-deep text-otto-text-secondary hover:border-otto-line-hover hover:bg-otto-control-hover hover:text-otto-text"
          }`}
        >
          Other
        </button>
      </div>
      {showCustomInput && (
        <div className="mt-2">
          <Text
            as="label"
            variant="caption"
            htmlFor="otto-onboarding-language"
            className="mb-1 block text-otto-text-tertiary"
          >
            Custom language
          </Text>
          <TextField
            id="otto-onboarding-language"
            value={language}
            maxLength={MAX_PROFILE_FIELD_LENGTH}
            placeholder="e.g. Japanese, Javanese, Spanish…"
            density="compact"
            onKeyDown={handleKeyDown}
            onChange={(event) => onChangeCustom(event.target.value)}
          />
        </div>
      )}
    </div>
  );
}

export function OnboardingStyleStep({
  profile,
  customLanguageOpen,
  onToggleCustomLanguage,
  onPatch,
  onEnterFinish,
}: {
  profile: AssistantProfile;
  customLanguageOpen: boolean;
  onToggleCustomLanguage: (open: boolean) => void;
  onPatch: (patch: Partial<AssistantProfile>) => void;
  onEnterFinish: () => void;
}) {
  const showCustomInput = customLanguageOpen || !isPresetLanguage(profile.language);
  const summary = profileSummaryLabel(profile);

  return (
    <div className="space-y-2.5">
      <LanguageChipSection
        language={profile.language}
        showCustomInput={showCustomInput}
        onSelectPreset={(value) => {
          onToggleCustomLanguage(false);
          onPatch({ language: value });
        }}
        onOpenCustom={() => onToggleCustomLanguage(true)}
        onChangeCustom={(language) => onPatch({ language })}
        onEnterFinish={onEnterFinish}
      />
      <div className="min-w-0">
        <Text as="span" variant="caption" className="mb-1.5 block text-otto-text-tertiary">
          How should Otto explain things?
        </Text>
        <div className="grid grid-cols-2 gap-1.5">
          {ONBOARDING_STYLES.map((style) => {
            const selected = profile.level.trim().toLowerCase() === style.value.toLowerCase();
            return (
              <button
                key={style.value}
                type="button"
                aria-pressed={selected}
                onClick={() => onPatch({ level: selected ? "" : style.value })}
                className={`flex flex-col items-start rounded-otto-panel border px-2.5 py-2 text-left transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-otto-input-selected ${
                  selected
                    ? "border-otto-line-focused bg-otto-selected"
                    : "border-otto-line-mid bg-otto-field-deep hover:border-otto-line-hover hover:bg-otto-control-hover"
                }`}
              >
                <Text as="span" variant="status" className="text-otto-text-bright">
                  {style.label}
                </Text>
                <Text as="span" variant="caption" className="mt-0.5 text-otto-text-tertiary">
                  {style.hint}
                </Text>
              </button>
            );
          })}
        </div>
      </div>
      {summary && (
        <Text as="p" variant="caption" className="m-0 truncate text-otto-ok">
          Personalizing prompts for: {summary}
        </Text>
      )}
    </div>
  );
}
