import type { ShortcutAttempt, ShortcutKeyInput } from "../../shared/ui";
import { DEFAULT_VOICE_SHORTCUT } from "./preferences";

export { DEFAULT_VOICE_SHORTCUT };

const modifierCode = /^(Control|Shift|Alt|Meta|OS)(Left|Right)$/;

export function recordVoiceShortcut(input: ShortcutKeyInput): ShortcutAttempt {
  if (modifierCode.test(input.code)) return { kind: "waiting" };
  if (!(input.ctrlKey || input.altKey || input.shiftKey || input.metaKey)) {
    return { kind: "rejected", hint: "Hold Ctrl, Alt, Shift or Win, then press a key." };
  }
  const key = /^Key([A-Z])$/.exec(input.code)?.[1] ?? /^Digit([0-9])$/.exec(input.code)?.[1];
  if (!key) return { kind: "rejected", hint: "End the shortcut with a letter or a digit." };
  const parts = [
    input.ctrlKey ? "Ctrl" : "",
    input.altKey ? "Alt" : "",
    input.shiftKey ? "Shift" : "",
    input.metaKey ? "Win" : "",
    key,
  ];
  return { kind: "accepted", shortcut: parts.filter(Boolean).join("+") };
}
