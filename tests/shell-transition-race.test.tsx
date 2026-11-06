import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, renderHook, waitFor } from "@testing-library/react";

const surfaceCalls: Array<{
  payload: { surface: string; deferShrink: boolean };
  resolve: (value: {
    placement: "floating";
    width: number;
    height: number;
    geometryConfirmed?: boolean;
  }) => void;
}> = [];
const hitCalls: Array<{ payload: { width: number; height: number; shape: string } }> = [];
let failHitRegion = false;

const surfaceSizes = {
  idle: { width: 92, height: 42 },
  home: { width: 452, height: 148 },
  homeSettings: { width: 452, height: 314 },
};

mock.module("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: (command: string, payload: unknown) => {
    if (command === "notch_set_surface") {
      return new Promise((resolve) => {
        surfaceCalls.push({
          payload: payload as { surface: string; deferShrink: boolean },
          resolve,
        });
      });
    }
    if (command === "notch_set_hit_region") {
      hitCalls.push(payload as { width: number; height: number; shape: string });
      return failHitRegion ? Promise.reject(new Error("native hit region failure")) : Promise.resolve(null);
    }
    if (command === "notch_measure_surface") {
      const surface = (payload as { surface: keyof typeof surfaceSizes }).surface;
      return Promise.resolve({ placement: "floating", ...surfaceSizes[surface] });
    }
    return Promise.resolve(null);
  },
  Channel: class {},
}));

const { createGeometryQueue, useNotchSurfaceSync } = await import(
  "../src/features/shell/useNotchSurfaceSync",
);
const { TransitionContent } = await import("../src/shared/ui/TransitionContent");
const { ShellFrame } = await import("../src/features/shell/ShellFrame");

function useSurface(
  surface: "idle" | "home" | "homeSettings",
  options: { measuredHeight?: number; reducedMotion?: boolean; durationMs?: number } = {},
) {
  return useNotchSurfaceSync({
    surface,
    shape: "capsule",
    topOffset: 20,
    measuredHeight: options.measuredHeight,
    reducedMotion: options.reducedMotion ?? true,
    durationMs: options.durationMs ?? 0,
    attempt: 0,
    onObserved: () => {},
    onError: () => {},
  });
}

function SurfaceHarness({
  surface,
  measuredHeight,
  reducedMotion = true,
  durationMs = 0,
}: {
  surface: "idle" | "home" | "homeSettings";
  measuredHeight?: number;
  reducedMotion?: boolean;
  durationMs?: number;
}) {
  const { size, stageRef, morphMs } = useSurface(surface, { measuredHeight, reducedMotion, durationMs });
  return (
    <div
      ref={stageRef}
      data-surface-stage="true"
      style={{ width: size?.width, height: size?.height, transitionDuration: `${morphMs}ms` }}
    />
  );
}

afterEach(() => {
  cleanup();
  surfaceCalls.length = 0;
  hitCalls.length = 0;
  failHitRegion = false;
});

describe("native surface transition ordering", () => {
  test("starts a native shrink only after the CSS stage transition completes", async () => {
    const view = render(<SurfaceHarness surface="home" reducedMotion={false} durationMs={420} />);
    await waitFor(() => expect(surfaceCalls).toHaveLength(1));
    await act(async () => {
      surfaceCalls[0].resolve({ placement: "floating", width: 452, height: 148 });
    });
    await waitFor(() =>
      expect(document.querySelector<HTMLElement>("[data-surface-stage]")?.style.width).toBe("452px"),
    );

    view.rerender(<SurfaceHarness surface="idle" reducedMotion={false} durationMs={420} />);
    await waitFor(() => expect(surfaceCalls).toHaveLength(2));
    expect(surfaceCalls[1].payload.deferShrink).toBe(true);
    expect(document.querySelector<HTMLElement>("[data-surface-stage]")?.style.transitionDuration).toBe("0ms");
    await act(async () => {
      surfaceCalls[1].resolve({ placement: "floating", width: 92, height: 42 });
    });
    await waitFor(() =>
      expect(document.querySelector<HTMLElement>("[data-surface-stage]")?.style.width).toBe("92px"),
    );
    expect(document.querySelector<HTMLElement>("[data-surface-stage]")?.style.transitionDuration).toBe("420ms");
    expect(surfaceCalls).toHaveLength(2);

    const event = new Event("transitionend", { bubbles: true });
    Object.defineProperty(event, "propertyName", { value: "width" });
    await act(async () => {
      document.querySelector("[data-surface-stage]")?.dispatchEvent(event);
    });
    await waitFor(() => expect(surfaceCalls).toHaveLength(3));
    expect(surfaceCalls[2].payload).toMatchObject({ surface: "idle", deferShrink: false });
    await act(async () => {
      surfaceCalls[2].resolve({ placement: "floating", width: 92, height: 42 });
    });
  });

  test("discards an interrupted stage settle when a new target replaces it", async () => {
    const view = render(<SurfaceHarness surface="home" reducedMotion={false} durationMs={420} />);
    await waitFor(() => expect(surfaceCalls).toHaveLength(1));
    await act(async () => {
      surfaceCalls[0].resolve({ placement: "floating", width: 452, height: 148 });
    });
    view.rerender(<SurfaceHarness surface="idle" reducedMotion={false} durationMs={420} />);
    await waitFor(() => expect(surfaceCalls).toHaveLength(2));
    await act(async () => {
      surfaceCalls[1].resolve({ placement: "floating", width: 92, height: 42 });
    });
    await waitFor(() =>
      expect(document.querySelector<HTMLElement>("[data-surface-stage]")?.style.width).toBe("92px"),
    );
    view.rerender(<SurfaceHarness surface="home" reducedMotion={false} durationMs={420} />);
    await waitFor(() => expect(surfaceCalls).toHaveLength(3));

    const stale = new Event("transitionend", { bubbles: true });
    Object.defineProperty(stale, "propertyName", { value: "width" });
    await act(async () => {
      document.querySelector("[data-surface-stage]")?.dispatchEvent(stale);
    });
    expect(surfaceCalls).toHaveLength(3);
    await act(async () => {
      surfaceCalls[2].resolve({ placement: "floating", width: 452, height: 148 });
    });
    await waitFor(() =>
      expect(document.querySelector<HTMLElement>("[data-surface-stage]")?.style.width).toBe("452px"),
    );
  });

  test("keeps the animated window and stage wrappers unpainted", () => {
    const view = render(
      <ShellFrame
        placement="floating"
        gutter={0}
        size={{ width: 92, height: 42 }}
        nativeSize={{ width: 452, height: 148 }}
        morphMs={420}
        stageRef={{ current: null }}
      >
        <main className="rounded-otto-island bg-otto-surface" />
      </ShellFrame>,
    );
    const windowFrame = view.container.querySelector("[data-surface-window]");
    const stage = view.container.querySelector("[data-surface-stage]");
    expect(windowFrame?.classList.contains("bg-otto-surface")).toBe(false);
    expect(stage?.classList.contains("bg-otto-surface")).toBe(false);
    expect(view.container.querySelector("main")?.classList.contains("bg-otto-surface")).toBe(true);
  });

  test("does not reapply unchanged native hit regions and reports a failed update", async () => {
    const queue = createGeometryQueue();
    queue.resume();
    queue.enqueueHit(92, 42, "capsule", () => true);
    await waitFor(() => expect(hitCalls).toHaveLength(1));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    queue.enqueueHit(92.2, 42, "capsule", () => true);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(hitCalls).toHaveLength(1);
    failHitRegion = true;
    let errors = 0;
    queue.enqueueHit(93, 42, "capsule", () => true, () => { errors += 1; });
    await waitFor(() => expect(errors).toBe(1));
    queue.dispose();
  });

  test("retains the newest pending hit region when a surface write supersedes another", async () => {
    const queue = createGeometryQueue();
    queue.resume();
    queue.enqueueSurface({
      request: { surface: "idle", shape: "capsule", topOffset: 20, deferShrink: false },
      isCurrent: () => true,
      apply: () => {},
      report: () => {},
    });
    await waitFor(() => expect(surfaceCalls).toHaveLength(1));

    queue.enqueueHit(452, 148, "capsule", () => true);
    queue.enqueueSurface({
      request: { surface: "home", shape: "capsule", topOffset: 20, deferShrink: true },
      isCurrent: () => true,
      apply: () => {},
      report: () => {},
    });

    await act(async () => {
      surfaceCalls[0].resolve({ placement: "floating", width: 92, height: 42 });
    });
    await waitFor(() => expect(surfaceCalls).toHaveLength(2));
    expect(surfaceCalls[1].payload.surface).toBe("home");

    await act(async () => {
      surfaceCalls[1].resolve({ placement: "floating", width: 452, height: 148 });
    });
    await waitFor(() => expect(hitCalls).toContainEqual({ width: 452, height: 148, shape: "capsule" }));
    queue.dispose();
  });

  test("waits for the native frame before committing the target stage", async () => {
    const view = render(<SurfaceHarness surface="idle" />);

    await waitFor(() => expect(surfaceCalls).toHaveLength(1));
    view.rerender(<SurfaceHarness surface="home" />);
    await waitFor(() => expect(surfaceCalls).toHaveLength(1));
    expect(document.querySelector("[data-surface-stage]")?.getAttribute("style")).not.toContain(
      "width: 452px",
    );

    await act(async () => {
      surfaceCalls[0].resolve({ placement: "floating", width: 92, height: 42 });
    });
    await waitFor(() => expect(surfaceCalls).toHaveLength(2));

    await act(async () => {
      surfaceCalls[1].resolve({ placement: "floating", width: 452, height: 148 });
    });
    await waitFor(() =>
      expect(document.querySelector("[data-surface-stage]")?.getAttribute("style")).toContain(
        "width: 452px",
      ),
    );
  });

  test("queues a rapid page change behind the current native write", async () => {
    const hook = renderHook(({ surface }: { surface: "idle" | "home" }) => useSurface(surface), {
      initialProps: { surface: "idle" },
    });

    await waitFor(() => expect(surfaceCalls).toHaveLength(1));
    hook.rerender({ surface: "home" });

    expect(surfaceCalls).toHaveLength(1);

    await act(async () => {
      surfaceCalls[0].resolve({ placement: "floating", width: 92, height: 42 });
    });
    await waitFor(() => expect(surfaceCalls).toHaveLength(2));
    expect(surfaceCalls[1].payload.surface).toBe("home");

    await act(async () => {
      surfaceCalls[1].resolve({ placement: "floating", width: 452, height: 148 });
    });
    await waitFor(() => expect(hook.result.current.size).toEqual({ width: 452, height: 148 }));
  });

  test("keeps only the newest pending surface after a three-way transition", async () => {
    const hook = renderHook(({ surface }: { surface: "idle" | "home" }) => useSurface(surface), {
      initialProps: { surface: "idle" },
    });

    await waitFor(() => expect(surfaceCalls).toHaveLength(1));
    hook.rerender({ surface: "home" });
    hook.rerender({ surface: "idle" });

    await act(async () => {
      surfaceCalls[0].resolve({ placement: "floating", width: 92, height: 42 });
    });
    await waitFor(() => expect(surfaceCalls).toHaveLength(2));
    expect(surfaceCalls[1].payload.surface).toBe("idle");
  });

  test("does not animate the first measured height", async () => {
    const view = render(
      <SurfaceHarness surface="home" reducedMotion={false} durationMs={420} />,
    );

    await waitFor(() => expect(surfaceCalls).toHaveLength(1));

    view.rerender(
      <SurfaceHarness surface="home" measuredHeight={240} reducedMotion={false} durationMs={420} />,
    );

    await waitFor(() => expect(document.querySelector("[data-surface-stage]")?.getAttribute("style")).toContain("transition-duration: 0ms"));
  });

  test("defers a dynamic surface until its content height is measured", async () => {
    const hook = renderHook(
      ({ surface, measuredHeight }: { surface: "homeSettings"; measuredHeight?: number }) =>
        useSurface(surface, { measuredHeight }),
      { initialProps: { surface: "homeSettings", measuredHeight: undefined } },
    );

    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(surfaceCalls).toHaveLength(0);

    hook.rerender({ surface: "homeSettings", measuredHeight: 286 });
    await waitFor(() => expect(surfaceCalls).toHaveLength(1));
    expect(surfaceCalls[0].payload.surface).toBe("homeSettings");
  });

  test("does not commit a surface before native geometry is confirmed", async () => {
    const hook = renderHook(() => useSurface("home"));

    await waitFor(() => expect(surfaceCalls).toHaveLength(1));
    await act(async () => {
      surfaceCalls[0].resolve({
        placement: "floating",
        width: 452,
        height: 148,
        geometryConfirmed: false,
      });
    });

    expect(hook.result.current.size).toBeNull();
  });

  test("removes outgoing content on its own exit animation and not a nested animation", () => {
    const view = render(
      <TransitionContent transitionKey="home" reducedMotion={false}>
        <div data-frame="home" />
      </TransitionContent>,
    );
    view.rerender(
      <TransitionContent transitionKey="agent" reducedMotion={false}>
        <div data-frame="agent" />
      </TransitionContent>,
    );
    const outgoing = view.container.querySelector<HTMLElement>("[aria-hidden='true']");
    expect(outgoing).not.toBeNull();
    const nested = outgoing?.querySelector<HTMLElement>("[data-frame='home']");
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
        frameSize={{ width: 92, height: 42 }}
      >
        <div data-frame="compact" />
      </TransitionContent>,
    );

    view.rerender(
      <TransitionContent
        transitionKey="home"
        reducedMotion={false}
        frameSize={{ width: 452, height: 148 }}
      >
        <div data-frame="home" />
      </TransitionContent>,
    );

    const outgoing = view.container.querySelector<HTMLElement>("[aria-hidden='true']");
    const incoming = view.container.querySelector<HTMLElement>("[data-frame='home']")?.parentElement;
    expect(outgoing?.style.width).toBe("92px");
    expect(outgoing?.style.height).toBe("42px");
    expect(incoming?.style.width).toBe("452px");
    expect(incoming?.style.height).toBe("148px");
  });
});
