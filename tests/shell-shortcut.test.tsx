import { afterEach, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

let toggle: (() => void) | undefined;
let fail = false;
let shortcut = "Ctrl+Alt+O";
mock.module("../src/platform/tauri/shell-shortcut", () => ({
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
const { ShortcutSettings } = await import("../src/features/shell/ShortcutSettings");
const { useShellShortcut } = await import("../src/features/shell/useShellShortcut");
const { useShellInteraction } = await import("../src/features/shell/useShellInteraction");
const { defaults } = await import("../src/features/shell/preferences");
function Harness() {
  const shell = useShellInteraction({ prefs: { ...defaults, hoverDelay: 0 } });
  useShellShortcut(() => shell.expanded ? shell.dismiss() : shell.open(shell.page));
  return <section onPointerEnter={shell.handleEnter}>
    <output>{shell.page}:{shell.pinned ? "pinned" : shell.expanded ? "preview" : "compact"}</output>
    <textarea title="Draft" defaultValue="preserve me" />
    <button type="button" onClick={() => shell.setPage("music")}>Music</button>
    <ShortcutSettings />
  </section>;
}
afterEach(() => { cleanup(); fail = false; shortcut = "Ctrl+Alt+O"; });

test("global shortcut expands and compacts the current module without losing the draft", async () => {
  render(<Harness />);
  await waitFor(() => expect(typeof toggle).toBe("function"));
  fireEvent.click(screen.getByText("Music"));
  act(() => toggle?.());
  expect(screen.getByText("music:pinned")).toBeTruthy();
  act(() => toggle?.());
  expect(screen.getByText("music:compact")).toBeTruthy();
  act(() => toggle?.());
  expect(screen.getByText("music:pinned")).toBeTruthy();
  expect((screen.getByTitle("Draft") as HTMLTextAreaElement).value).toBe("preserve me");
  expect(Boolean(screen.queryByText("Hide Otto"))).toBe(false);
});

test("preview collapses instead of hiding and shortcut conflicts stay recoverable", async () => {
  const view = render(<Harness />);
  await waitFor(() => expect((screen.getByLabelText("Expand / compact shortcut") as HTMLInputElement).value).toBe("Ctrl+Alt+O"));
  fireEvent.pointerOver(view.container.querySelector("section")!, { pointerType: "mouse" });
  await screen.findByText("home:preview");
  act(() => toggle?.());
  expect(screen.getByText("home:compact")).toBeTruthy();
  fail = true;
  fireEvent.change(screen.getByLabelText("Expand / compact shortcut"), { target: { value: "Ctrl+Alt+P" } });
  fireEvent.click(screen.getByText("Save"));
  await screen.findByText("Error: Shortcut unavailable");
  expect(shortcut).toBe("Ctrl+Alt+O");
});
