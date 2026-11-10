import { afterEach, expect, spyOn, test } from "bun:test";
import { act, cleanup, createEvent, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import type { Page } from "../src/features/shell/preferences";
import { useModuleNavigation } from "../src/features/shell/useModuleNavigation";

afterEach(cleanup);

function Harness() {
  const [page, navigate] = useState<Page>("agent");
  const navigation = useModuleNavigation(page, navigate);
  return <section onWheel={navigation.onModuleWheel} onKeyDown={navigation.onModuleKey}>
    <output>{page}</output>
    <button type="button">Surface</button>
    <textarea title="Draft" defaultValue="keep my draft" />
    <pre>wide code</pre>
    <button type="button" onClick={() => navigate("agent-settings")}>Settings</button>
  </section>;
}

test("swipe changes the rendered module once without discarding draft", () => {
  render(<Harness />);
  fireEvent.wheel(screen.getByText("Surface"), { deltaX: 70, deltaY: 1 });
  expect(screen.getByText("music")).toBeTruthy();
  fireEvent.wheel(screen.getByText("Surface"), { deltaX: 200, deltaY: 1 });
  expect(screen.getByText("music")).toBeTruthy();
  expect((screen.getByTitle("Draft") as HTMLTextAreaElement).value).toBe("keep my draft");
});

test("successive swipe bursts and reversals remain navigable without a quiet gap", () => {
  let now = 0;
  const clock = spyOn(performance, "now").mockImplementation(() => now);
  try {
    render(<Harness />);
    const surface = screen.getByText("Surface");
    const wheel = (x: number, at: number) => {
      now = at;
      fireEvent.wheel(surface, { deltaX: x, deltaY: 0 });
    };
    wheel(70, 0);
    expect(screen.getByText("music")).toBeTruthy();
    wheel(10, 60);
    wheel(2, 90);
    wheel(48, 130);
    expect(screen.getByText("focus")).toBeTruthy();
    wheel(-48, 230);
    expect(screen.getByText("music")).toBeTruthy();
    act(() => {
      wheel(-10, 290);
      wheel(-2, 320);
      wheel(-48, 360);
      wheel(48, 460);
    });
    expect(screen.getByText("music")).toBeTruthy();
  } finally { clock.mockRestore(); }
});

test("vertical scroll, pinch, editor and code scrolling never navigate", () => {
  render(<Harness />);
  fireEvent.wheel(screen.getByTitle("Draft"), { deltaX: 100 });
  fireEvent.wheel(screen.getByText("wide code"), { deltaX: 100 });
  const pinch = createEvent.wheel(screen.getByText("Surface"), { deltaX: 100 });
  Object.defineProperty(pinch, "ctrlKey", { value: true });
  fireEvent(screen.getByText("Surface"), pinch);
  fireEvent.wheel(screen.getByText("Surface"), { deltaX: 1, deltaY: 100 });
  expect(screen.getByText("agent")).toBeTruthy();
});

test("keyboard alternative works outside editing and settings", () => {
  render(<Harness />);
  fireEvent.keyDown(screen.getByTitle("Draft"), { key: "ArrowRight", altKey: true });
  expect(screen.getByText("agent")).toBeTruthy();
  fireEvent.keyDown(screen.getByText("Surface"), { key: "ArrowLeft", altKey: true });
  expect(screen.getByText("focus")).toBeTruthy();
  fireEvent.click(screen.getByText("Settings"));
  fireEvent.wheel(screen.getByText("Surface"), { deltaX: 100 });
  fireEvent.keyDown(screen.getByText("Surface"), { key: "ArrowRight", altKey: true });
  expect(screen.getByText("agent-settings")).toBeTruthy();
});
