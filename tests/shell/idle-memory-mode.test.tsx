import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, renderHook, waitFor } from "@testing-library/react";

const memoryCalls: boolean[] = [];

mock.module("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: async (command: string, payload: unknown) => {
    if (command === "overlay_set_memory_mode") {
      memoryCalls.push((payload as { low: boolean }).low);
    }
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

const { useIdleMemoryMode } = await import("../../src/features/shell/hooks/useIdleMemoryMode");

afterEach(() => {
  cleanup();
  memoryCalls.length = 0;
});

afterAll(() => {
  mock.restore();
});

describe("useIdleMemoryMode", () => {
  test("enters low memory mode after idle delay and restores immediately when active", async () => {
    const { rerender } = renderHook(({ active }) => useIdleMemoryMode(active, 25), {
      initialProps: { active: true },
    });

    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(memoryCalls).toEqual([]);

    rerender({ active: false });
    await waitFor(() => expect(memoryCalls).toEqual([true]), { timeout: 500 });

    rerender({ active: true });
    await waitFor(() => expect(memoryCalls).toEqual([true, false]), { timeout: 500 });
  });

  test("cancels pending low memory transition when reactivated before delay", async () => {
    const { rerender } = renderHook(({ active }) => useIdleMemoryMode(active, 45), {
      initialProps: { active: false },
    });

    await new Promise((resolve) => setTimeout(resolve, 15));
    rerender({ active: true });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(memoryCalls).toEqual([]);
  });
});
