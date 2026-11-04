import { describe, expect, test } from "bun:test";
import { evaluatePreflight, formatBlockers, majorMinor } from "./e2e/preflight.mjs";

const healthy = {
  platform: "win32",
  appPath: "C:/otto/src-tauri/target/debug/otto.exe",
  distPath: "C:/otto/dist",
  appExists: true,
  appMtimeMs: 2_000,
  sourceMtimeMs: 1_000,
  distExists: true,
  tauriDriver: "tauri-driver 2.0.6",
  webviewVersion: "130.0.2849.68",
  edgeDriverVersion: "Microsoft Edge WebDriver 130.0.2849.68 (abcdef)",
  running: [],
  driver: [],
  busyPorts: [],
};

const evaluate = (overrides = {}) => evaluatePreflight({ ...healthy, ...overrides });

describe("Native E2E preflight", () => {
  test("a machine with every precondition satisfied has no blockers", () => {
    expect(evaluate()).toEqual([]);
  });

  test("a missing debug executable names the build command", () => {
    const blockers = evaluate({ appExists: false, appMtimeMs: 0 });
    expect(blockers.length).toBe(1);
    expect(blockers[0]).toContain("tauri build --debug --no-bundle");
  });

  test("a debug executable older than the Rust sources is stale, not usable", () => {
    const blockers = evaluate({ appMtimeMs: 900, sourceMtimeMs: 1_000 });
    expect(blockers.length).toBe(1);
    expect(blockers[0]).toContain("older than src-tauri sources");
  });

  test("a missing frontend bundle and missing driver are both reported", () => {
    const blockers = evaluate({ distExists: false, tauriDriver: null });
    expect(blockers.length).toBe(2);
    expect(blockers[0]).toContain("bun run build");
    expect(blockers[1]).toContain("cargo install tauri-driver --version 2.0.6");
  });

  test("a driver for another WebView2 build blocks, a patch difference does not", () => {
    expect(
      evaluate({ edgeDriverVersion: "Microsoft Edge WebDriver 129.0.2792.89 (old)" }),
    ).toHaveLength(1);
    expect(
      evaluate({ edgeDriverVersion: "Microsoft Edge WebDriver 130.0.2903.86 (newer patch)" }),
    ).toEqual([]);
  });

  test("a missing WebDriver binary reports the WebView2 version to download", () => {
    const blockers = evaluate({ edgeDriverVersion: null });
    expect(blockers.length).toBe(1);
    expect(blockers[0]).toContain("130.0.2849.68");
  });

  test("an already running Otto would swallow the WebDriver session", () => {
    const blockers = evaluate({ running: ["4321"] });
    expect(blockers.length).toBe(1);
    expect(blockers[0]).toContain("4321");
    expect(blockers[0]).toContain("single-instance");
  });

  test("a stale driver process holding the WebDriver ports is reported", () => {
    const blockers = evaluate({ busyPorts: [4540, 4541] });
    expect(blockers.length).toBe(1);
    expect(blockers[0]).toContain("4540");
    expect(blockers[0]).toContain("4541");
  });

  test("every blocker is listed in a stable numbered order", () => {
    const blockers = evaluate({
      appExists: false,
      distExists: false,
      tauriDriver: null,
      edgeDriverVersion: null,
      running: ["7"],
      busyPorts: [4540],
    });
    expect(blockers.length).toBe(6);
    expect(formatBlockers(blockers).split("\n")[0].startsWith("1. ")).toBe(true);
    expect(formatBlockers(blockers)).toContain("6. ");
  });

  test("a non-Windows host cannot run the native suite", () => {
    const blockers = evaluate({ platform: "linux" });
    expect(blockers).toEqual([expect.stringContaining("requires Windows")]);
  });

  test("version parsing keeps major.minor and ignores patch", () => {
    expect(majorMinor("Microsoft Edge WebDriver 130.0.2849.68 (x)")).toBe("130.0");
    expect(majorMinor(null)).toBeNull();
  });
});
