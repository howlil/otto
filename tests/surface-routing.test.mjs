import { describe, expect, test } from "bun:test";
import { resolveSurface, shouldCollapseOnBlur } from "../src/features/shell/surface.ts";

const request = {
  expanded: false,
  isAgent: false,
  isMusic: false,
  page: "home",
  agentSurface: "agentFull",
  osEvent: false,
};

describe("Otto shell surface ownership", () => {
  test("Home compact remains eyes-only even when Agent has a background answer", () => {
    expect(resolveSurface(request)).toBe("idle");
  });

  test("Agent compact uses its own capsule instead of Home eyes", () => {
    expect(resolveSurface({ ...request, page: "agent", isAgent: true })).toBe("agentCompact");
  });

  test("Music owns its compact and player geometry without changing Home focus", () => {
    expect(resolveSurface({ ...request, page: "music", isMusic: true })).toBe("musicCompact");
    expect(
      resolveSurface({ ...request, expanded: true, page: "music", isMusic: true }),
    ).toBe("musicPlayer");
  });

  test("Focus owns compact, timer, and settings native surfaces", () => {
    expect(resolveSurface({ ...request, page: "focus" })).toBe("focusCompact");
    expect(resolveSurface({ ...request, expanded: true, page: "focus" })).toBe("focus");
    expect(resolveSurface({ ...request, expanded: true, page: "focus-settings" })).toBe(
      "focusSettings",
    );
  });

  test("a transient OS event replaces the compact capsule, never an expanded surface", () => {
    expect(resolveSurface({ ...request, osEvent: true })).toBe("osEvent");
    expect(resolveSurface({ ...request, page: "agent", isAgent: true, osEvent: true })).toBe(
      "osEvent",
    );
    expect(resolveSurface({ ...request, expanded: true, osEvent: true })).toBe("home");
    expect(
      resolveSurface({ ...request, expanded: true, page: "agent", isAgent: true, osEvent: true }),
    ).toBe("agentFull");
  });

  test("expanded settings and conversation resolve to their own native bounds", () => {
    expect(resolveSurface({ ...request, expanded: true, page: "global-settings" })).toBe("homeSettings");
    expect(resolveSurface({ ...request, expanded: true, page: "agent-settings", isAgent: true })).toBe("agentSettings");
    expect(resolveSurface({ ...request, expanded: true, page: "agent", isAgent: true })).toBe("agentFull");
  });
});

describe("expanded focus policy", () => {
  test("pinned expanded closes on blur with the default preference", () => {
    expect(shouldCollapseOnBlur("pinned", true)).toBe(true);
  });
  test("Keep Expanded prevents blur collapse, without pinning a hover preview", () => {
    expect(shouldCollapseOnBlur("pinned", false)).toBe(false);
    expect(shouldCollapseOnBlur("preview", true)).toBe(false);
    expect(shouldCollapseOnBlur("preview", false)).toBe(false);
    expect(shouldCollapseOnBlur("compact", true)).toBe(false);
  });
});
