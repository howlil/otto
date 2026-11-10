import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

let focusListener: ((focused: boolean) => void) | null = null;
const invocations: Array<{ command: string; payload: unknown }> = [];
const surfaceSizes: Record<string, { width: number; height: number }> = {
  idle: { width: 92, height: 42 },
  agentCompact: { width: 228, height: 50 },
  home: { width: 452, height: 148 },
  homeSettings: { width: 452, height: 314 },
  musicCompact: { width: 264, height: 54 },
  musicPlayer: { width: 444, height: 178 },
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
  cursorPosition: async () => ({ x: 10, y: 10 }),
  getCurrentWindow: () => ({
    innerPosition: async () => ({ x: 0, y: 0 }),
    scaleFactor: async () => 1,
    onFocusChanged: async (handler: (event: { payload: boolean }) => void) => {
      focusListener = (focused) => handler({ payload: focused });
      return () => {
        focusListener = null;
      };
    },
  }),
}));

const { useNotchShell } = await import("../src/features/shell/useNotchShell");
const { useNotchSurfaceSync } = await import("../src/features/shell/useNotchSurfaceSync");
const { ShellView } = await import("../src/AppView");

const agentStub = {} as Parameters<typeof ShellView>[0]["agent"];
const musicStub = {
  snapshot: {
    seq: 0,
    status: "unavailable",
    playback: "unknown",
    title: null,
    artist: null,
    artworkDataUrl: null,
    positionMs: null,
    durationMs: null,
    minSeekMs: null,
    maxSeekMs: null,
    controls: { toggle: false, previous: false, next: false, seek: false },
    message: "Open a supported media app.",
  },
  error: null,
  busy: false,
  refresh: async () => {},
  control: async () => {},
  lyrics: { open: false, enabled: false, status: "off", record: null, error: null, key: "", setOpen: () => {}, enable: async () => {}, disable: async () => {}, retry: () => {} },
} as Parameters<typeof ShellView>[0]["music"];
const focusStub = {} as Parameters<typeof ShellView>[0]["focus"];
const updateStub = {
  state: { status: "idle" },
  checkForUpdate: async () => {},
  installUpdate: async () => {},
} as Parameters<typeof ShellView>[0]["appUpdate"];
const artProps = { tilt: 43, gradient: 80 };

function Harness() {
  const shell = useNotchShell();
  return (
    <ShellView
      agent={agentStub}
      music={musicStub}
      focus={focusStub}
      shell={shell}
      surfaceError={null}
      agentHomeCopy="Ask your CLI"
      musicHomeCopy="No media session"
      artProps={artProps}
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
  await waitFor(() => expect(compactButton().getAttribute("aria-expanded")).toBe("false"));
  return { view, surface };
}

function compactButton(): HTMLButtonElement {
  const element = document.querySelector<HTMLButtonElement>("button[aria-expanded]");
  if (!element) throw new Error("Otto compact button did not render");
  return element;
}

const isExpanded = () => compactButton().getAttribute("aria-expanded") === "true";

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
  localStorage.clear();
  invocations.length = 0;
});

describe("Otto shell hover and pin interaction", () => {
  test("Music opens from Home and returns to Home with the same selected logo expression", async () => {
    await mount({ expression: "happy" });

    fireEvent.click(compactButton());
    await waitFor(() => expect(isExpanded()).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: /Music No media session/i }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "Music" })).toBeTruthy());
    expect(screen.getByRole("button", { name: "Back to Home" }).querySelector("[data-expression]")?.getAttribute("data-expression")).toBe("happy");

    fireEvent.click(screen.getByRole("button", { name: "Back to Home" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Music No media session/i })).toBeTruthy(),
    );
    expect(isExpanded()).toBe(true);
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

  test("Escape restores the capsule and returns focus to it", async () => {
    const { surface } = await mount();
    await hover(surface);
    fireEvent.pointerDown(surface);
    expect(isExpanded()).toBe(true);

    fireEvent.keyDown(surface, { key: "Escape" });

    await waitFor(() => expect(isExpanded()).toBe(false));
    await waitFor(() => expect(document.activeElement).toBe(compactButton()));
    expect(compactButton().textContent).toContain("Open Otto");
  });

  test("Escape on the settings page backs out one level before collapsing", async () => {
    const { surface } = await mount();
    fireEvent.click(compactButton());
    await waitFor(() => expect(isExpanded()).toBe(true));

    fireEvent.click(screen.getByRole("button", { name: "Open Otto settings" }));
    await waitFor(() => expect(screen.getByText("Settings")).toBeTruthy());

    fireEvent.keyDown(surface, { key: "Escape" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Open Otto settings" })).toBeTruthy());
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

  test("activating the compact control inside a preview pins instead of collapsing", async () => {    const { surface } = await mount();
    await hover(surface);

    fireEvent.click(compactButton());

    await new Promise((done) => setTimeout(done, 20));
    expect(isExpanded()).toBe(true);

    fireEvent.click(compactButton());

    await waitFor(() => expect(isExpanded()).toBe(false));
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
    const view = render(<SurfaceHarness surface="idle" />);
    await waitFor(() => expect(invocations.some(entry => entry.command === "notch_configure_host")).toBe(true));
    await waitFor(() => expect(surfaceWindow()?.style.width).toBe("550px"));
    invocations.length = 0;
    view.rerender(<SurfaceHarness surface="home" />);
    expect(stage()?.style.width).toBe("452px");
    expect(surfaceWindow()?.style.width).toBe("550px");
    view.rerender(<SurfaceHarness surface="idle" />);
    expect(stage()?.style.width).toBe("92px");
    expect(surfaceWindow()?.style.width).toBe("550px");
    expect(invocations.filter(entry => entry.command === "notch_configure_host" || entry.command === "notch_set_surface")).toHaveLength(0);
  });

  test("reduced motion applies the target geometry without an animated settle", async () => {
    const view = render(<SurfaceHarness surface="idle" reducedMotion />);
    await waitFor(() => expect(surfaceWindow()?.style.width).toBe("550px"));
    view.rerender(<SurfaceHarness surface="home" reducedMotion />);
    expect(stage()?.style.width).toBe("452px");
    expect(stage()?.style.transitionDuration).toBe("0ms");
  });
});

describe("Otto native hit region", () => {
  test("the window hit region is synced to the visible surface", async () => {
    invocations.length = 0;
    render(<SurfaceHarness surface="home" />);

    await waitFor(() => expect(stage()?.style.width).toBe("452px"));
    await waitFor(() =>
      expect(
        invocations.some(
          (entry) =>
            entry.command === "notch_set_region" &&
            (entry.payload as { region: { body: { width: number } } }).region.body.width === 452,
        ),
      ).toBe(true),
    );
  });
});

describe("Otto shell morph anchoring", () => {
  test("compact eyes and the expanded corner logo use the same geometry", async () => {
    const { surface } = await mount({ motion: "fluid" });
    expect(compactButton().dataset.anchor).toBe("center");
    expect(compactButton().querySelector("[data-otto-logo]")).toBeNull();
    expect(compactButton().querySelector("[data-expression]")?.className).toContain("w-8");

    await hover(surface);
    expect(compactButton().dataset.anchor).toBe("corner");
    expect(compactButton().className).toContain("left-4");
    expect(compactButton().className).not.toContain("left-1/2");
    expect(compactButton().className).toContain("transition-[left,top,translate,width,height]");
    expect(compactButton().querySelector("[data-otto-logo]")?.className).toContain(
      "rounded-otto-panel",
    );
    expect(compactButton().querySelector("[data-expression]")?.className).toContain("w-8");

    await new Promise((done) => setTimeout(done, 500));
    expect(compactButton().dataset.anchor).toBe("corner");
    expect(compactButton().className).toContain("left-4");

    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() => expect(isExpanded()).toBe(false));
    expect(compactButton().dataset.anchor).toBe("center");
    expect(compactButton().querySelector("[data-otto-logo]")).toBeNull();
  });

  test("reduced motion settles the logo in the expanded corner", async () => {
    const { surface } = await mount({ motion: "reduced" });
    await hover(surface);
    expect(compactButton().dataset.anchor).toBe("corner");
  });
});
