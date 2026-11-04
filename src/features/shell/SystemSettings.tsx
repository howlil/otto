import { Text, Toggle } from "../../shared/ui";
import type { Preferences } from "./preferences";

function captureStatus(
  supported: boolean,
  pending: boolean,
  error: string | null,
  protectedState: boolean | null,
) {
  if (!supported) return "Requires Otto for Windows.";
  if (pending) return "Applying Windows capture setting…";
  if (error) return error;
  if (protectedState === true)
    return "Capture exclusion is enabled for supported Windows recorders.";
  if (protectedState === false) return "Capture exclusion is off. Otto may appear in recordings.";
  return "Windows capture state is unavailable.";
}

export function SystemSettings({
  prefs,
  change,
  captureProtected,
  captureProtectionSupported,
  captureProtectionPending,
  captureProtectionError,
  onCaptureProtectionChange,
  osEventsError,
}: {
  prefs: Preferences;
  change: (patch: Partial<Preferences>) => void;
  captureProtected: boolean | null;
  captureProtectionSupported: boolean;
  captureProtectionPending: boolean;
  captureProtectionError: string | null;
  onCaptureProtectionChange: (enabled: boolean) => Promise<void>;
  osEventsError: string | null;
}) {
  return (
    <div className="mt-3 border-t border-otto-line-soft pt-2">
      <Toggle
        title="Show OS events"
        help="Show transient volume, brightness, network, Bluetooth and battery updates."
        checked={prefs.osEventsEnabled}
        onChange={(osEventsEnabled) => change({ osEventsEnabled })}
      />
      {osEventsError && (
        <Text as="p" variant="caption" className="mt-2 text-otto-text-tertiary" role="status">
          {osEventsError}
        </Text>
      )}
      <Toggle
        title="Hide Otto from screen capture"
        help="Best effort: some recorders may still show Otto."
        checked={captureProtected ?? prefs.hideFromCapture}
        disabled={!captureProtectionSupported || captureProtectionPending}
        onChange={(enabled) => void onCaptureProtectionChange(enabled)}
      />
      <Text as="p" variant="caption" className="mt-2 text-otto-text-tertiary" role="status">
        {captureStatus(
          captureProtectionSupported,
          captureProtectionPending,
          captureProtectionError,
          captureProtected,
        )}
      </Text>
    </div>
  );
}
