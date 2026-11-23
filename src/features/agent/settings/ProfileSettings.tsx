import type { AssistantProfile } from "../../../platform/tauri";
import { Button, IconButton, SettingBlock, Text, TextArea, TextField } from "../../../shared/ui";
import {
  MAX_PROFILE_FIELD_LENGTH,
  MAX_PROFILE_FOCUS_LENGTH,
  MAX_PROFILE_INSTRUCTIONS_LENGTH,
  MAX_PROFILE_NAME_LENGTH,
  MAX_PROFILE_ROLE_LENGTH,
  emptyAssistantProfile,
  hasAssistantProfile,
} from "../model/assistant-profile";

function ProfileTextField({
  id,
  label,
  value,
  maxLength,
  placeholder,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  maxLength: number;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="min-w-0">
      <Text
        as="label"
        variant="caption"
        htmlFor={id}
        className="mb-1 block text-otto-text-tertiary"
      >
        {label}
      </Text>
      <TextField
        id={id}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        density="compact"
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

export function ProfileSettings({
  profile = emptyAssistantProfile,
  onChange,
  onClear,
  onStartOnboarding,
}: {
  profile?: AssistantProfile;
  onChange?: (next: AssistantProfile) => void;
  onClear?: () => void;
  onStartOnboarding?: () => void;
}) {
  const filled = hasAssistantProfile(profile);
  const update = (patch: Partial<AssistantProfile>) => onChange?.({ ...profile, ...patch });

  return (
    <SettingBlock
      title="Profile"
      icon="user"
      action={
        <div className="flex items-center gap-1">
          {onStartOnboarding && (
            <Button variant="quiet" size="link" icon="assistant" onClick={onStartOnboarding}>
              Setup guide
            </Button>
          )}
          {filled && (
            <IconButton
              icon="delete"
              label="Clear"
              title="Clear profile"
              variant="quiet"
              size={14}
              onClick={onClear}
            />
          )}
        </div>
      }
    >
      <div className="space-y-2.5">
        <div className="grid min-w-0 grid-cols-2 gap-2">
          <ProfileTextField
            id="otto-profile-name"
            label="Name"
            value={profile.name}
            maxLength={MAX_PROFILE_NAME_LENGTH}
            placeholder="What should Otto call you?"
            onChange={(name) => update({ name })}
          />
          <ProfileTextField
            id="otto-profile-role"
            label="Role"
            value={profile.role}
            maxLength={MAX_PROFILE_ROLE_LENGTH}
            placeholder="Student, Developer, Designer…"
            onChange={(role) => update({ role })}
          />
        </div>
        <ProfileTextField
          id="otto-profile-focus"
          label="Focus & interests"
          value={profile.focus}
          maxLength={MAX_PROFILE_FOCUS_LENGTH}
          placeholder="Topics, subjects, or goals…"
          onChange={(focus) => update({ focus })}
        />
        <div className="grid min-w-0 grid-cols-2 gap-2">
          <ProfileTextField
            id="otto-profile-language"
            label="Answer language"
            value={profile.language}
            maxLength={MAX_PROFILE_FIELD_LENGTH}
            placeholder="Auto, Indonesian, English…"
            onChange={(language) => update({ language })}
          />
          <ProfileTextField
            id="otto-profile-level"
            label="Level & tone"
            value={profile.level}
            maxLength={MAX_PROFILE_FIELD_LENGTH}
            placeholder="Concise & direct, Warm & guided…"
            onChange={(level) => update({ level })}
          />
        </div>
        <div className="min-w-0">
          <Text
            as="label"
            variant="caption"
            htmlFor="otto-profile-instructions"
            className="mb-1 block text-otto-text-tertiary"
          >
            Instructions
          </Text>
          <TextArea
            id="otto-profile-instructions"
            rows={3}
            value={profile.instructions}
            maxLength={MAX_PROFILE_INSTRUCTIONS_LENGTH}
            placeholder="Preferred style, topics, or analogies…"
            className="block w-full resize-none rounded-otto-control border border-otto-line-mid bg-otto-field-deep px-2.5 py-2 text-otto-sm leading-[1.45] text-otto-text-bright outline-none placeholder:text-otto-text-subtle focus:border-otto-line-focused"
            onChange={(event) => update({ instructions: event.target.value })}
          />
        </div>
      </div>
    </SettingBlock>
  );
}
