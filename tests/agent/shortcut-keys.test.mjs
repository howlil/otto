import { describe, expect, test } from "bun:test";
import { recordShortcut } from "../../src/features/agent/capture/shortcut-keys.ts";
import { recordShellShortcut } from "../../src/features/shell/model/shortcut-keys.ts";
import { shortcutKeys } from "../../src/shared/ui/ShortcutRecorder.tsx";

const press = (code, { ctrl = false, alt = false, shift = false, meta = false } = {}) =>
  recordShortcut({ code, ctrlKey: ctrl, altKey: alt, shiftKey: shift, metaKey: meta });

describe("capture shortcut recording", () => {
  test("modifier-only presses keep waiting", () => {
    expect(press("ControlLeft", { ctrl: true })).toEqual({ kind: "waiting" });
    expect(press("ShiftRight", { ctrl: true, shift: true })).toEqual({ kind: "waiting" });
  });

  test("accepts Ctrl with Alt or Shift plus a letter in the backend's order", () => {
    expect(press("KeyK", { ctrl: true, alt: true })).toEqual({
      kind: "accepted",
      shortcut: "Ctrl+Alt+K",
    });
    expect(press("KeyO", { ctrl: true, shift: true })).toEqual({
      kind: "accepted",
      shortcut: "Ctrl+Shift+O",
    });
    expect(press("KeyZ", { ctrl: true, alt: true, shift: true })).toEqual({
      kind: "accepted",
      shortcut: "Ctrl+Alt+Shift+Z",
    });
  });

  test("rejects combinations the backend would refuse, with a reason", () => {
    expect(press("KeyK", { ctrl: true }).kind).toBe("rejected");
    expect(press("KeyK", { alt: true, shift: true }).kind).toBe("rejected");
    expect(press("Digit5", { ctrl: true, alt: true }).kind).toBe("rejected");
    expect(press("F5", { ctrl: true, shift: true }).kind).toBe("rejected");
    expect(press("KeyK", { ctrl: true, alt: true, meta: true })).toMatchObject({
      kind: "rejected",
      hint: expect.stringContaining("Windows key"),
    });
  });

  test("splits a stored shortcut into keycaps", () => {
    expect(shortcutKeys("Ctrl+Shift+O")).toEqual(["Ctrl", "Shift", "O"]);
  });
});

describe("shell shortcut recording", () => {
  const key = (code, mods = {}) =>
    recordShellShortcut({
      code,
      ctrlKey: !!mods.ctrl,
      altKey: !!mods.alt,
      shiftKey: !!mods.shift,
      metaKey: !!mods.meta,
    });

  test("accepts any modifier with a letter or digit, in the backend's order", () => {
    expect(key("KeyO", { ctrl: true, alt: true })).toEqual({
      kind: "accepted",
      shortcut: "Ctrl+Alt+O",
    });
    expect(key("Digit7", { shift: true, alt: true })).toEqual({
      kind: "accepted",
      shortcut: "Alt+Shift+7",
    });
  });

  test("rejects unmodified keys and non-alphanumeric endings with a hint", () => {
    expect(key("KeyO").kind).toBe("rejected");
    expect(key("F5", { ctrl: true }).kind).toBe("rejected");
    expect(key("ControlLeft", { ctrl: true })).toEqual({ kind: "waiting" });
  });
});
