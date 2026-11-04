import { Button, Range, SegmentedControl, SettingsSection, Text } from "../../shared/ui";
import type { Preferences } from "./preferences";

export function GeneralSettings({
  prefs,
  change,
  onRestoreDefaults,
  captureProtectionPending,
}: {
  prefs: Preferences;
  change: (patch: Partial<Preferences>) => void;
  onRestoreDefaults: () => void;
  captureProtectionPending: boolean;
}) {
  return (
    <SettingsSection title="Appearance">
      <div className="mb-[14px]">
        <Text as="span" variant="meta" className="mb-2 block text-otto-text-secondary">
          Idle expression
        </Text>
        <SegmentedControl
          value={prefs.expression}
          onChange={(expression) => change({ expression })}
          choices={[
            { value: "calm", label: "Calm" },
            { value: "curious", label: "Curious" },
            { value: "sleepy", label: "Sleepy" },
            { value: "happy", label: "Happy" },
          ]}
        />
      </div>
      <div className="mb-[14px]">
        <Text as="span" variant="meta" className="mb-2 block text-otto-text-secondary">
          Idle response
        </Text>
        <SegmentedControl
          value={prefs.reactive}
          onChange={(reactive) => change({ reactive })}
          choices={[
            { value: "quiet", label: "Quiet" },
            { value: "alive", label: "Alive" },
          ]}
        />
      </div>
      <Button
        variant="quiet"
        size="link"
        className="justify-start"
        disabled={captureProtectionPending}
        onClick={onRestoreDefaults}
      >
        Restore defaults
      </Button>
      <details className="mt-3 border-t border-otto-line-soft pt-2">
        <summary className="cursor-pointer list-none text-otto-sm text-otto-text-secondary">
          Artwork tuning
        </summary>
        <div className="pt-1">
          <Range
            label="Artwork tilt"
            value={prefs.tilt}
            min={0}
            max={65}
            unit="°"
            onChange={(tilt) => change({ tilt })}
          />
          <Range
            label="Tonal gradient"
            value={prefs.gradient}
            min={0}
            max={100}
            unit="%"
            onChange={(gradient) => change({ gradient })}
          />
        </div>
      </details>
    </SettingsSection>
  );
}
