import { describe, expect, test } from "bun:test";
import { resolveSurface } from "../src/features/shell/surface.ts";

const request = {
  expanded: false,
  isAgent: false,
  page: "home",
  agentSurface: "agentFull",
};

describe("Otto shell surface ownership", () => {
  test("Home compact remains eyes-only even when Agent has a background answer", () => {
    expect(resolveSurface(request)).toBe("idle");
  });

  test("Agent compact uses its own capsule instead of Home eyes", () => {
    expect(resolveSurface({ ...request, page: "agent", isAgent: true })).toBe("agentCompact");
  });

  test("expanded settings and conversation resolve to their own native bounds", () => {
    expect(resolveSurface({ ...request, expanded: true, page: "global-settings" })).toBe("homeSettings");
    expect(resolveSurface({ ...request, expanded: true, page: "agent-settings", isAgent: true })).toBe("agentSettings");
    expect(resolveSurface({ ...request, expanded: true, page: "agent", isAgent: true })).toBe("agentFull");
  });
});
