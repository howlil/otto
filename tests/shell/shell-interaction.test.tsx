import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

let focusListener: ((focused: boolean) => void) | null = null;
let cursorFailure = false;
let dragStarted = 0;
const invocations: Array<{ command: string; payload: unknown }> = [];
const surfaceSizes: Record<string, { width: number; height: number }> = {
  agentCompact: { width: 228, height: 40 },
  agentReady: { width: 526, height: 170 },
  agentThinking: { width: 526, height: 236 },
  agentFull: { width: 526, height: 346 },
  agentError: { width: 526, height: 270 },
  settings: { width: 526, height: 466 },
};

mock.module("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: async (command: string, payload: unknown) => {
    invocations.push({ command, payload });
    if (command === "overlay_set_capture_protection") {
      return (payload as { enabled: boolean }).enabled;
    }
    if (command === "overlay_protection_status") return true;
    if (command === "notch_configure_host") return {
      revision: 1, placement: "floating", width: 550, height: 610, scale: 1,
      layouts: Object.fromEntries(Object.entries(surfaceSizes).map(([key, value]) => [key, [value.width, value.height]])),
    };
    if (command === "notch_set_region") return true;
    if (command === "shell_shortcut") {
      return (payload as { shortcut?: string } | undefined)?.shortcut ?? "Ctrl+Alt+O";
    }
    return null;
  },
  Channel: class {
    onmessage: ((value: unknown) => void) | null = null;
  },
  Resource: class {
    rid: number;
    constructor(rid: number) {
      this.rid = rid;
    }
    async close() {}
  },
  transformCallback: (callback: unknown) => callback,
}));

const originalElementFromPoint = document.elementFromPoint;
mock.module("@tauri-apps/api/window", () => ({
  cursorPosition: async () => {
    if (cursorFailure) throw new Error("Pointer query unavailable");
    return { x: 10, y: 10 };
  },
  getCurrentWindow: () => ({
    innerPosition: async () => ({ x: 0, y: 0 }),
    scaleFactor: async () => 1,
    onFocusChanged: async (handler: (event: { payload: boolean }) => void) => {
      focusListener = (focused) => handler({ payload: focused });
      return () => {
        focusListener = null;
      };
    },
    startDragging: async () => {
      dragStarted += 1;
    },
  }),
}));

const { useNotchShell } = await import("../../src/features/shell/hooks/useNotchShell");
const { useNotchSurfaceSync } = await import("../../src/features/shell/surface-sync/useNotchSurfaceSync");
const { ShellView } = await import("../../src/app/AppView");

const agentStub = {
  snapshot: {
    runId: 0,
    seq: 0,
    status: "idle",
    provider: "codex",
    threadId: null,
    model: null,
    thinkingEffort: null,
    usage: null,
    messages: [],
    capture: { requestId: 0, phase: "idle", error: null },
    error: null,
  },
  installed: true,
  readiness: {
    status: "ready",
    message: "Ready",
    recovery: "",
    imageInput: false,
    imageTransport: false,
    model: null,
    models: [],
    thinkingEffort: null,
    thinkingEfforts: [],
  },
  error: null,
  draft: "",
  setDraft: () => {},
  errorKind: null,
  busy: false,
  captureBusy: false,
  send: async () => {},
  stop: async () => {},
  refreshProvider: async () => {},
  retryConnection: async () => {},
  clearError: () => {},
  captureNow: async () => {},
  insertText: async () => {},
  history: { refresh: async () => {} },
  provider: "codex",
  providers: [],
  capture: { source: "selectedText", shortcut: "Ctrl+Shift+O", sourceReady: true, available: false },
  model: null,
  setModel: () => {},
  thinkingEffort: null,
  setThinkingEffort: () => {},
  setProvider: () => {},
  locked: false,
  newSession: async () => true,
} as unknown as Parameters<typeof ShellView>[0]["agent"];
const updateStub = {
  state: { status: "idle" },
  checkForUpdate: async () => {},
  installUpdate: async () => {},
} as Parameters<typeof ShellView>[0]["appUpdate"];
function Harness() {
  const shell = useNotchShell();
  return (
    <ShellView
      agent={agentStub}
      shell={shell}
      surfaceError={null}
      gutter={0}
      size={null}
      nativeSize={null}
      morphMs={420}
      onContentMeasured={() => {}}
      appUpdate={updateStub}
    />
  );
}

function saved(preferences: Record<string, unknown> = {}) {
  localStorage.setItem(
    "otto.preferences.v1",
    JSON.stringify({
      hoverExpand: true,
      hoverDelay: 0,
      leaveDelay: 0,
      clickOutside: true,
      motion: "reduced",
      ...preferences,
    }),
  );
}

async function mount(preferences: Record<string, unknown> = {}) {
  saved(preferences);
  const view = render(<Harness />);
  const surface = view.container.querySelector("main");
  if (!surface) throw new Error("Otto surface did not render");
  await waitFor(() => expect(isExpanded()).toBe(false));
  return { view, surface };
}

function compactButton(): HTMLButtonElement {
  const element = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
    (button) => button.textContent?.includes("Open Agent"),
  );
  if (!element) throw new Error("Otto compact button did not render");
  return element;
}

const isExpanded = () => document.querySelector("[data-expanded]")?.getAttribute("data-expanded") === "true";

async function hover(surface: HTMLElement) {
  fireEvent.pointerOver(surface, { pointerType: "mouse", relatedTarget: null });
  await waitFor(() => expect(isExpanded()).toBe(true));
}

async function blurOtto() {
  await waitFor(() => expect(focusListener).not.toBeNull());
  focusListener?.(false);
}

afterAll(() => {
  mock.restore();
});

afterEach(() => {
  cleanup();
  document.elementFromPoint = originalElementFromPoint;
  focusListener = null;
  cursorFailure = false;
  dragStarted = 0;
  localStorage.clear();
  invocations.length = 0;
});

describe("Otto shell hover and pin interaction", () => {
  test("moving the panel surface starts native dragging after a pointer threshold", async () => {
    const { surface } = await mount();

    fireEvent.pointerDown(surface, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(surface, { clientX: 16, clientY: 16 });

    await waitFor(() => expect(dragStarted).toBe(1));
  });

  test("hover opens the Agent composer directly without moving keyboard focus", async () => {
    const { surface } = await mount();
    await hover(surface);

    expect(document.querySelector("#otto-prompt")).not.toBeNull();
    expect(document.querySelector('[data-surface="agent"]')).not.toBeNull();
    expect(document.activeElement).toBe(document.body);
  });

  test("hover previews the card without stealing keyboard focus", async () => {
    const { surface } = await mount();
    expect(isExpanded()).toBe(false);

    await hover(surface);

    expect(isExpanded()).toBe(true);
    expect(document.activeElement).toBe(document.body);
  });

  test("leave grace does not wait for an active CSS morph to finish", async () => {
    const { surface } = await mount({ hoverDelay: 0, leaveDelay: 40, motion: "fluid" });
    await hover(surface);
    fireEvent.pointerOut(surface, { pointerType: "mouse", relatedTarget: document.body });
    await waitFor(() => expect(isExpanded()).toBe(false), { timeout: 220 });
  });

  test("re-entering during leave grace cancels the pending collapse", async () => {
    const { surface } = await mount({ hoverDelay: 0, leaveDelay: 90, motion: "fluid" });
    await hover(surface);
    fireEvent.pointerOut(surface, { pointerType: "mouse", relatedTarget: document.body });
    fireEvent.pointerOver(surface, { pointerType: "mouse", relatedTarget: null });
    await new Promise((done) => setTimeout(done, 120));
    expect(isExpanded()).toBe(true);
    fireEvent.pointerOut(surface, { pointerType: "mouse", relatedTarget: document.body });
    await waitFor(() => expect(isExpanded()).toBe(false), { timeout: 350 });
  });

  test("leaving a preview returns to the compact capsule", async () => {
    const { surface } = await mount();
    await hover(surface);

    fireEvent.pointerOut(surface, { pointerType: "mouse", relatedTarget: document.body });

    await waitFor(() => expect(isExpanded()).toBe(false));
  });

  test("a layout-generated leave cannot collapse the preview while the pointer still hits Otto", async () => {
    const { surface } = await mount();
    await hover(surface);
    let checked = false;
    document.elementFromPoint = () => { checked = true; return surface; };
    fireEvent.pointerOut(surface, { pointerType: "mouse", relatedTarget: document.body });
    await waitFor(() => expect(checked).toBe(true));
    expect(isExpanded()).toBe(true);
    document.elementFromPoint = () => null;
    await waitFor(() => expect(isExpanded()).toBe(false));
  });

  test("an explicit pointer activation pins the preview", async () => {
    const { surface } = await mount();
    await hover(surface);

    fireEvent.pointerDown(surface);
    fireEvent.pointerOut(surface, { pointerType: "mouse", relatedTarget: document.body });

    await new Promise((done) => setTimeout(done, 20));
    expect(isExpanded()).toBe(true);
  });

  test("touch pointers never open a hover preview while pen pointers do", async () => {
    const { surface } = await mount();

    fireEvent(
      surface,
      new PointerEvent("pointerover", { pointerType: "touch", bubbles: true }),
    );
    await new Promise((done) => setTimeout(done, 20));
    expect(isExpanded()).toBe(false);

    fireEvent(surface, new PointerEvent("pointerover", { pointerType: "pen", bubbles: true }));
    await waitFor(() => expect(isExpanded()).toBe(true));
  });

  test("disabled hover expansion keeps the capsule compact", async () => {
    const { surface } = await mount({ hoverExpand: false });

    fireEvent.pointerOver(surface, { pointerType: "mouse", relatedTarget: null });
    await new Promise((done) => setTimeout(done, 20));

    expect(isExpanded()).toBe(false);
  });
});

describe("Otto shell blur and escape interaction", () => {
  test("a pinned card collapses when Windows reports focus loss", async () => {
    const { surface } = await mount();
    await hover(surface);
    fireEvent.pointerDown(surface);
    expect(isExpanded()).toBe(true);

    await blurOtto();

    await waitFor(() => expect(isExpanded()).toBe(false));
  });

  test("Keep Expanded holds a pinned card through focus loss", async () => {
    const { surface } = await mount({ clickOutside: false });
    await hover(surface);
    fireEvent.pointerDown(surface);

    await blurOtto();

    await new Promise((done) => setTimeout(done, 20));
    expect(isExpanded()).toBe(true);
  });

  test("windows focus loss never collapses a transient preview", async () => {
    const { surface } = await mount({ clickOutside: true });
    await hover(surface);

    await blurOtto();

    await new Promise((done) => setTimeout(done, 20));
    expect(isExpanded()).toBe(true);
  });

  test("Escape stays compact through layout-generated pointer events and rearms after a confirmed leave", async () => {
    const { surface } = await mount();
    await hover(surface);
    fireEvent.pointerDown(surface);
    document.elementFromPoint = () => surface;
    fireEvent.keyDown(surface, { key: "Escape" });
    await waitFor(() => expect(isExpanded()).toBe(false));
    fireEvent.pointerOut(surface, { pointerType: "mouse", relatedTarget: document.body });
    fireEvent.pointerOver(surface, { pointerType: "mouse", relatedTarget: null });
    await new Promise((done) => setTimeout(done, 30));
    expect(isExpanded()).toBe(false);
    document.elementFromPoint = () => null;
    fireEvent.pointerOut(surface, { pointerType: "mouse", relatedTarget: document.body });
    await new Promise((done) => setTimeout(done, 20));
    await hover(surface);
  });

  test("a failed pointer check cannot undo Escape and explicit activation still works", async () => {
    const { surface } = await mount();
    await hover(surface);
    fireEvent.pointerDown(surface);
    cursorFailure = true;
    fireEvent.keyDown(surface, { key: "Escape" });
    await waitFor(() => expect(isExpanded()).toBe(false));
    fireEvent.pointerOut(surface, { pointerType: "mouse", relatedTarget: document.body });
    fireEvent.pointerOver(surface, { pointerType: "mouse", relatedTarget: null });
    await new Promise((done) => setTimeout(done, 30));
    expect(isExpanded()).toBe(false);
    fireEvent.click(compactButton());
    await waitFor(() => expect(isExpanded()).toBe(true));
  });

  test("Escape with the pointer already outside allows the next genuine hover", async () => {
    const { surface } = await mount();
    await hover(surface);
    fireEvent.pointerDown(surface);
    document.elementFromPoint = () => null;
    fireEvent.pointerOut(surface, { pointerType: "mouse", relatedTarget: document.body });
    fireEvent.keyDown(surface, { key: "Escape" });
    await waitFor(() => expect(isExpanded()).toBe(false));
    await new Promise((done) => setTimeout(done, 20));
    await hover(surface);
  });

  test("Escape restores the capsule and returns focus to it", async () => {
    const { surface } = await mount();
    await hover(surface);
    fireEvent.pointerDown(surface);
    expect(isExpanded()).toBe(true);

    fireEvent.keyDown(surface, { key: "Escape" });

    await waitFor(() => expect(isExpanded()).toBe(false));
    await waitFor(() => expect(document.activeElement).toBe(compactButton()));
    expect(compactButton().textContent).toContain("Open Agent");
  });

  test("Escape on the settings page backs out one level before collapsing", async () => {
    const { surface } = await mount();
    fireEvent.click(compactButton());
    await waitFor(() => expect(isExpanded()).toBe(true));

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Assistant" })).toBeTruthy());

    fireEvent.keyDown(surface, { key: "Escape" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy());
    expect(isExpanded()).toBe(true);

    fireEvent.keyDown(surface, { key: "Escape" });
    await waitFor(() => expect(isExpanded()).toBe(false));
  });

  test("Escape dismisses a pinned card even when DOM focus sits on the page body", async () => {
    const { surface } = await mount();
    await hover(surface);
    fireEvent.pointerDown(surface);
    fireEvent.click(surface);
    expect(document.activeElement).toBe(document.body);

    fireEvent.keyDown(document.body, { key: "Escape" });

    await waitFor(() => expect(isExpanded()).toBe(false));
  });

  test("an inner Escape consumer prevents the shell from dismissing", async () => {
    const { surface } = await mount();
    await hover(surface);
    fireEvent.pointerDown(surface);
    expect(isExpanded()).toBe(true);

    const field = document.createElement("input");
    field.addEventListener("keydown", (event) => event.preventDefault());
    surface.appendChild(field);
    fireEvent.keyDown(field, { key: "Escape" });

    await new Promise((done) => setTimeout(done, 20));
    expect(isExpanded()).toBe(true);
  });

});

function SurfaceHarness({
  surface,
  reducedMotion = false,
  durationMs = 420,
}: {
  surface: string;
  reducedMotion?: boolean;
  durationMs?: number;
  }) {
  const { size, nativeSize, morphMs, stageRef } = useNotchSurfaceSync({
    surface: surface as never,
    shape: "card",
    topOffset: 20,
    measuredHeight: undefined,
    reducedMotion,
    durationMs,
    attempt: 0,
    onObserved: () => {},
    onError: () => {},
  });
  return (
    <div
      data-surface-window="true"
      style={{ width: nativeSize?.width ?? size?.width, height: nativeSize?.height ?? size?.height }}
    >
      <div
        ref={(element) => {
          stageRef.current = element;
          if (element) element.getBoundingClientRect = () => new DOMRect(0, 0, Number.parseFloat(element.style.width), Number.parseFloat(element.style.height));
        }}
        data-surface-stage="true"
        style={{ width: size?.width, height: size?.height, transitionDuration: `${morphMs}ms` }}
      ><main style={{ borderTopLeftRadius: 21, borderBottomLeftRadius: 21 }} /></div>
    </div>
  );
}

const stage = () => document.querySelector<HTMLElement>("[data-surface-stage]");
const surfaceWindow = () => document.querySelector<HTMLElement>("[data-surface-window]");

describe("Otto surface geometry", () => {
  test("expansion and collapse change the body without resizing or reconfiguring its host", async () => {
    const view = render(<SurfaceHarness surface="agentCompact" />);
    await waitFor(() => expect(invocations.some(entry => entry.command === "notch_configure_host")).toBe(true));
    await waitFor(() => expect(surfaceWindow()?.style.width).toBe("550px"));
    invocations.length = 0;
    view.rerender(<SurfaceHarness surface="settings" />);
    expect(stage()?.style.width).toBe("526px");
    expect(surfaceWindow()?.style.width).toBe("550px");
    view.rerender(<SurfaceHarness surface="agentCompact" />);
    expect(stage()?.style.width).toBe("228px");
    expect(surfaceWindow()?.style.width).toBe("550px");
    expect(invocations.filter(entry => entry.command === "notch_configure_host" || entry.command === "notch_set_surface")).toHaveLength(0);
  });

  test("reduced motion applies the target geometry without an animated settle", async () => {
    const view = render(<SurfaceHarness surface="agentCompact" reducedMotion />);
    await waitFor(() => expect(surfaceWindow()?.style.width).toBe("550px"));
    view.rerender(<SurfaceHarness surface="settings" reducedMotion />);
    expect(stage()?.style.width).toBe("526px");
    expect(stage()?.style.transitionDuration).toBe("0ms");
  });
});

describe("Otto native hit region", () => {
  test("the window hit region is synced to the visible surface", async () => {
    invocations.length = 0;
    render(<SurfaceHarness surface="settings" />);

    await waitFor(() => expect(stage()?.style.width).toBe("526px"));
    await waitFor(() =>
      expect(
        invocations.some(
          (entry) =>
            entry.command === "notch_set_region" &&
            (entry.payload as { region: { body: { width: number } } }).region.body.width === 526,
        ),
      ).toBe(true),
    );
  });
});
