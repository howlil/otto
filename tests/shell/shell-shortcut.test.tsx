import { afterEach, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

let toggle: (() => void) | undefined;
let fail = false;
let shortcut = "Ctrl+Alt+O";
mock.module("../../src/platform/tauri/runtime", () => ({ nativeAvailable: true }));
mock.module("../../src/platform/tauri/shell-shortcut", () => ({
  nativeAvailable: true,
  onShellToggle: async (listener: () => void) => {
    toggle = listener;
    return () => { toggle = undefined; };
  },
  shellShortcut: async (value?: string) => {
    if (fail) throw new Error("Shortcut unavailable");
    if (value) shortcut = value;
    return shortcut;
  },
}));
const { BehaviorSettings } = await import("../../src/features/shell/ui/settings/BehaviorSettings");
const { useShellShortcut } = await import("../../src/features/shell/hooks/useShellShortcut");
const { useShellInteraction } = await import("../../src/features/shell/hooks/useShellInteraction");
const { defaults } = await import("../../src/features/shell/model/preferences");
function Harness() {
  const shell = useShellInteraction({ prefs: { ...defaults, hoverDelay: 0 } });
  useShellShortcut(() => shell.expanded ? shell.dismiss() : shell.open(shell.page));
  return <section onPointerEnter={shell.handleEnter}>
    <output>{shell.page}:{shell.pinned ? "pinned" : shell.expanded ? "preview" : "compact"}</output>
    <textarea title="Draft" defaultValue="preserve me" />
    <BehaviorSettings prefs={defaults} change={() => {}} />
  </section>;
}
afterEach(() => { cleanup(); fail = false; shortcut = "Ctrl+Alt+O"; });

test("global shortcut expands and compacts Agent without losing the draft", async () => {
  render(<Harness />);
  await waitFor(() => expect(typeof toggle).toBe("function"));
  act(() => toggle?.());
  expect(screen.getByText("agent:pinned")).toBeTruthy();
  act(() => toggle?.());
  expect(screen.getByText("agent:compact")).toBeTruthy();
  act(() => toggle?.());
  expect(screen.getByText("agent:pinned")).toBeTruthy();
  expect((screen.getByTitle("Draft") as HTMLTextAreaElement).value).toBe("preserve me");
  expect(Boolean(screen.queryByText("Hide Otto"))).toBe(false);
});

const recorder = () => document.getElementById("otto-shell-shortcut") as HTMLButtonElement;
const press = (init: Record<string, unknown>) => {
  fireEvent.click(recorder());
  fireEvent.keyDown(recorder(), init);
};

test("preview collapses instead of hiding and shortcut conflicts stay recoverable", async () => {
  const view = render(<Harness />);
  await waitFor(() => expect(recorder().textContent).toContain("Ctrl"));
  fireEvent.pointerOver(view.container.querySelector("section")!, { pointerType: "mouse" });
  await screen.findByText("agent:preview");
  act(() => toggle?.());
  expect(screen.getByText("agent:compact")).toBeTruthy();
  fail = true;
  press({ key: "p", code: "KeyP", ctrlKey: true, altKey: true });
  await screen.findByText("Error: Shortcut unavailable");
  expect(shortcut).toBe("Ctrl+Alt+O");
});

test("recording a valid combination applies it immediately and invalid ones explain why", async () => {
  render(<Harness />);
  await waitFor(() => expect(recorder().textContent).toContain("Ctrl"));
  press({ key: "o", code: "KeyO" });
  await screen.findByText("Hold Ctrl, Alt, Shift or Win, then press a key.");
  expect(shortcut).toBe("Ctrl+Alt+O");
  fireEvent.keyDown(recorder(), { key: "p", code: "KeyP", ctrlKey: true, shiftKey: true });
  await waitFor(() => expect(shortcut).toBe("Ctrl+Shift+P"));
  await waitFor(() => expect(recorder().textContent).toContain("Shift"));
  expect(screen.queryByText("Save")).toBeNull();
});
