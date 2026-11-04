import { Button, SegmentedControl, Text } from "../../shared/ui";
import { defaults, type Preferences } from "./preferences";
import { SystemSettings } from "./SystemSettings";
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
  osEventsError,
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
  osEventsError: string | null;
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
          change(defaults);
          if (captureProtectionSupported) void onCaptureProtectionChange(defaults.hideFromCapture);
        }}
      >
        Restore defaults
      </Button>
      <SystemSettings
        prefs={prefs}
        change={change}
        captureProtected={captureProtected}
        captureProtectionSupported={captureProtectionSupported}
        captureProtectionPending={captureProtectionPending}
        captureProtectionError={captureProtectionError}
        onCaptureProtectionChange={onCaptureProtectionChange}
        osEventsError={osEventsError}
      />
      <UpdateSettings update={update} />
    </>
  );
}
