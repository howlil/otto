import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ShellContent } from "../src/ShellContent";
import { ShellView } from "../src/AppView";

mock.module("@tauri-apps/api/core", () => ({
  isTauri: () => false,
  invoke: async () => null,
  Channel: class {},
}));

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

afterEach(() => cleanup());

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
    expect(stage?.className).toContain("overflow-hidden");
    expect(stage?.querySelector("main > .inset-0")).toBeTruthy();
    expect(stage?.querySelector("main > .inset-0")?.getAttribute("style")).toBeNull();
    expect(view.getByRole("status")).toBeTruthy();
  });
});
