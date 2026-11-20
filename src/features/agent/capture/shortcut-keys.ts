import type { ShortcutAttempt, ShortcutKeyInput } from "../../../shared/ui";

export const DEFAULT_CAPTURE_SHORTCUT = "Ctrl+Shift+O";
export const DEFAULT_TEXT_CAPTURE_SHORTCUT = "Ctrl+Shift+T";

const modifierCode = /^(Control|Shift|Alt|Meta|OS)(Left|Right)$/;

export function recordShortcut(input: ShortcutKeyInput): ShortcutAttempt {
  if (modifierCode.test(input.code)) return { kind: "waiting" };
  if (input.metaKey) {
    return {
      kind: "rejected",
      hint: "The Windows key is reserved by the system. Use Ctrl with Alt or Shift.",
    };
  }
  if (!input.ctrlKey || !(input.altKey || input.shiftKey)) {
    return { kind: "rejected", hint: "Hold Ctrl with Alt or Shift, then press a letter." };
  }
  const letter = /^Key([A-Z])$/.exec(input.code)?.[1];
  if (!letter) return { kind: "rejected", hint: "End the shortcut with a letter from A to Z." };
  const parts = ["Ctrl", input.altKey ? "Alt" : "", input.shiftKey ? "Shift" : "", letter];
  return { kind: "accepted", shortcut: parts.filter(Boolean).join("+") };
}
