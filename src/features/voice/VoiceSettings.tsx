import {
  ChoiceGroup,
  Range,
  SelectField,
  SettingGroup,
  SettingRow,
  ShortcutRecorder,
  StatusMessage,
  Toggle,
} from "../../shared/ui";
import type { VoiceLanguage } from "../../platform/tauri";
import { TTS_RATE_RANGE, type ReadAloudMode } from "./preferences";
import { DEFAULT_VOICE_SHORTCUT, recordVoiceShortcut } from "./shortcut-keys";
import type { VoiceViewModel } from "./view-model";
import { VoiceModelPicker } from "./VoiceModelPicker";

const languageChoices: ReadonlyArray<{ value: VoiceLanguage; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "id", label: "Indonesian" },
  { value: "en", label: "English" },
];

const readAloudChoices: ReadonlyArray<{ value: ReadAloudMode; label: string }> = [
  { value: "off", label: "Off" },
  { value: "voice-only", label: "Voice replies" },
  { value: "always", label: "Always" },
];

export function VoiceSettings({ voice }: { voice: VoiceViewModel }) {
  const { prefs, updatePrefs, devices, snapshot } = voice;
  const [minRate, maxRate] = TTS_RATE_RANGE;

  return (
    <div className="space-y-4">
      <VoiceModelPicker voice={voice} />
      <SettingGroup title="Voice input">
        <SettingRow
          title="Voice shortcut"
          help="Start or stop speaking from any app"
          htmlFor="otto-voice-shortcut"
        >
          <ShortcutRecorder
            id="otto-voice-shortcut"
            value={voice.shortcut}
            defaultValue={DEFAULT_VOICE_SHORTCUT}
            disabled={!snapshot.supported || voice.shortcutBusy}
            record={recordVoiceShortcut}
            onRecord={(next) => void voice.saveShortcut(next)}
          />
        </SettingRow>
        {voice.shortcutMessage && (
          <StatusMessage tone="warn">{voice.shortcutMessage}</StatusMessage>
        )}
        <SettingRow title="Microphone" help="Audio input device" htmlFor="otto-voice-mic">
          <SelectField
            id="otto-voice-mic"
            density="compact"
            className="max-w-[215px]"
            value={prefs.deviceId}
            onChange={(event) => updatePrefs({ deviceId: event.target.value })}
          >
            {devices.map((device) => (
              <option key={device.id} value={device.id}>
                {device.name}
              </option>
            ))}
          </SelectField>
        </SettingRow>
        <SettingRow title="Spoken language" help="Auto-detect or lock to one language">
          <ChoiceGroup<VoiceLanguage>
            value={prefs.language}
            choices={languageChoices}
            onChange={(language) => updatePrefs({ language })}
          />
        </SettingRow>
        <Toggle
          title="Auto-stop on silence"
          help="Finish recording automatically when you pause speaking"
          checked={prefs.autoStopSilence}
          onChange={(autoStopSilence) => updatePrefs({ autoStopSilence })}
        />
        <Toggle
          title="Auto-send voice"
          help="Off: places your transcript in the composer so you can review it first"
          checked={prefs.autoSend}
          onChange={(autoSend) => updatePrefs({ autoSend })}
        />
      </SettingGroup>
      <SettingGroup title="Read aloud">
        <SettingRow title="Auto-read answers" help="Speak completed answers with Windows voice">
          <ChoiceGroup<ReadAloudMode>
            value={prefs.readAloudMode}
            choices={readAloudChoices}
            onChange={(readAloudMode) => updatePrefs({ readAloudMode })}
          />
        </SettingRow>
        <SettingRow title="Speaking voice" help="Installed Windows voice" htmlFor="otto-tts-voice">
          <SelectField
            id="otto-tts-voice"
            density="compact"
            className="max-w-[215px]"
            value={prefs.ttsVoiceUri}
            onChange={(event) => updatePrefs({ ttsVoiceUri: event.target.value })}
          >
            <option value="auto">Automatic (match answer language)</option>
            {voice.ttsVoices.map((item) => (
              <option key={item.uri} value={item.uri}>
                {item.name} ({item.lang})
              </option>
            ))}
          </SelectField>
        </SettingRow>
        <Range
          label="Speaking speed"
          value={Math.round(prefs.ttsRate * 100)}
          min={Math.round(minRate * 100)}
          max={Math.round(maxRate * 100)}
          unit="%"
          onChange={(percent) => updatePrefs({ ttsRate: percent / 100 })}
        />
      </SettingGroup>
    </div>
  );
}
