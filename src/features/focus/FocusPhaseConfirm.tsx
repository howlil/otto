import { useEffect, useRef, type KeyboardEvent, type RefObject } from "react";
import type { TimerPhase } from "../../platform/tauri/focus";
import { Button, Text } from "../../shared/ui";
import { phaseLabel } from "./view-model";

function handleDialogKey(event: KeyboardEvent<HTMLElement>, onEscape: () => void) {
  if (event.key === "Escape") {
    event.preventDefault();
    onEscape();
    return;
  }
  if (event.key !== "Tab") return;
  const controls = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
  );
  event.preventDefault();
  if (controls.length === 0) {
    event.currentTarget.focus();
    return;
  }
  const current = controls.indexOf(document.activeElement as HTMLButtonElement);
  const next =
    current < 0
      ? event.shiftKey
        ? controls.length - 1
        : 0
      : (current + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
  controls[next]?.focus();
}

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
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    if (pending) dialog.current?.focus({ preventScroll: true });
  }, [pending]);
  return (
    <div className="absolute inset-0 z-10 grid place-items-center bg-otto-focus-dialog-overlay p-4 backdrop-blur-[7px] animate-otto-focus-confirm motion-reduce:animate-none">
      <section
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="focus-phase-confirm-title"
        tabIndex={-1}
        className="w-full rounded-2xl border border-otto-scrollbar-track bg-otto-focus-dialog p-[15px] animate-otto-focus-dialog motion-reduce:animate-none"
        onKeyDown={(event) => handleDialogKey(event, onEscape)}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <Text
          as="h2"
          id="focus-phase-confirm-title"
          variant="title"
          className="m-0 text-otto-lg! font-[550]!"
        >
          Switch to {phaseLabel(phase)}?
        </Text>
        <Text as="p" variant="body-compact" className="mb-0 mt-2 text-otto-text-secondary">
          Your current session will end and its remaining time will be discarded.
        </Text>
        <div className="mt-3.5 flex justify-end gap-[7px]">
          <Button
            ref={cancelRef}
            variant="secondary"
            size="xs"
            className="px-[13px] py-2 text-otto-sm! font-normal!"
            disabled={pending}
            onClick={onCancel}
          >
            Keep timer
          </Button>
          <Button
            variant="primary"
            size="xs"
            className="px-[13px] py-2 text-otto-sm! font-normal!"
            disabled={pending}
            onClick={onConfirm}
          >
            Switch phase
          </Button>
        </div>
      </section>
    </div>
  );
}
