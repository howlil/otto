import { useEffect, useRef, useState } from "react";
import type { TimerPhase } from "../../platform/tauri/focus";
import { StatusMessage } from "../../shared/ui";
import { FocusHeader } from "./FocusHeader";
import { FocusPhaseConfirm } from "./FocusPhaseConfirm";
import { FocusSettings } from "./FocusSettings";
import { FocusTimerBody } from "./FocusTimerBody";
import type { FocusTimerModel } from "./useFocusTimer";

export function FocusPanel({
  focus,
  settings,
  onSettings,
  onSettingsBack,
  onHome,
}: {
  focus: FocusTimerModel;
  settings: boolean;
  onSettings: () => void;
  onSettingsBack: () => void;
  onHome: () => void;
}) {
  const [confirmPhase, setConfirmPhase] = useState<TimerPhase | null>(null);
  const confirmCancel = useRef<HTMLButtonElement>(null);
  const phaseTrigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirmPhase) {
      confirmCancel.current?.focus({ preventScroll: true });
      return;
    }
    phaseTrigger.current?.focus({ preventScroll: true });
  }, [confirmPhase]);

  useEffect(() => {
    if (settings) setConfirmPhase(null);
  }, [settings]);

  const selectPhase = (phase: TimerPhase, trigger: HTMLButtonElement) => {
    if (focus.pending || phase === focus.snapshot.phase) return;
    if (focus.snapshot.status === "running" || focus.snapshot.status === "paused") {
      phaseTrigger.current = trigger;
      setConfirmPhase(phase);
      return;
    }
    void focus.selectPhase(phase, false);
  };
  const confirmSwitch = async () => {
    if (!confirmPhase) return;
    if (await focus.selectPhase(confirmPhase, true)) setConfirmPhase(null);
  };
  const errorAction =
    focus.errorKind === "connection"
      ? { label: "Reconnect", onClick: () => void focus.retryConnection(), disabled: focus.pending }
      : { label: "Dismiss", onClick: focus.clearError, disabled: focus.pending };

  return (
    <section
      className="relative flex h-full min-h-0 flex-col"
      data-status={focus.snapshot.status}
      data-surface="focus"
    >
      <FocusHeader
        snapshot={focus.snapshot}
        settings={settings}
        onHome={onHome}
        onSettings={onSettings}
        onSettingsBack={onSettingsBack}
      />
      {focus.error ? (
        <StatusMessage
          tone="error"
          title={
            focus.errorKind === "connection" ? "Focus timer unavailable" : "Timer action failed"
          }
          action={errorAction}
          className="m-3 rounded-otto-control border border-otto-danger bg-otto-field-deep p-2.5 text-otto-danger-detail"
        >
          {focus.error}
        </StatusMessage>
      ) : settings ? (
        <FocusSettings
          snapshot={focus.snapshot}
          pending={focus.pending}
          onConfigure={focus.configure}
          onDone={onSettingsBack}
        />
      ) : (
        <FocusTimerBody
          snapshot={focus.snapshot}
          pending={focus.pending}
          onStart={() => void focus.start()}
          onPause={() => void focus.pause()}
          onReset={() => void focus.reset()}
          onStartNext={() => void focus.startNext()}
          onSelectPhase={selectPhase}
        />
      )}
      {confirmPhase && !settings && (
        <FocusPhaseConfirm
          phase={confirmPhase}
          pending={focus.pending}
          cancelRef={confirmCancel}
          onCancel={() => setConfirmPhase(null)}
          onEscape={() => setConfirmPhase(null)}
          onConfirm={() => void confirmSwitch()}
        />
      )}
    </section>
  );
}
