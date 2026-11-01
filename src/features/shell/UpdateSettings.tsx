import { Button, Text } from "../../shared/ui";
import type { AppUpdateState } from "./useAppUpdate";

export function UpdateSettings({
  update,
}: {
  update: {
    state: AppUpdateState;
    checkForUpdate: () => Promise<void>;
    installUpdate: () => Promise<void>;
  };
}) {
  const { state } = update;
  const label =
    state.status === "checking"
      ? "Checking for updates…"
      : state.status === "current"
        ? "Otto is up to date."
        : state.status === "available"
          ? `Version ${state.version} is ready.`
          : state.status === "installing"
            ? "Installing update…"
            : "Update check unavailable.";
  return (
    <div className="mt-5 border-t border-otto-line-soft pt-3">
      <Text as="span" variant="meta" className="mb-1 block text-otto-text-secondary">
        Software update
      </Text>
      <div className="flex items-center justify-between gap-3">
        <Text as="span" variant="caption" className="text-otto-text-tertiary">
          {label}
        </Text>
        {state.status === "available" ? (
          <Button variant="quiet" size="link" onClick={() => void update.installUpdate()}>
            Update now
          </Button>
        ) : state.status === "error" ? (
          <Button variant="quiet" size="link" onClick={() => void update.checkForUpdate()}>
            Try again
          </Button>
        ) : null}
      </div>
    </div>
  );
}
