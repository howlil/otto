import { useState } from "react";
import { Button, SettingRow, StatusMessage, Text, Toggle } from "../../../../shared/ui";
import type { AppUpdateState } from "../../hooks/useAppUpdate";
import type { Preferences } from "../../model/preferences";
import { BackgroundSettings } from "./BackgroundSettings";
import { LogoCustomizer } from "./LogoCustomizer";

function updateStatusText(state: AppUpdateState): string | null {
  switch (state.status) {
    case "checking":
      return "Checking…";
    case "current":
      return "Up to date";
    case "installing":
      return "Installing…";
    default:
      return null;
  }
}

function captureNotice(
  supported: boolean,
  pending: boolean,
  error: string | null,
  protectedState: boolean | null,
): string | null {
  if (!supported) return "Requires Otto for Windows.";
  if (pending) return "Applying capture setting…";
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
  const statusLabel = updateStatusText(state);
  return (
    <div className="space-y-3">
      <BackgroundSettings prefs={prefs} change={change} />
      <LogoCustomizer />
      <div className="space-y-1">
        <Toggle
          icon="eyeOff"
          title="Hide from screen capture"
          titleHint="Keeps Otto out of screenshots and recordings when supported"
          checked={captureProtected ?? prefs.hideFromCapture}
          disabled={!captureProtectionSupported || captureProtectionPending}
          onChange={(enabled) => void setCaptureProtection(enabled)}
        />
        {notice && (
          <StatusMessage tone={captureProtectionError ? "error" : "info"}>{notice}</StatusMessage>
        )}
        <SettingRow
          icon="download"
          title="Updates"
          help={state.status === "available" ? `Version ${state.version}` : undefined}
        >
          {state.status === "available" ? (
            <Button
              variant="primary"
              size="xs"
              icon="download"
              onClick={() => void update.installUpdate()}
            >
              Update now
            </Button>
          ) : state.status === "error" ? (
            <Button
              variant="secondary"
              size="xs"
              icon="refresh"
              onClick={() => void update.checkForUpdate()}
            >
              Try again
            </Button>
          ) : (
            statusLabel && (
              <Text as="span" variant="meta" className="text-otto-text-tertiary">
                {statusLabel}
              </Text>
            )
          )}
        </SettingRow>
        <SettingRow icon="power" title="Quit Otto">
          <Button
            size="xs"
            icon="power"
            className="hover:border-otto-danger/45 hover:text-otto-danger-copy"
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
    </div>
  );
}
