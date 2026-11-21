import { useState } from "react";
import {
  Button,
  ChoiceGroup,
  Range,
  SettingRow,
  StatusMessage,
  Toggle,
} from "../../../../shared/ui";
import type { AppUpdateState } from "../../hooks/useAppUpdate";
import {
  BACKGROUND_OPACITY_RANGE,
  type BackgroundStyle,
  type Preferences,
} from "../../model/preferences";

const backgroundChoices = [
  { value: "solid" as const, label: "Solid" },
  { value: "transparent" as const, label: "Transparent" },
];

function BackgroundSettings({
  prefs,
  change,
}: {
  prefs: Preferences;
  change: (patch: Partial<Preferences>) => void;
}) {
  const [minOpacity, maxOpacity] = BACKGROUND_OPACITY_RANGE;
  return (
    <>
      <SettingRow title="Background" help="Solid dark or see-through surface">
        <ChoiceGroup<BackgroundStyle>
          value={prefs.backgroundStyle}
          choices={backgroundChoices}
          onChange={(backgroundStyle) => change({ backgroundStyle })}
        />
      </SettingRow>
      {prefs.backgroundStyle === "transparent" && (
        <Range
          label="Opacity"
          value={prefs.backgroundOpacity}
          min={minOpacity}
          max={maxOpacity}
          unit="%"
          onChange={(backgroundOpacity) => change({ backgroundOpacity })}
        />
      )}
    </>
  );
}

function updateHelp(state: AppUpdateState): string {
  switch (state.status) {
    case "checking":
      return "Checking for updates…";
    case "current":
      return "Otto is up to date";
    case "available":
      return `Version ${state.version} is ready`;
    case "installing":
      return "Installing update…";
    default:
      return "Update check unavailable";
  }
}

function captureNotice(
  supported: boolean,
  pending: boolean,
  error: string | null,
  protectedState: boolean | null,
): string | null {
  if (!supported) return "Requires Otto for Windows.";
  if (pending) return "Applying the Windows capture setting…";
  if (error) return error;
  if (protectedState === null) return "Windows capture state is unavailable.";
  return null;
}

export function GeneralSettings({
  prefs,
  change,
  update,
  captureProtected,
  captureProtectionSupported,
  captureProtectionPending,
  captureProtectionError,
  setCaptureProtection,
  quitSupported,
  onQuit,
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
  setCaptureProtection: (enabled: boolean) => Promise<void>;
  quitSupported: boolean;
  onQuit: () => Promise<void>;
}) {
  const [quitPending, setQuitPending] = useState(false);
  const [quitError, setQuitError] = useState<string | null>(null);
  const notice = captureNotice(
    captureProtectionSupported,
    captureProtectionPending,
    captureProtectionError,
    captureProtected,
  );
  const { state } = update;
  return (
    <div>
      <BackgroundSettings prefs={prefs} change={change} />
      <Toggle
        title="Hide from screen capture"
        help="Best effort. Some recorders may still show Otto."
        checked={captureProtected ?? prefs.hideFromCapture}
        disabled={!captureProtectionSupported || captureProtectionPending}
        onChange={(enabled) => void setCaptureProtection(enabled)}
      />
      {notice && (
        <StatusMessage tone={captureProtectionError ? "error" : "info"}>{notice}</StatusMessage>
      )}
      <SettingRow title="Updates" help={updateHelp(state)}>
        {state.status === "available" && (
          <Button size="xs" onClick={() => void update.installUpdate()}>
            Update now
          </Button>
        )}
        {state.status === "error" && (
          <Button variant="quiet" size="xs" onClick={() => void update.checkForUpdate()}>
            Try again
          </Button>
        )}
      </SettingRow>
      <SettingRow title="Quit Otto" help="Stops active AI work">
        <Button
          size="xs"
          disabled={!quitSupported || quitPending}
          aria-busy={quitPending}
          onClick={() => {
            setQuitPending(true);
            setQuitError(null);
            void onQuit().catch((error) => {
              setQuitPending(false);
              setQuitError(error instanceof Error ? error.message : String(error));
            });
          }}
        >
          {quitPending ? "Quitting…" : "Quit"}
        </Button>
      </SettingRow>
      {quitError && <StatusMessage tone="error">{quitError}</StatusMessage>}
    </div>
  );
}
