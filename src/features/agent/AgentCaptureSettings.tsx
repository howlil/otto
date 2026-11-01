import { useEffect } from "react";
import { Button, ChoiceGroup, StatusMessage, Text, TextField } from "../../shared/ui";
import type { CaptureSource } from "../../platform/tauri";
import type { CaptureShortcutModel } from "./view-model";

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
        variant="meta"
        className="block text-otto-muted-strong"
        htmlFor="otto-capture-shortcut"
      >
        Screen capture shortcut
      </Text>
      <div className="mt-2 flex items-center gap-2 rounded-otto-control border border-otto-line-mid bg-otto-field-deep px-2">
        <TextField
          id="otto-capture-shortcut"
          value={shortcut}
          onChange={(event) => setShortcut(event.target.value)}
          placeholder="Ctrl+Shift+O"
          disabled={!available || savingCapture || sourcePending || !sourceReady}
          spellCheck={false}
          className="h-[34px] min-w-0 flex-1 bg-transparent text-otto-sm text-otto-knob outline-none"
        />
        <Button
          variant="primary"
          size="sm"
          disabled={!available || savingCapture || sourcePending || !sourceReady}
          onClick={() => void saveShortcut()}
        >
          Apply
        </Button>
      </div>
      <Text as="p" variant="caption" className="mt-1.5 text-otto-text-tertiary">
        Use Ctrl with Shift or Alt and one letter. Capture is triggered only by the shortcut; image
        analysis requires a compatible provider.
      </Text>
      <div className="mt-3">
        <ChoiceGroup<CaptureSource>
          value={source}
          choices={[
            { value: "window", label: "Last window" },
            { value: "fullScreen", label: "Full desktop" },
          ]}
          onChange={(next) => void selectSource(next)}
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
      <Text as="p" variant="caption" className="mt-2 text-otto-text-tertiary">
        {source === "fullScreen"
          ? "Full desktop may include Otto and other visible applications. Press the hotkey to capture."
          : "Last window captures the recent external application. Press the hotkey to capture."}
      </Text>
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
