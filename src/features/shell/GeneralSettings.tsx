import { Button, SegmentedControl, Text, Toggle } from "../../shared/ui";
import { defaults, type Preferences } from "./preferences";
import { UpdateSettings } from "./UpdateSettings";
import type { AppUpdateState } from "./useAppUpdate";

export function GeneralSettings({
  prefs,
  change,
  update,
  captureProtected,
  captureProtectionSupported,
  captureProtectionPending,
  captureProtectionError,
  onCaptureProtectionChange,
}: {
  prefs: Preferences;
  change: (patch: Partial<Preferences>) => void;
  update: {
    state: AppUpdateState;
    checkForUpdate: () => Promise<void>;
    installUpdate: () => Promise<void>;
  };
  captureProtected: boolean | null;
  captureProtectionSupported: boolean;
  captureProtectionPending: boolean;
  captureProtectionError: string | null;
  onCaptureProtectionChange: (enabled: boolean) => Promise<void>;
}) {
  return (
    <>
      <Text as="h2" variant="heading" className="m-0 mb-[3px]">
        General
      </Text>
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
        onClick={() => {
          change({ ...defaults, hideFromCapture: prefs.hideFromCapture });
          if (captureProtectionSupported) void onCaptureProtectionChange(defaults.hideFromCapture);
        }}
      >
        Restore defaults
      </Button>
      <div className="mt-3 border-t border-otto-line-soft pt-2">
        <Toggle
          title="Hide Otto from screen capture"
          help="Best effort: some recorders may still show Otto."
          checked={captureProtected ?? prefs.hideFromCapture}
          disabled={!captureProtectionSupported || captureProtectionPending}
          onChange={(enabled) => void onCaptureProtectionChange(enabled)}
        />
        <Text as="p" variant="caption" className="mt-2 text-otto-text-tertiary" role="status">
          {!captureProtectionSupported
            ? "Requires Otto for Windows."
            : captureProtectionPending
              ? "Applying Windows capture setting…"
              : captureProtectionError
                ? captureProtectionError
                : captureProtected === true
                  ? "Capture exclusion is enabled for supported Windows recorders."
                  : captureProtected === false
                    ? "Capture exclusion is off. Otto may appear in recordings."
                    : "Windows capture state is unavailable."}
        </Text>
      </div>
      <UpdateSettings update={update} />
    </>
  );
}
