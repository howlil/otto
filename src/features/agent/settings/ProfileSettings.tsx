import type { AssistantProfile } from "../../../platform/tauri";
import { Button, SettingBlock, Text, TextArea, TextField } from "../../../shared/ui";
import {
  MAX_PROFILE_FIELD_LENGTH,
  MAX_PROFILE_INSTRUCTIONS_LENGTH,
  emptyAssistantProfile,
  hasAssistantProfile,
} from "../model/assistant-profile";

export function ProfileSettings({
  profile = emptyAssistantProfile,
  onChange,
  onClear,
}: {
  profile?: AssistantProfile;
  onChange?: (next: AssistantProfile) => void;
  onClear?: () => void;
}) {
  const filled = hasAssistantProfile(profile);
  const update = (patch: Partial<AssistantProfile>) => onChange?.({ ...profile, ...patch });

  return (
    <SettingBlock
      title="Profile & learning style"
      help="Tell Otto how you like answers explained"
      action={
        filled ? (
          <Button variant="quiet" size="link" className="text-otto-text-tertiary" onClick={onClear}>
            Clear
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-3">
        <div className="grid min-w-0 grid-cols-2 gap-2">
          <div className="min-w-0">
            <Text
              as="label"
              variant="meta"
              htmlFor="otto-profile-language"
              className="mb-1 block text-otto-text-secondary"
            >
              Answer language
            </Text>
            <TextField
              id="otto-profile-language"
              value={profile.language}
              maxLength={MAX_PROFILE_FIELD_LENGTH}
              placeholder="e.g. Indonesian, English"
              density="compact"
              onChange={(event) => update({ language: event.target.value })}
            />
          </div>
          <div className="min-w-0">
            <Text
              as="label"
              variant="meta"
              htmlFor="otto-profile-level"
              className="mb-1 block text-otto-text-secondary"
            >
              Level & tone
            </Text>
            <TextField
              id="otto-profile-level"
              value={profile.level}
              maxLength={MAX_PROFILE_FIELD_LENGTH}
              placeholder="e.g. Beginner, friendly"
              density="compact"
              onChange={(event) => update({ level: event.target.value })}
            />
          </div>
        </div>
        <div className="min-w-0">
          <Text
            as="label"
            variant="meta"
            htmlFor="otto-profile-instructions"
            className="mb-1 block text-otto-text-secondary"
          >
            About you & learning preferences
          </Text>
          <TextArea
            id="otto-profile-instructions"
            rows={3}
            value={profile.instructions}
            maxLength={MAX_PROFILE_INSTRUCTIONS_LENGTH}
            placeholder="Topics you are learning, preferred analogies, or response style…"
            className="block w-full resize-none rounded-otto-control border border-otto-line bg-otto-field-deep px-2.5 py-2 text-otto-sm leading-[1.45] text-otto-text-bright outline-none placeholder:text-otto-text-subtle focus:border-otto-line-focused"
            onChange={(event) => update({ instructions: event.target.value })}
          />
          <Text as="p" variant="caption" className="mt-1 text-otto-text-tertiary">
            Used in every new answer. Saved only on this PC.
          </Text>
        </div>
      </div>
    </SettingBlock>
  );
}
