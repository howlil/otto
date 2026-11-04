import { useEffect } from "react";
import { Button, ChoiceGroup, StatusMessage, Text, TextField } from "../../shared/ui";
import type { CaptureSource } from "../../platform/tauri";
import type { CaptureShortcutModel } from "./view-model";

function CaptureSourceField({
  source,
  selectSource,
  disabled,
}: Pick<CaptureShortcutModel, "source" | "selectSource"> & { disabled: boolean }) {
  return (
    <fieldset className="border-0 p-0" aria-labelledby="otto-capture-source-label">
      <legend
        id="otto-capture-source-label"
        className="mb-2 block text-otto-sm font-medium leading-[1.35] text-otto-text-secondary"
      >
        Source
      </legend>
      <ChoiceGroup<CaptureSource>
        value={source}
        choices={[
          { value: "window", label: "Last focused window" },
          { value: "fullScreen", label: "Full screen" },
        ]}
        onChange={(next) => void selectSource(next)}
        disabled={disabled}
        presentation="row"
      />
    </fieldset>
  );
}

export function AgentCaptureSettings({
  capture,
  focusCaptureShortcut,
}: {
  capture: CaptureShortcutModel;
  focusCaptureShortcut: boolean;
}) {
  const {
    source,
    selectSource,
    targetTitle,
    targetWarning,
    targetPending,
    refreshTarget,
    sourceReady,
    sourcePending,
    shortcut,
    setShortcut,
    captureMessage,
    savingCapture,
    available,
    saveShortcut,
  } = capture;

  useEffect(() => {
    if (!focusCaptureShortcut || !available) return;
    const frame = requestAnimationFrame(() => {
      document.getElementById("otto-capture-shortcut")?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusCaptureShortcut, available]);

  useEffect(() => {
    if (source === "window" && sourceReady) void refreshTarget();
  }, [source, sourceReady, refreshTarget]);

  return (
    <section className="border-b border-otto-raised-deep py-3">
      <Text
        as="label"
        variant="label"
        className="block text-otto-text-secondary"
        htmlFor="otto-capture-shortcut"
      >
        Shortcut
      </Text>
      <Text as="p" variant="caption" className="mt-1 text-otto-text-tertiary">
        Only a manual action sends an image.
      </Text>
      <div className="mt-2 flex items-center gap-2 rounded-otto-control border border-otto-line-mid bg-otto-field-deep px-2">
        <TextField
          id="otto-capture-shortcut"
          value={shortcut}
          onChange={(event) => setShortcut(event.target.value)}
          placeholder="Ctrl+Shift+O"
          disabled={!available || savingCapture || sourcePending || !sourceReady}
          spellCheck={false}
          appearance="embedded"
          className="min-w-0 flex-1"
        />
        <Button
          variant="primary"
          size="sm"
          disabled={!available || savingCapture || sourcePending || !sourceReady}
          onClick={() => void saveShortcut()}
        >
          Save
        </Button>
      </div>
      <div className="mt-3">
        <CaptureSourceField
          source={source}
          selectSource={selectSource}
          disabled={!available || savingCapture || sourcePending}
        />
      </div>
      {available && sourcePending && (
        <Text as="p" variant="caption" className="mt-2 text-otto-text-tertiary" role="status">
          Confirming capture source…
        </Text>
      )}
      {available && !sourcePending && !sourceReady && (
        <StatusMessage
          tone="warn"
          className="mt-2"
          action={{ label: "Retry", onClick: () => void selectSource(source) }}
        >
          Capture source is not confirmed. Retry before using the shortcut.
        </StatusMessage>
      )}
      {source === "window" && sourceReady && (
        <div className="mt-2 flex items-center gap-2">
          <Text
            as="span"
            variant="caption"
            className="min-w-0 flex-1 truncate text-otto-text-tertiary"
            title={targetTitle ?? targetWarning ?? undefined}
          >
            {targetPending
              ? "Checking last window…"
              : targetTitle
                ? `Last observed: ${targetTitle}`
                : (targetWarning ?? "Focus another app to select a capture target.")}
          </Text>
          <Button
            variant="quiet"
            size="xs"
            disabled={targetPending}
            onClick={() => void refreshTarget()}
          >
            Refresh
          </Button>
        </div>
      )}
      {!available && (
        <StatusMessage tone="info" className="mt-2">
          Screen capture shortcuts can only be configured in Otto for Windows.
        </StatusMessage>
      )}
      {captureMessage && (
        <StatusMessage tone="info" className="mt-2">
          {captureMessage}
        </StatusMessage>
      )}
    </section>
  );
}
