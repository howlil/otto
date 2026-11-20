
import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { History } from "../../src/features/agent/history/History";
import type { AgentHistoryModel } from "../../src/features/agent/model/view-model";

const layouts = {
  agentCompact: [228, 40], agentReady: [526, 170],
  agentThinking: [526, 236], agentFull: [526, 346], agentError: [526, 270], settings: [526, 466],
} satisfies import("../../src/platform/tauri").NotchLayouts;
const hostCalls: unknown[] = [];
const regionCalls: Array<import("../../src/platform/tauri").NotchRegionPx> = [];
let rejectRegions = false;
let capacity = { width: 550, height: 610 };
let holdRegions = false;
let resolveRegion: ((applied: boolean) => void) | null = null;
let rejectRegion: ((reason: Error) => void) | null = null;
let moved: ((event: { payload: { x: number; y: number } }) => void) | null = null;
let displayChanged: (() => void) | null = null;
mock.module("@tauri-apps/api/event", () => ({
  listen: async (_name: string, callback: () => void) => {
    displayChanged = callback;
    return () => { displayChanged = null; };
  },
}));
mock.module("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: (command: string, payload: unknown) => {
    if (command === "notch_configure_host") {
      hostCalls.push(payload);
      return Promise.resolve({ revision: hostCalls.length, placement: "floating", ...capacity, scale: 1.5, layouts });
    }
    if (command === "notch_set_region") {
      regionCalls.push((payload as { region: import("../../src/platform/tauri").NotchRegionPx }).region);
      if (rejectRegions) return Promise.reject(new Error("region rejected"));
      if (holdRegions) return new Promise<boolean>((resolve, reject) => { resolveRegion = resolve; rejectRegion = reject; });
      return Promise.resolve(true);
    }
    return Promise.resolve(null);
  },
  Channel: class {},
  Resource: class {},
  transformCallback: (callback: unknown) => callback,
}));
mock.module("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onMoved: async (callback: typeof moved) => { moved = callback; return () => { moved = null; }; }, onScaleChanged: async () => () => {} }),
}));
const { createGeometryQueue, useNotchSurfaceSync } = await import("../../src/features/shell/surface-sync/useNotchSurfaceSync");
const { TransitionContent } = await import("../../src/shared/ui/TransitionContent");
const { ShellFrame } = await import("../../src/features/shell/ui/ShellFrame");
const { ShellView } = await import("../../src/app/AppView");
const { defaults } = await import("../../src/features/shell/model/preferences");
const { renderedRegion } = await import("../../src/features/shell/surface-sync/useRenderedRegion");
const { surfaceLayout } = await import("../../src/features/shell/surface-sync/layout");
const { SurfaceError } = await import("../../src/features/shell/ui/SurfaceError");
type Region = import("../../src/platform/tauri").NotchRegionPx;

const agentStub = {
  snapshot: {
    runId: 0, seq: 0, status: "idle", provider: "codex", threadId: null,
    model: null, thinkingEffort: null, usage: null, messages: [],
    capture: { requestId: 0, phase: "idle", error: null }, error: null,
  },
  installed: true,
  readiness: {
    status: "ready", message: "Ready", recovery: "", imageInput: false,
    imageTransport: false, model: null, models: [],
    thinkingEffort: null, thinkingEfforts: [],
  },
  error: null, draft: "", setDraft: () => {}, errorKind: null, busy: false,
  captureBusy: false, send: async () => {}, stop: async () => {},
  refreshProvider: async () => {}, retryConnection: async () => {},
  clearError: () => {}, captureNow: async () => {}, insertText: async () => {}, history: { refresh: async () => {} },
  provider: "codex", model: null, setModel: () => {}, thinkingEffort: null,
  setThinkingEffort: () => {}, setProvider: () => {}, locked: false,
  newSession: async () => true,
} as unknown as Parameters<typeof ShellView>[0]["agent"];

afterEach(() => { cleanup(); hostCalls.length = 0; regionCalls.length = 0; rejectRegions = false; holdRegions = false; resolveRegion = null; capacity = { width: 550, height: 610 }; });

function AgentHarness({ expanded }: { expanded: boolean }) {
  const frame = useNotchSurfaceSync({ surface: expanded ? "agentReady" : "agentCompact", shape: expanded ? "card" : "capsule",
    topOffset: 20, measuredHeight: undefined, reducedMotion: false, durationMs: 420, attempt: 0, onObserved: () => {}, onError: () => {} });
  const shell = { expanded, isAgent: true, page: "agent", pinned: true, reducedMotion: false,
    prefs: defaults, placement: { applied: "floating" }, compactButton: { current: null }, appSettingsButton: { current: null },
    eventMotion: "", handleEnter: () => {}, handleLeave: () => {}, handleEscape: () => {}, open: () => {}, collapse: () => {}, pin: () => {},
  } as Parameters<typeof ShellView>[0]["shell"];
  return <ShellView agent={agentStub} shell={shell} surfaceError={null}
    gutter={0} {...frame}
    onContentMeasured={() => {}} appUpdate={{} as Parameters<typeof ShellView>[0]["appUpdate"]}
  />;
}

test("expanding Agent commits content and motion at its target width without resizing its host", async () => {
  const view = render(<AgentHarness expanded={false} />);
  await waitFor(() => expect(hostCalls).toHaveLength(1));
  view.rerender(<AgentHarness expanded />);
  expect(view.container.querySelector<HTMLElement>(".otto-page-center-enter")?.style.width).toBe("526px");
  expect(view.container.querySelector<HTMLElement>("[data-surface-stage]")?.style.width).toBe("526px");
  expect(view.container.querySelector<HTMLElement>("[data-placement]")?.style.getPropertyValue("--otto-morph-duration")).toBe("420ms");
  view.rerender(<AgentHarness expanded={false} />);
  expect(view.container.querySelector<HTMLElement>("[data-surface-window]")?.style.width).toBe("550px");
  await act(async () => { await Promise.resolve(); });
  expect(hostCalls).toHaveLength(1);
});

test("the floating compact shell uses a numeric pill radius while expanded keeps card corners", async () => {
  const view = render(<AgentHarness expanded={false} />);
  const main = view.container.querySelector("main")!;
  expect(main.classList.contains("rounded-otto-island")).toBe(true);
  expect(main.style.borderRadius).toBe("20px");
  expect(main.classList.contains("active:scale-[0.97]")).toBe(true);
  view.rerender(<AgentHarness expanded />);
  expect(main.classList.contains("rounded-otto-expanded")).toBe(true);
  expect(main.style.borderRadius).toBe("");
  expect(main.classList.contains("active:scale-[0.97]")).toBe(false);
});

test("a first measured height arriving mid-expand keeps the running morph active", async () => {
  const hook = renderHook(({ expanded, height }: { expanded: boolean; height?: number }) =>
    useNotchSurfaceSync({
      surface: expanded ? "agentReady" : "agentCompact",
      shape: expanded ? "card" : "capsule",
      topOffset: 20,
      measuredHeight: height,
      reducedMotion: false,
      durationMs: 260,
      attempt: 0,
      onObserved: () => {},
      onError: () => {},
    }),
    { initialProps: { expanded: false, height: undefined as number | undefined } });
  await waitFor(() => expect(hook.result.current.nativeSize.width).toBe(550));
  hook.rerender({ expanded: true, height: undefined });
  expect(hook.result.current.morphMs).toBe(260);
  hook.rerender({ expanded: true, height: 240 });
  expect(hook.result.current.morphMs).toBeGreaterThanOrEqual(120);
  expect(hook.result.current.size).toEqual({ width: 526, height: 240 });
});

test("native display parameter changes refresh geometry even without a window move or DPI change", async () => {
  const view = renderHook(() => useNotchSurfaceSync({ surface: "agentCompact", shape: "capsule",
    topOffset: 20, measuredHeight: undefined, reducedMotion: true,
    durationMs: 0, attempt: 0, onObserved: () => {}, onError: () => {} }));
  await waitFor(() => expect(hostCalls).toHaveLength(1));
  await waitFor(() => expect(displayChanged).not.toBeNull());
  capacity = { width: 500, height: 580 };
  act(() => displayChanged?.());
  await waitFor(() => expect(view.result.current.nativeSize.width).toBe(500));
  expect(hostCalls).toHaveLength(2);
});

test("attached shoulders share the animated body anchor", () => {
  const view = render(<ShellFrame placement="attached" gutter={12} size={{ width: 228, height: 40 }}
    nativeSize={{ width: 550, height: 610 }} morphMs={420} stageRef={{ current: null }}><main /></ShellFrame>);
  const stage = view.container.querySelector("[data-surface-stage]");
  expect(view.container.querySelector(".otto-shoulder-l")?.parentElement).toBe(stage);
  expect(view.container.querySelector(".otto-shoulder-r")?.parentElement).toBe(stage);
  expect(stage?.classList.contains("overflow-hidden")).toBe(false);
});

test("content sizing uses the active target width and stays inside monitor capacity", () => {
  expect(surfaceLayout("agentReady", "card", 210, { ...capacity, layouts, scale: 1 })).toEqual({ width: 526, height: 210 });
  expect(surfaceLayout("settings", "attached", 900, { width: 480, height: 400, layouts, scale: 1 })).toEqual({ width: 456, height: 400 });
  expect(surfaceLayout("agentCompact", "capsule", 500, { ...capacity, layouts, scale: 1 })).toEqual({ width: 228, height: 40 });
});

test("settled surface dimensions stay on the physical grid across supported DPI scales", () => {
  for (const scale of [1, 1.25, 1.5, 1.75, 2]) {
    const host = { ...capacity, layouts, scale };
    for (const surface of Object.keys(layouts) as Array<keyof typeof layouts>) {
      const size = surfaceLayout(surface, "card", undefined, host);
      expect(size.width * scale).toBeCloseTo(Math.round(size.width * scale), 8);
      expect(size.height * scale).toBeCloseTo(Math.round(size.height * scale), 8);
    }
  }
});

test("the rendered stage corrects half-pixel centering without moving attached shoulders separately", () => {
  for (const placement of ["floating", "attached"] as const) {
    const view = render(<ShellFrame placement={placement} gutter={placement === "attached" ? 12 : 0}
      scale={1.5} size={{ width: 228, height: 40 }} nativeSize={{ width: 550, height: 610 }}
      morphMs={420} stageRef={{ current: null }}><main /></ShellFrame>);
    const stage = view.container.querySelector<HTMLElement>("[data-surface-stage]")!;
    const correction = Number.parseFloat(stage.style.translate || "0");
    const left = (550 - 92) / 2 + correction;
    expect(left * 1.5).toBeCloseTo(344, 8);
    expect((left + 92) * 1.5).toBeCloseTo(482, 8);
    expect(Math.abs(correction * 1.5)).toBeLessThanOrEqual(0.5);
    view.unmount();
  }
});

test("stage centering stays on the grid at integer DPI and after fractional host rounding", () => {
  for (const scale of [1, 1.25, 1.5, 1.75, 2]) {
    const hostWidth = Math.round(550 * scale) / scale;
    const size = surfaceLayout("agentReady", "card", undefined, { width: hostWidth, height: 610, layouts, scale });
    const view = render(<ShellFrame placement="floating" gutter={0} scale={scale} size={size}
      nativeSize={{ width: hostWidth, height: 610 }} morphMs={0} stageRef={{ current: null }}><main /></ShellFrame>);
    const correction = Number.parseFloat(view.container.querySelector<HTMLElement>("[data-surface-stage]")!.style.translate);
    const left = ((hostWidth - size.width) / 2 + correction) * scale;
    expect(left).toBeCloseTo(Math.round(left), 8);
    expect(left + size.width * scale).toBeCloseTo(Math.round(left + size.width * scale), 8);
    if (scale === 1 || scale === 2) expect(correction).toBe(0);
    view.unmount();
  }
});

test("pixel normalization never overflows a constrained attached host", () => {
  for (const scale of [1.25, 1.5, 1.75]) {
    const host = { width: 400 / scale, height: 600 / scale, layouts, scale };
    const size = surfaceLayout("settings", "attached", 900, host);
    expect(size.width * scale).toBeCloseTo(Math.round(size.width * scale), 8);
    expect(size.width + 24).toBeLessThanOrEqual(host.width);
    expect(size.height).toBeLessThanOrEqual(host.height);
  }
});

test("the confirmed host scale reaches the stage and reacts to navigation", async () => {
  const view = render(<AgentHarness expanded={false} />);
  await waitFor(() => {
    const stage = view.container.querySelector<HTMLElement>("[data-surface-stage]")!;
    expect(Number.parseFloat(stage.style.translate || "0")).toBeCloseTo(1 / 3, 8);
  });
  view.rerender(<AgentHarness expanded />);
  const stage = view.container.querySelector<HTMLElement>("[data-surface-stage]")!;
  expect(((550 - 526) / 2 + Number.parseFloat(stage.style.translate)) * 1.5).toBeCloseTo(18, 8);
});

test("natural content height resolves to a whole confirmed device pixel", () => {
  const host = { revision: 3, placement: "floating" as const, width: 550, height: 610, scale: 1.5, layouts };
  expect(surfaceLayout("agentReady", "card", 303, host).height * host.scale).toBe(455);
  expect(surfaceLayout("agentReady", "card", 304, host).height * host.scale).toBe(456);
});

test("region conversion uses rendered position and interpolated radii with one physical pixel rounding", () => {
  const view = render(<div data-placement="floating"><div data-stage><main style={{ borderTopLeftRadius: 18, borderBottomLeftRadius: 20 }} /></div></div>);
  const stage = view.container.querySelector<HTMLElement>("[data-stage]")!;
  stage.getBoundingClientRect = () => new DOMRect(10.2, 0, 100.4, 42);
  expect(renderedRegion(stage, { revision: 3, placement: "floating", width: 550, height: 610, scale: 1.5, layouts }, 7)).toEqual({
    hostRevision: 3, sequence: 7, body: { x: 15, y: 0, width: 151, height: 63 }, radius: { top: 27, bottom: 30 }, shoulder: 0,
  });
  stage.getBoundingClientRect = () => new DOMRect(10.4, 0.2, 100.4, 42.2);
  expect(renderedRegion(stage, { revision: 3, placement: "floating", width: 550, height: 610, scale: 1.5, layouts }, 8)?.body).toEqual({ x: 15, y: 0, width: 152, height: 64 });
});

function region(sequence: number, width = 138): Region {
  return { hostRevision: 1, sequence, body: { x: 0, y: 0, width, height: 63 }, radius: { top: 31, bottom: 31 }, shoulder: 0 };
}

test("region writes keep one in flight and only the latest pending geometry", async () => {
  holdRegions = true;
  const queue = createGeometryQueue();
  queue.configure(1);
  queue.enqueue(region(1), () => {});
  queue.enqueue(region(2, 200), () => {});
  queue.enqueue(region(3, 300), () => {});
  expect(regionCalls.map(value => value.sequence)).toEqual([1]);
  const finish = resolveRegion!;
  holdRegions = false;
  finish(true);
  await waitFor(() => expect(regionCalls.map(value => value.sequence)).toEqual([1, 3]));
  queue.dispose();
});

test("unchanged geometry deduplicates while failed writes remain retryable", async () => {
  const queue = createGeometryQueue();
  queue.configure(1);
  queue.enqueue(region(1), () => {});
  await act(async () => { await Promise.resolve(); });
  queue.enqueue(region(2), () => {});
  await act(async () => { await Promise.resolve(); });
  expect(regionCalls).toHaveLength(1);
  rejectRegions = true;
  let errors = 0;
  queue.enqueue(region(3, 200), () => { errors++; });
  await waitFor(() => expect(errors).toBe(1));
  rejectRegions = false;
  queue.enqueue(region(4, 200), () => {});
  await waitFor(() => expect(regionCalls).toHaveLength(3));
  expect(performance.getEntriesByName("notch_set_region")).toHaveLength(1);
  queue.dispose();
});

test("host invalidation discards queued frames from the previous display revision", async () => {
  holdRegions = true;
  const queue = createGeometryQueue();
  queue.configure(1);
  queue.enqueue(region(1), () => {});
  queue.enqueue(region(2, 200), () => {});
  queue.configure(2);
  holdRegions = false;
  resolveRegion!(true);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(regionCalls).toHaveLength(1);
  queue.enqueue({ ...region(3), hostRevision: 2 }, () => {});
  await waitFor(() => expect(regionCalls).toHaveLength(2));
  queue.dispose();
});

test("first content measurement snaps, later height changes cap motion, and reduced motion stops it", async () => {
  const hook = renderHook(({ height, reduced }: { height?: number; reduced: boolean }) =>
    useNotchSurfaceSync({ surface: "agentReady", shape: "card", topOffset: 20, measuredHeight: height,
      reducedMotion: reduced, durationMs: 420, attempt: 0, onObserved: () => {}, onError: () => {} }),
    { initialProps: { height: undefined, reduced: false } });
  await waitFor(() => expect(hook.result.current.nativeSize.width).toBe(550));
  await act(async () => { await Promise.resolve(); });
  hook.rerender({ height: 210, reduced: false });
  expect(hook.result.current.size).toEqual({ width: 526, height: 210 });
  expect(hook.result.current.morphMs).toBe(0);
  hook.rerender({ height: 260, reduced: false });
  expect(hook.result.current.morphMs).toBe(170);
  hook.rerender({ height: 300, reduced: true });
  expect(hook.result.current.morphMs).toBe(0);
});

test("display capacity changes clamp immediately without animating outside the new host", async () => {
  const hook = renderHook(({ surface, attempt }: { surface: "settings" | "agentReady"; attempt: number }) =>
    useNotchSurfaceSync({ surface, shape: "card", topOffset: 20, measuredHeight: undefined,
      reducedMotion: false, durationMs: 420, attempt, onObserved: () => {}, onError: () => {} }),
    { initialProps: { surface: "settings", attempt: 0 } });
  await waitFor(() => expect(hostCalls).toHaveLength(1));
  hook.rerender({ surface: "agentReady", attempt: 0 });
  expect(hook.result.current.size.width).toBe(526);
  capacity = { width: 400, height: 200 };
  hook.rerender({ surface: "agentReady", attempt: 1 });
  await waitFor(() => expect(hook.result.current.nativeSize.width).toBe(400));
  expect(hook.result.current.size).toEqual({ width: 400, height: 170 });
  expect(hook.result.current.morphMs).toBe(0);
});

test("native move notifications persist the position without reconfiguring the host", async () => {
  const movedPositions: Array<{ x: number; y: number }> = [];
  const hook = renderHook(() => useNotchSurfaceSync({ surface: "agentCompact", shape: "capsule", topOffset: 20,
    measuredHeight: undefined, reducedMotion: true, durationMs: 0, attempt: 0,
    onObserved: () => {}, onError: () => {}, onMoved: position => movedPositions.push(position) }));
  await waitFor(() => expect(moved).not.toBeNull());
  act(() => moved!({ payload: { x: 100, y: 20 } }));
  act(() => { for (let i = 0; i < 10; i++) moved!({ payload: { x: 100, y: 20 } }); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
  expect(hostCalls).toHaveLength(1);
  act(() => moved!({ payload: { x: 200, y: 20 } }));
  expect(hostCalls).toHaveLength(1);
  expect(movedPositions).toEqual([{ x: 100, y: 20 }, { x: 200, y: 20 }]);
  hook.unmount();
  expect(moved).toBeNull();
});

test("placement is confirmed only after its native region is acknowledged", async () => {
  holdRegions = true;
  const observed: string[] = [];
  function ConfirmationHarness() {
    const frame = useNotchSurfaceSync({ surface: "agentCompact", shape: "capsule", topOffset: 20,
      measuredHeight: undefined, reducedMotion: true, durationMs: 0, attempt: 0,
      onObserved: placement => observed.push(placement), onError: () => {} });
    return <div data-placement="floating"><div ref={element => {
      frame.stageRef.current = element;
      if (element) element.getBoundingClientRect = () => new DOMRect(229, 0, 228, 40);
    }}><main style={{ borderTopLeftRadius: 21, borderBottomLeftRadius: 21 }} /></div></div>;
  }
  render(<ConfirmationHarness />);
  await waitFor(() => expect(regionCalls).toHaveLength(1));
  expect(observed).toEqual([]);
  holdRegions = false;
  await act(async () => resolveRegion!(true));
  await waitFor(() => expect(observed).toEqual(["floating"]));
});

test("a failed obsolete frame cannot pause the current page transition", async () => {
  holdRegions = true;
  const errors: string[] = [];
  function PendingHarness({ expanded }: { expanded: boolean }) {
    const frame = useNotchSurfaceSync({ surface: expanded ? "agentReady" : "agentCompact", shape: "card", topOffset: 20,
      measuredHeight: undefined, reducedMotion: true, durationMs: 0, attempt: 0,
      onObserved: () => {}, onError: error => errors.push(error) });
    return <div data-placement="floating"><div data-pending-stage style={{ width: frame.size.width, height: frame.size.height }}
      ref={element => { frame.stageRef.current = element; if (element) element.getBoundingClientRect = () =>
        new DOMRect((550 - Number.parseFloat(element.style.width)) / 2, 0, Number.parseFloat(element.style.width), Number.parseFloat(element.style.height)); }}>
      <main style={{ borderTopLeftRadius: 21, borderBottomLeftRadius: 21 }} />
    </div></div>;
  }
  const view = render(<PendingHarness expanded={false} />);
  await waitFor(() => expect(regionCalls).toHaveLength(1));
  view.rerender(<PendingHarness expanded />);
  holdRegions = false;
  await act(async () => rejectRegion!(new Error("obsolete frame failed")));
  await waitFor(() => expect(regionCalls).toHaveLength(2));
  expect(errors).toEqual([]);
  expect(view.container.querySelector<HTMLElement>("[data-pending-stage]")?.style.width).toBe("526px");
});

test("failed region writes retain a usable recovery surface and Retry preserves the draft", async () => {
  function RecoveryHarness({ expanded }: { expanded: boolean }) {
    const [attempt, setAttempt] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [draft, setDraft] = useState("keep this draft");
    const frame = useNotchSurfaceSync({ surface: expanded ? "agentReady" : "agentCompact", shape: expanded ? "card" : "capsule",
      topOffset: 20, measuredHeight: undefined, reducedMotion: true, durationMs: 0, attempt,
      onObserved: () => {}, onError: setError });
    return <div data-placement="floating"><div data-recovery-stage style={{ width: frame.size.width, height: frame.size.height }}
      ref={element => { frame.stageRef.current = element; if (element) element.getBoundingClientRect = () =>
        new DOMRect((550 - Number.parseFloat(element.style.width)) / 2, 0, Number.parseFloat(element.style.width), Number.parseFloat(element.style.height)); }}>
      <main style={{ borderTopLeftRadius: 21, borderBottomLeftRadius: 21 }}>
        <input value={draft} onChange={event => setDraft(event.target.value)} />
        <SurfaceError message={error} expanded={expanded} onRetry={() => { setError(null); setAttempt(current => current + 1); }} />
      </main>
    </div></div>;
  }
  const view = render(<RecoveryHarness expanded={false} />);
  await waitFor(() => expect(regionCalls.length).toBeGreaterThan(0));
  await act(async () => { await Promise.resolve(); });
  const confirmedWidth = regionCalls.at(-1)!.body.width / 1.5;
  rejectRegions = true;
  view.rerender(<RecoveryHarness expanded />);
  await waitFor(() => expect(view.getByRole("alert")).toBeTruthy());
  expect(Number.parseFloat(view.container.querySelector<HTMLElement>("[data-recovery-stage]")!.style.width)).toBeCloseTo(confirmedWidth, 5);
  rejectRegions = false;
  fireEvent.click(view.getByRole("button", { name: "Retry window" }));
  await waitFor(() => expect(view.container.querySelector<HTMLElement>("[data-recovery-stage]")?.style.width).toBe("526px"));
  expect(view.getByRole("textbox").getAttribute("value")).toBe("keep this draft");
  expect(view.queryByRole("alert")).toBeNull();
});

test("recovery renders the acknowledged position and radius and keeps Retry operable", () => {
  let retries = 0;
  const shell = { expanded: true, isAgent: true, page: "agent", pinned: true, reducedMotion: true,
    prefs: defaults, placement: { applied: "floating" }, compactButton: { current: null }, appSettingsButton: { current: null },
    eventMotion: "", handleEnter: () => {}, handleLeave: () => {}, handleEscape: () => {}, open: () => {}, collapse: () => {}, pin: () => {},
  } as Parameters<typeof ShellView>[0]["shell"];
  const recovery = { scale: 1.5, region: { ...region(1), body: { x: 200, y: 5, width: 138, height: 63 }, radius: { top: 27, bottom: 30 } } };
  const view = render(<ShellView agent={agentStub} shell={shell}
    surfaceError="Windows kept the previous shape"
    gutter={0} size={{ width: 228, height: 40 }} nativeSize={{ width: 550, height: 610 }} morphMs={0}
    stageRef={{ current: null }} onContentMeasured={() => {}} appUpdate={{} as Parameters<typeof ShellView>[0]["appUpdate"]}
    recovery={recovery} onRetrySurface={() => { retries++; }} />);
  const stage = view.container.querySelector<HTMLElement>("[data-surface-stage]")!;
  expect(Number.parseFloat(stage.style.left)).toBeCloseTo(200 / 1.5);
  expect(Number.parseFloat(stage.style.top)).toBeCloseTo(5 / 1.5);
  expect(stage.style.translate).toBe("");
  expect(stage.querySelector("main")?.style.borderTopLeftRadius).toBe("18px");
  expect(stage.querySelector("main")?.style.borderBottomLeftRadius).toBe("20px");
  fireEvent.click(view.getByRole("button", { name: "Retry window" }));
  expect(retries).toBe(1);
});

test("an outgoing nested history view cannot resize the active page", () => {
  const original = globalThis.ResizeObserver;
  const observers = new Map<ResizeObserver, { callback: ResizeObserverCallback; targets: Set<Element> }>();
  globalThis.ResizeObserver = class {
    constructor(callback: ResizeObserverCallback) {
      observers.set(this as unknown as ResizeObserver, { callback, targets: new Set() });
    }
    observe(target: Element) {
      observers.get(this as unknown as ResizeObserver)?.targets.add(target);
    }
    unobserve(target: Element) {
      observers.get(this as unknown as ResizeObserver)?.targets.delete(target);
    }
    disconnect() {
      observers.delete(this as unknown as ResizeObserver);
    }
  } as unknown as typeof ResizeObserver;
  try {
    const measurements: number[] = [];
    const history: AgentHistoryModel = {
      conversations: [], query: "", pending: false, error: null,
      setQuery: () => {}, refresh: async () => {}, open: async () => true,
      rename: async () => true, remove: async () => true, removeAll: async () => true,
    };
    const view = (page: string) => (
      <TransitionContent transitionKey={page} reducedMotion={false}>
        {page === "agent" ? (
          <TransitionContent transitionKey="history" reducedMotion={false}>
            <History history={history} busy={false} onDone={() => {}}
              onMeasured={(height) => measurements.push(height)} />
          </TransitionContent>
        ) : <div>Global settings</div>}
      </TransitionContent>
    );
    const mounted = render(view("agent"));
    expect(measurements.length).toBeGreaterThan(0);
    mounted.rerender(view("global-settings"));
    expect(mounted.container.querySelector("[inert] input")).toBeTruthy();
    const before = [...measurements];
    act(() => {
      for (const [observer, { callback, targets }] of observers) {
        for (const target of targets) Object.defineProperty(target, "scrollHeight", { configurable: true, value: 500 });
        callback([], observer);
      }
    });
    expect(measurements).toEqual(before);
    mounted.rerender(view("agent"));
    expect(measurements.length).toBeGreaterThan(before.length);
    mounted.unmount();
  } finally {
    globalThis.ResizeObserver = original;
  }
});

describe("retained transition content", () => {
  test("removes outgoing content on its own exit animation and not a nested animation", () => {
    const view = render(
      <TransitionContent transitionKey="global-settings" reducedMotion={false}>
        <div data-frame="global-settings" />
      </TransitionContent>,
    );
    view.rerender(
      <TransitionContent transitionKey="agent" reducedMotion={false}>
        <div data-frame="agent" />
      </TransitionContent>,
    );
    const outgoing = view.container.querySelector<HTMLElement>("[aria-hidden='true']");
    expect(outgoing).not.toBeNull();
    const nested = outgoing?.querySelector<HTMLElement>("[data-frame='global-settings']");
    expect(nested).not.toBeNull();
    fireEvent.animationEnd(nested!);
    expect(view.container.querySelector("[aria-hidden='true']")).not.toBeNull();
    fireEvent.animationEnd(outgoing!);
    expect(view.container.querySelector("[aria-hidden='true']")).toBeNull();
    expect(view.container.querySelector("[data-frame='agent']")).not.toBeNull();
  });

  test("keeps the outgoing content frame at its previous layout size", () => {
    const view = render(
      <TransitionContent
        transitionKey="compact"
        reducedMotion={false}
        frameSize={{ width: 228, height: 40 }}
      >
        <div data-frame="compact" />
      </TransitionContent>,
    );

    view.rerender(
      <TransitionContent
        transitionKey="agent"
        reducedMotion={false}
        frameSize={{ width: 526, height: 170 }}
      >
        <div data-frame="agent" />
      </TransitionContent>,
    );

    const outgoing = view.container.querySelector<HTMLElement>("[aria-hidden='true']");
    const incoming = view.container.querySelector<HTMLElement>("[data-frame='agent']")?.parentElement;
    expect(outgoing?.style.width).toBe("228px");
    expect(outgoing?.style.height).toBe("40px");
    expect(outgoing?.style.left).toBe("50%");
    expect(outgoing?.style.marginLeft).toBe("-114px");
    expect(incoming?.style.width).toBe("526px");
    expect(incoming?.style.height).toBe("170px");
    expect(incoming?.style.left).toBe("50%");
    expect(incoming?.style.marginLeft).toBe("-263px");
  });
});
