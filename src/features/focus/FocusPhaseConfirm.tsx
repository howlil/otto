import type { RefObject } from "react";
import type { TimerPhase } from "../../platform/tauri/focus";
import { Button, Text } from "../../shared/ui";
import { phaseLabel } from "./view-model";

export function FocusPhaseConfirm({
  phase,
  pending,
  cancelRef,
  onCancel,
  onEscape,
  onConfirm,
}: {
  phase: TimerPhase;
  pending: boolean;
  cancelRef: RefObject<HTMLButtonElement | null>;
  onCancel: () => void;
  onEscape: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="absolute inset-0 z-10 grid place-items-center bg-otto-surface/90 p-3">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="focus-phase-confirm-title"
        tabIndex={-1}
        className="w-full max-w-[330px] rounded-otto-panel border border-otto-line-mid bg-otto-raised-soft p-3 shadow-lg"
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          onEscape();
        }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <Text as="h2" id="focus-phase-confirm-title" variant="title" className="m-0">
          Switch to {phaseLabel(phase)}?
        </Text>
        <Text as="p" variant="body-compact" className="mb-0 mt-1.5 text-otto-text-secondary">
          Your current session will end and its remaining time will be discarded.
        </Text>
        <div className="mt-3 flex justify-end gap-2">
          <Button
            ref={cancelRef}
            variant="secondary"
            size="xs"
            disabled={pending}
            onClick={onCancel}
          >
            Keep timer
          </Button>
          <Button variant="primary" size="xs" disabled={pending} onClick={onConfirm}>
            Switch phase
          </Button>
        </div>
      </section>
    </div>
  );
}
