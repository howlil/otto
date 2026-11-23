import { useEffect } from "react";
import {
  SettingBlock,
  SettingGroup,
  SettingRow,
  ShortcutRecorder,
  StatusMessage,
  Text,
} from "../../../shared/ui";
import type { AgentPanelModel } from "../model/view-model";
import { CaptureDeliveryPicker } from "./CaptureDeliverySection";
import {
  CaptureSourceGrid,
  IMAGE_REASON,
  LastWindow,
  needsWindowTarget,
  sourceChoices,
} from "./CaptureSourceSection";
import {
  DEFAULT_CAPTURE_SHORTCUT,
  DEFAULT_TEXT_CAPTURE_SHORTCUT,
  recordShortcut,
} from "./shortcut-keys";

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
      <SettingBlock title="Capture source" icon="camera">
        <CaptureSourceGrid
          value={source}
          choices={sourceChoices(agent.readiness.imageTransport)}
          disabled={busy}
          onChange={(next) => void selectSource(next)}
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
      <SettingBlock title="After capture" icon="send">
        <CaptureDeliveryPicker
          autoSend={Boolean(capture.autoSend)}
          disabled={busy}
          onChange={(next) => void capture.setAutoSend?.(next)}
        />
      </SettingBlock>
      <SettingGroup title="Shortcuts">
        <SettingRow
          icon="camera"
          title="Capture shortcut"
          titleHint="Runs the capture source chosen above"
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
          icon="textSelect"
          title="Selected text shortcut"
          titleHint="Grabs highlighted text directly"
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
        {!available && (
          <StatusMessage tone="info" className="mt-1">
            Capture shortcuts can only be configured in Otto for Windows.
          </StatusMessage>
        )}
        {capture.captureMessage && (
          <StatusMessage tone="info" className="mt-1">
            {capture.captureMessage}
          </StatusMessage>
        )}
      </SettingGroup>
    </div>
  );
}
