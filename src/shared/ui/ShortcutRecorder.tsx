import { useState, type KeyboardEvent } from "react";
import { IconButton } from "./a11y";
import { Text } from "./Text";

export type ShortcutAttempt =
  | { kind: "waiting" }
  | { kind: "accepted"; shortcut: string }
  | { kind: "rejected"; hint: string };

export type ShortcutKeyInput = Pick<
  KeyboardEvent,
  "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey"
>;

export function shortcutKeys(shortcut: string): string[] {
  return shortcut.split("+").filter(Boolean);
}

function Keycaps({ shortcut }: { shortcut: string }) {
  const keys = shortcutKeys(shortcut);
  if (keys.length === 0) {
    return (
      <Text as="span" variant="meta" className="text-otto-text-tertiary">
        Not set
      </Text>
    );
  }
  return keys.map((key) => (
    <kbd
      key={key}
      className="rounded-otto-chip border border-otto-line-soft bg-otto-raised-deep px-1.5 py-0.5 font-otto-mono text-otto-2xs text-otto-text-bright"
    >
      {key}
    </kbd>
  ));
}

export function ShortcutRecorder({
  id,
  value,
  defaultValue,
  disabled,
  record,
  onRecord,
}: {
  id: string;
  value: string;
  defaultValue: string;
  disabled: boolean;
  record: (input: ShortcutKeyInput) => ShortcutAttempt;
  onRecord: (shortcut: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const stop = () => {
    setRecording(false);
    setHint(null);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!recording) return;
    event.preventDefault();
    event.stopPropagation();
    event.nativeEvent.stopImmediatePropagation();
    if (event.key === "Escape") return stop();
    const attempt = record(event.nativeEvent);
    if (attempt.kind === "waiting") return;
    if (attempt.kind === "rejected") return setHint(attempt.hint);
    stop();
    onRecord(attempt.shortcut);
  };
  return (
    <span className="flex flex-col items-end gap-1">
      <span className="flex items-center gap-1.5">
        {value !== defaultValue && !recording && (
          <IconButton
            icon="reset"
            label="Reset"
            title="Reset shortcut"
            variant="quiet"
            size={13}
            disabled={disabled}
            onClick={() => onRecord(defaultValue)}
          />
        )}
        <button
          id={id}
          type="button"
          disabled={disabled}
          title={recording ? "Press shortcut keys or Esc to cancel" : "Click to change shortcut"}
          className={`flex h-8 items-center gap-1 rounded-otto-control border px-2 text-otto-text transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-otto-input-selected disabled:opacity-45 ${
            recording
              ? "border-otto-line-focused bg-otto-selected"
              : "border-otto-line-mid bg-otto-field-deep hover:border-otto-line-hover"
          }`}
          onClick={() => (recording ? stop() : setRecording(true))}
          onKeyDown={onKeyDown}
          onBlur={stop}
        >
          {recording ? (
            <Text as="span" variant="meta" className="text-otto-text-bright" role="status">
              Press keys…
            </Text>
          ) : (
            <Keycaps shortcut={value} />
          )}
        </button>
      </span>
      {hint && (
        <Text
          as="span"
          variant="meta"
          className="max-w-[230px] text-right text-otto-warn"
          role="alert"
        >
          {hint}
        </Text>
      )}
    </span>
  );
}
