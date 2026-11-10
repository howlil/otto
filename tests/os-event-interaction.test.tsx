import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, renderHook } from "@testing-library/react";
import type { OsEventSubscription, OsEventView } from "../src/platform/tauri";
import { ShellContent } from "../src/ShellContent";
import { ShellView } from "../src/AppView";

mock.module("@tauri-apps/api/core", () => ({
  isTauri: () => false,
  invoke: async () => null,
  Channel: class {},
}));

const subscriptions: Array<{
  deliver: (event: OsEventView) => void;
  resolve: (subscription: OsEventSubscription) => void;
}> = [];

mock.module("../src/platform/tauri/os-events", () => ({
  nativeAvailable: true,
  setOsEventsEnabled: async () => {},
  subscribeOsEvents: (deliver: (event: OsEventView) => void) =>
    new Promise<OsEventSubscription>((resolve) => subscriptions.push({ deliver, resolve })),
}));

const { useOsEvents } = await import("../src/features/os-events/useOsEvents");
const agent = {} as Parameters<typeof ShellContent>[0]["agent"];
const music = {} as Parameters<typeof ShellContent>[0]["music"];
const focus = {} as Parameters<typeof ShellContent>[0]["focus"];
const appUpdate = {
  state: { status: "idle" },
  checkForUpdate: async () => {},
  installUpdate: async () => {},
} as Parameters<typeof ShellContent>[0]["appUpdate"];
const preferences = {
  expression: "calm",
  reactive: "quiet",
  placement: "floating",
  hoverExpand: true,
  hoverDelay: 150,
  leaveDelay: 340,
  clickOutside: true,
  hideFromCapture: true,
  osEventsEnabled: true,
  motion: "reduced",
  tilt: 43,
  gradient: 80,
  topOffset: 20,
} as Parameters<typeof ShellContent>[0]["shell"]["prefs"];
const shell = {
  expanded: false,
  pinned: false,
  isAgent: false,
  page: "home",
  reducedMotion: true,
  eventMotion: "",
  prefs: preferences,
  compactButton: { current: null },
  homeGear: { current: null },
  placement: {
    applied: "floating",
    requested: "floating",
    supported: false,
    error: null,
    attempt: 0,
  },
  handleEnter: () => {},
  handleLeave: () => {},
  handleEscape: () => {},
} as Parameters<typeof ShellContent>[0]["shell"];
const event = { class: "volume", id: 1, percent: 68, muted: false } as const;

afterAll(() => mock.restore());
afterEach(() => {
  cleanup();
  subscriptions.length = 0;
});

describe("OS event subscription ownership", () => {
  test("the current subscription shows confirmed events and supports dismissal", async () => {
    const hook = renderHook(() => useOsEvents(true));
    await act(async () => {
      subscriptions[0]?.resolve({ unsubscribe: async () => {} });
      subscriptions[0]?.deliver(event);
    });
    expect(hook.result.current.event).toEqual(event);
    act(() => hook.result.current.dismiss());
    expect(hook.result.current.event).toBeNull();
  });

  test("disabling drops late events and re-enabling accepts only the new subscription", async () => {
    const hook = renderHook(({ enabled }) => useOsEvents(enabled), {
      initialProps: { enabled: true },
    });
    const old = subscriptions[0];
    let released = false;
    hook.rerender({ enabled: false });
    act(() => old?.deliver(event));
    expect(hook.result.current.event).toBeNull();
    hook.rerender({ enabled: true });
    await act(async () => {
      old?.resolve({ unsubscribe: async () => { released = true; } });
      subscriptions[1]?.resolve({ unsubscribe: async () => {} });
    });
    expect(released).toBe(true);
    act(() => old?.deliver(event));
    expect(hook.result.current.event).toBeNull();
    act(() => subscriptions[1]?.deliver({ ...event, id: 2 }));
    expect(hook.result.current.event?.id).toBe(2);
    act(() => old?.deliver(event));
    expect(hook.result.current.event?.id).toBe(2);
  });

  test("unmount releases a subscription whose handshake finishes late", async () => {
    const hook = renderHook(() => useOsEvents(true));
    const old = subscriptions[0];
    let released = false;
    hook.unmount();
    await act(async () => {
      old?.resolve({ unsubscribe: async () => { released = true; } });
    });
    expect(released).toBe(true);
  });
});

describe("OS event surface", () => {
  test("renders the event capsule instead of the compact control", () => {
    const view = render(
      <ShellContent
        agent={agent}
        music={music}
        focus={focus}
        shell={shell}
        agentHomeCopy="Ask your CLI"
        musicHomeCopy="No media session"
        artProps={{ tilt: 43, gradient: 80 }}
        onContentMeasured={() => {}}
        appUpdate={appUpdate}
        osEvent={event}
      />,
    );

    expect(view.getByRole("status").getAttribute("data-os-event")).toBe("volume");
    expect(view.getByText("Volume")).toBeTruthy();
    expect(view.queryByRole("button", { name: "Open Otto" })).toBeNull();
  });

  test("pointer and Escape dismiss the visible event surface", () => {
    const onDismissOsEvent = mock();
    const view = render(
      <ShellView
        agent={agent}
        music={music}
        focus={focus}
        shell={shell as Parameters<typeof ShellView>[0]["shell"]}
        surfaceError={null}
        agentHomeCopy="Ask your CLI"
        musicHomeCopy="No media session"
        artProps={{ tilt: 43, gradient: 80 }}
        gutter={0}
        size={{ width: 92, height: 42 }}
        morphMs={0}
        stageRef={{ current: null }}
        onContentMeasured={() => {}}
        appUpdate={appUpdate as Parameters<typeof ShellView>[0]["appUpdate"]}
        osEvent={event}
        onDismissOsEvent={onDismissOsEvent}
      />,
    );
    const surface = view.container.querySelector("main");
    if (!surface) throw new Error("OS event surface did not render");

    fireEvent.pointerDown(surface);
    fireEvent.keyDown(surface, { key: "Escape" });

    expect(onDismissOsEvent).toHaveBeenCalledTimes(2);
  });

  test("attached placement keeps the full OS event width and shoulder frame", () => {
    const view = render(
      <ShellView
        agent={agent}
        music={music}
        focus={focus}
        shell={{
          ...shell,
          placement: {
            ...shell.placement,
            applied: "attached",
            requested: "attached",
          },
        } as Parameters<typeof ShellView>[0]["shell"]}
        surfaceError={null}
        agentHomeCopy="Ask your CLI"
        musicHomeCopy="No media session"
        artProps={{ tilt: 43, gradient: 80 }}
        gutter={12}
        size={{ width: 234, height: 52 }}
        morphMs={0}
        stageRef={{ current: null }}
        onContentMeasured={() => {}}
        appUpdate={appUpdate as Parameters<typeof ShellView>[0]["appUpdate"]}
        osEvent={event}
        onDismissOsEvent={() => {}}
      />,
    );
    const frame = view.container.querySelector("[data-placement='attached']");
    const surface = view.container.querySelector<HTMLElement>("main");
    const stage = view.container.querySelector<HTMLElement>("[data-surface-stage]");

    expect(frame).toBeTruthy();
    expect(frame?.querySelectorAll(".otto-shoulder-l, .otto-shoulder-r").length).toBe(2);
    expect(stage?.style.width).toBe("234px");
    expect(surface?.style.width).toBe("");
    expect(surface?.classList.contains("w-full")).toBe(true);
    expect(surface?.classList.contains("h-full")).toBe(true);
    expect(surface?.classList.contains("overflow-hidden")).toBe(true);
    expect(stage?.querySelectorAll(".otto-shoulder-l, .otto-shoulder-r")).toHaveLength(2);
    expect(stage?.querySelector("main > .inset-0")).toBeTruthy();
    expect(stage?.querySelector("main > .inset-0")?.getAttribute("style")).toBeNull();
    expect(view.getByRole("status")).toBeTruthy();
  });
});
