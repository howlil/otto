import { useEffect } from "react";
import {
  ChoiceGroup,
  SettingBlock,
  SettingRow,
  ShortcutRecorder,
  StatusMessage,
  Text,
  Toggle,
} from "../../../shared/ui";
import type { CaptureSource } from "../../../platform/tauri";
import type { AgentPanelModel } from "../model/view-model";
import {
  DEFAULT_CAPTURE_SHORTCUT,
  DEFAULT_TEXT_CAPTURE_SHORTCUT,
  recordShortcut,
} from "./shortcut-keys";
import { IMAGE_REASON, LastWindow, needsWindowTarget, sourceChoices } from "./CaptureSourceSection";

export function CaptureSettings({
  agent,
  focusShortcut,
}: {
  agent: AgentPanelModel;
  focusShortcut: boolean;
}) {
  const capture = agent.capture;
  const { source, selectSource, sourceReady, sourcePending, savingCapture, available } = capture;
  const busy = !available || savingCapture || sourcePending;

  useEffect(() => {
    if (!focusShortcut || !available) return;
    const frame = requestAnimationFrame(() => {
      document.getElementById("otto-capture-shortcut")?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusShortcut, available]);

  useEffect(() => {
    if (needsWindowTarget(source) && sourceReady) void capture.refreshTarget();
  }, [source, sourceReady, capture.refreshTarget]);

  return (
    <div className="space-y-4">
      <SettingBlock title="Send">
        <ChoiceGroup<CaptureSource>
          value={source}
          choices={sourceChoices(agent.readiness.imageTransport)}
          onChange={(next) => void selectSource(next)}
          disabled={busy}
          presentation="row"
        />
        {!agent.readiness.imageTransport && (
          <Text as="p" variant="caption" className="mt-2 text-otto-text-tertiary">
            {agent.readiness.status === "checking"
              ? "Checking what this provider accepts…"
              : IMAGE_REASON}
          </Text>
        )}
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
        {needsWindowTarget(source) && sourceReady && <LastWindow {...capture} />}
      </SettingBlock>
      <div className="space-y-3">
        <SettingRow
          title="Shortcut"
          help="Captures selected source"
          htmlFor="otto-capture-shortcut"
        >
          <ShortcutRecorder
            id="otto-capture-shortcut"
            value={capture.shortcut}
            defaultValue={DEFAULT_CAPTURE_SHORTCUT}
            disabled={busy || !sourceReady}
            record={recordShortcut}
            onRecord={(next) => void capture.saveShortcut(next)}
          />
        </SettingRow>
        <SettingRow
          title="Text capture shortcut"
          help="Always captures highlighted text"
          htmlFor="otto-text-capture-shortcut"
        >
          <ShortcutRecorder
            id="otto-text-capture-shortcut"
            value={capture.textShortcut ?? DEFAULT_TEXT_CAPTURE_SHORTCUT}
            defaultValue={DEFAULT_TEXT_CAPTURE_SHORTCUT}
            disabled={busy || !sourceReady}
            record={recordShortcut}
            onRecord={(next) => void capture.saveTextShortcut?.(next)}
          />
        </SettingRow>
        <Toggle
          title="Instant auto-send"
          help="Send captures immediately instead of staging in composer"
          checked={Boolean(capture.autoSend)}
          disabled={busy}
          onChange={(next) => void capture.setAutoSend?.(next)}
        />
        {!available && (
          <StatusMessage tone="info">
            Capture shortcuts can only be configured in Otto for Windows.
          </StatusMessage>
        )}
        {capture.captureMessage && (
          <StatusMessage tone="info">{capture.captureMessage}</StatusMessage>
        )}
      </div>
    </div>
  );
}
