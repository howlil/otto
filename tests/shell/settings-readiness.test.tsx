import { afterEach, expect, test } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useShellInteraction } from "../../src/features/shell/hooks/useShellInteraction";
import { defaults } from "../../src/features/shell/model/preferences";

afterEach(cleanup);

test("the Settings page keeps the Agent active so provider readiness and image support stay live", () => {
  const { result } = renderHook(() => useShellInteraction({ prefs: defaults }));
  expect(result.current.isAgent).toBe(true);
  act(() => result.current.openSettings("capture"));
  expect(result.current.page).toBe("settings");
  expect(result.current.settingsTab).toBe("capture");
  expect(result.current.isAgent).toBe(true);
});
