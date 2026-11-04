import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, render, renderHook, waitFor } from "@testing-library/react";

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
      return Promise.resolve(null);
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
});

describe("native surface transition ordering", () => {
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
