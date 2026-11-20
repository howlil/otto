import { describe, expect, test } from "bun:test";
import { resolveSurface, shouldCollapseOnBlur } from "../../src/features/shell/model/surface";

const request = {
  expanded: false,
  page: "agent",
  agentSurface: "agentFull",
};

describe("Otto shell surface ownership", () => {
  test("the compact shell always opens the Agent capsule", () => {
    expect(resolveSurface(request)).toBe("agentCompact");
    expect(resolveSurface({ ...request, page: "settings" })).toBe("agentCompact");
  });

  test("one Settings surface and the Agent content use their own native bounds", () => {
    expect(resolveSurface({ ...request, expanded: true, page: "settings" })).toBe("settings");
    expect(resolveSurface({ ...request, expanded: true, page: "agent" })).toBe("agentFull");
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
