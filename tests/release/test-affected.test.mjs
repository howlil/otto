import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  collapseRustFilters,
  collectChangedFiles,
  formatGithubOutputs,
  planAffected,
} from "../../scripts/test-affected.mjs";

const root = resolve(import.meta.dirname, "..", "..");

describe("dynamic affected test planner", () => {
  test("selects nothing when no files changed or only docs changed", () => {
    for (const files of [[], ["README.md", "AGENTS.md", ".agents/product.md", ".agents/DESIGN.md"]]) {
      const plan = planAffected(files, { root });
      expect(plan.frontend).toBe(false);
      expect(plan.frontendCheck).toBe(false);
      expect(plan.frontendBuild).toBe(false);
      expect(plan.frontendAll).toBe(false);
      expect(plan.bunTests).toEqual([]);
      expect(plan.nodeTests).toEqual([]);
      expect(plan.rust).toBe(false);
      expect(plan.rustLint).toBe(false);
      expect(plan.rustAll).toBe(false);
      expect(plan.rustFilters).toEqual([]);
      expect(plan.native).toBe(false);
      expect(plan.nativeSuites).toEqual({ shell: false, transitions: false, p8: false });
    }
  });

  test("budget files run only boundary checks without build, tests, or native gates", () => {
    const plan = planAffected([".agents/frontend-budget.json"], { root });
    expect(plan.frontend).toBe(true);
    expect(plan.frontendCheck).toBe(true);
    expect(plan.frontendBuild).toBe(false);
    expect(plan.bunTests).toEqual([]);
    expect(plan.nodeTests).toEqual([]);
    expect(plan.rust).toBe(false);
    expect(plan.native).toBe(false);
  });

  test("traces an isolated frontend agent module to only dependent tests", () => {
    const plan = planAffected(["src/features/agent/model/draft-state.ts"], { root });
    expect(plan.frontend).toBe(true);
    expect(plan.frontendCheck).toBe(true);
    expect(plan.frontendBuild).toBe(true);
    expect(plan.frontendAll).toBe(false);
    expect(plan.bunTests).toContain("tests/agent/draft-state.test.mjs");
    expect(plan.bunTests).not.toContain("tests/agent/message-markdown.test.mjs");
    expect(plan.bunTests).not.toContain("tests/shell/shell-motion.test.mjs");
    expect(plan.bunTests).not.toContain("tests/release/release-version.test.mjs");
    expect(plan.nodeTests).toEqual([]);
    expect(plan.rust).toBe(false);
    expect(plan.native).toBe(true);
    expect(plan.nativeSuites).toEqual({ shell: false, transitions: false, p8: true });
  });

  test("keeps non-native frontend agent edits off Windows Rust and native E2E runners", () => {
    const plan = planAffected(["src/features/agent/capture/useCaptureSource.ts"], { root });
    expect(plan.frontend).toBe(true);
    expect(plan.bunTests).toContain("tests/agent/agent-capture-source.test.tsx");
    expect(plan.bunTests).not.toContain("tests/shell/shell-motion.test.mjs");
    expect(plan.rust).toBe(false);
    expect(plan.native).toBe(false);
    expect(plan.nativeSuites).toEqual({ shell: false, transitions: false, p8: false });
  });

  test("maps src/style.css across frontend placement test, Rust region token test, and shell E2E only", () => {
    const plan = planAffected(["src/style.css"], { root });
    expect(plan.frontend).toBe(true);
    expect(plan.frontendCheck).toBe(true);
    expect(plan.frontendBuild).toBe(true);
    expect(plan.bunTests).toEqual(["tests/shell/shell-placement.test.mjs"]);
    expect(plan.rust).toBe(true);
    expect(plan.rustLint).toBe(false);
    expect(plan.rustAll).toBe(false);
    expect(plan.rustFilters).toEqual(["platform::windows::region::"]);
    expect(plan.native).toBe(true);
    expect(plan.nativeSuites).toEqual({ shell: true, transitions: true, p8: false });
  });

  test("keeps non-Codex Rust provider edits scoped to that provider without native E2E", () => {
    for (const [file, provider] of [
      ["src-tauri/src/agent/providers/pi/events.rs", "pi"],
      ["src-tauri/src/agent/providers/claude/stream.rs", "claude"],
      ["src-tauri/src/agent/providers/agy/admission.rs", "agy"],
      ["src-tauri/src/agent/providers/opencode/turn.rs", "opencode"],
    ]) {
      const plan = planAffected([file], { root });
      expect(plan.frontend).toBe(false);
      expect(plan.rust).toBe(true);
      expect(plan.rustLint).toBe(true);
      expect(plan.rustAll).toBe(false);
      expect(plan.rustFilters).toEqual([
        `agent::providers::${provider}::`,
        "agent::providers::registry::",
      ]);
      expect(plan.native).toBe(false);
      expect(plan.nativeSuites).toEqual({ shell: false, transitions: false, p8: false });
    }
  });

  test("selects Codex Rust tests and only P8 native E2E for Codex adapter edits", () => {
    const plan = planAffected(["src-tauri/src/agent/providers/codex/turn.rs"], { root });
    expect(plan.frontend).toBe(false);
    expect(plan.rust).toBe(true);
    expect(plan.rustLint).toBe(true);
    expect(plan.rustAll).toBe(false);
    expect(plan.rustFilters).toEqual([
      "agent::providers::codex::",
      "agent::providers::registry::",
    ]);
    expect(plan.native).toBe(true);
    expect(plan.nativeSuites).toEqual({ shell: false, transitions: false, p8: true });
  });

  test("selects only capture Rust tests without native E2E for Windows capture edits", () => {
    const plan = planAffected(["src-tauri/src/platform/windows/capture/scroll.rs"], { root });
    expect(plan.frontend).toBe(false);
    expect(plan.rust).toBe(true);
    expect(plan.rustLint).toBe(true);
    expect(plan.rustAll).toBe(false);
    expect(plan.rustFilters).toEqual(["platform::windows::capture::"]);
    expect(plan.native).toBe(false);
  });

  test("selects shell Rust tests and shell/transitions native E2E without P8 for shell sizing edits", () => {
    const plan = planAffected(["src-tauri/src/shell/sizing.rs"], { root });
    expect(plan.frontend).toBe(false);
    expect(plan.rust).toBe(true);
    expect(plan.rustLint).toBe(true);
    expect(plan.rustFilters).toEqual(["shell::sizing::"]);
    expect(plan.native).toBe(true);
    expect(plan.nativeSuites).toEqual({ shell: true, transitions: true, p8: false });
  });

  test("runs only the edited test file when a test file changes directly", () => {
    const bunPlan = planAffected(["tests/agent/draft-state.test.mjs"], { root });
    expect(bunPlan.frontend).toBe(true);
    expect(bunPlan.frontendCheck).toBe(false);
    expect(bunPlan.frontendBuild).toBe(false);
    expect(bunPlan.bunTests).toEqual(["tests/agent/draft-state.test.mjs"]);
    expect(bunPlan.nodeTests).toEqual([]);
    expect(bunPlan.rust).toBe(false);
    expect(bunPlan.native).toBe(false);

    const nodePlan = planAffected(["tests/e2e/codex-fixture.test.mjs"], { root });
    expect(nodePlan.frontend).toBe(true);
    expect(nodePlan.frontendCheck).toBe(false);
    expect(nodePlan.frontendBuild).toBe(false);
    expect(nodePlan.bunTests).toEqual([]);
    expect(nodePlan.nodeTests).toEqual(["tests/e2e/codex-fixture.test.mjs"]);
    expect(nodePlan.rust).toBe(false);
    expect(nodePlan.native).toBe(false);
  });

  test("traces release scripts and release workflow to release contract tests only", () => {
    const scriptPlan = planAffected(["scripts/release-version.mjs"], { root });
    expect(scriptPlan.frontend).toBe(true);
    expect(scriptPlan.frontendCheck).toBe(false);
    expect(scriptPlan.frontendBuild).toBe(false);
    expect(scriptPlan.bunTests).toEqual([
      "tests/release/release-manifest.test.mjs",
      "tests/release/release-version.test.mjs",
    ]);
    expect(scriptPlan.rust).toBe(false);
    expect(scriptPlan.native).toBe(false);

    const workflowPlan = planAffected([".github/workflows/release.yml"], { root });
    expect(workflowPlan.frontend).toBe(true);
    expect(workflowPlan.bunTests).toEqual(["tests/release/release-manifest.test.mjs"]);
    expect(workflowPlan.rust).toBe(false);
    expect(workflowPlan.native).toBe(false);
  });

  test("maps tauri.conf.json to release tests, Rust overlay test, and native E2E", () => {
    const plan = planAffected(["src-tauri/tauri.conf.json"], { root });
    expect(plan.frontend).toBe(true);
    expect(plan.frontendCheck).toBe(false);
    expect(plan.frontendBuild).toBe(false);
    expect(plan.bunTests).toEqual([
      "tests/release/preflight.test.mjs",
      "tests/release/release-manifest.test.mjs",
      "tests/release/release-version.test.mjs",
    ]);
    expect(plan.rust).toBe(true);
    expect(plan.rustLint).toBe(false);
    expect(plan.rustFilters).toEqual(["platform::windows::overlay::"]);
    expect(plan.native).toBe(true);
    expect(plan.nativeSuites).toEqual({ shell: true, transitions: true, p8: true });
  });

  test("falls back to feature tests for deleted source files and ignores deleted test files", () => {
    const deletedSource = planAffected(["src/features/shell/model/removed-file.ts"], { root });
    expect(deletedSource.frontend).toBe(true);
    expect(deletedSource.bunTests).toContain("tests/shell/shell-motion.test.mjs");
    expect(deletedSource.bunTests).not.toContain("tests/agent/draft-state.test.mjs");

    const deletedTest = planAffected(["tests/agent/removed.test.mjs"], { root });
    expect(deletedTest.bunTests).toEqual([]);
    expect(deletedTest.nodeTests).toEqual([]);
  });

  test("collapses redundant nested Rust test filters", () => {
    expect(
      collapseRustFilters([
        "agent::providers::pi::",
        "agent::",
        "shell::sizing::",
        "agent::tests::",
        "shell::",
      ]),
    ).toEqual(["agent::", "shell::"]);
  });

  test("escalates to full verification for full mode, CI workflow edits, or selector edits", () => {
    for (const plan of [
      planAffected([], { root, full: true }),
      planAffected([".github/workflows/otto-verify-once.yml"], { root }),
      planAffected(["scripts/test-affected.mjs"], { root }),
    ]) {
      expect(plan.frontend).toBe(true);
      expect(plan.frontendCheck).toBe(true);
      expect(plan.frontendBuild).toBe(true);
      expect(plan.frontendAll).toBe(true);
      expect(plan.bunTests.length).toBeGreaterThan(10);
      expect(plan.nodeTests).toEqual(["tests/e2e/codex-fixture.test.mjs"]);
      expect(plan.rust).toBe(true);
      expect(plan.rustLint).toBe(true);
      expect(plan.rustAll).toBe(true);
      expect(plan.native).toBe(true);
      expect(plan.nativeSuites).toEqual({ shell: true, transitions: true, p8: true });
    }
  });

  test("fails closed when an explicit --base ref cannot be diffed", () => {
    expect(() => collectChangedFiles(root, { base: "refs/heads/nonexistent-otto-base" })).toThrow(
      "Unable to compute git diff",
    );
  });

  test("serializes every GitHub Actions output referenced by Otto CI", () => {
    const workflow = readFileSync(join(root, ".github/workflows/otto-verify-once.yml"), "utf8");
    const plan = planAffected(["src-tauri/src/shell/sizing.rs"], { root });
    const serialized = formatGithubOutputs(plan);
    const keys = serialized
      .trim()
      .split("\n")
      .map((line) => line.split("=")[0]);
    const referenced = new Set(
      Array.from(workflow.matchAll(/steps\.filter\.outputs\.([a-z0-9_]+)/g), (match) => match[1]),
    );
    expect(referenced.size).toBeGreaterThan(5);
    for (const key of referenced) {
      expect(keys).toContain(key);
    }
  });
});
