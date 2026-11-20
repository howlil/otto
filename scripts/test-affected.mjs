import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const CODE_EXTENSIONS = [".ts", ".tsx", ".mjs", ".js", ".mts", ".cjs"];
const RESOLVE_EXTENSIONS = [...CODE_EXTENSIONS, ".json", ".css"];
const INDEX_FILES = ["index.ts", "index.tsx", "index.mjs", "index.js"];
const TEST_FILE_PATTERN = /\.test\.(?:mjs|ts|tsx|js)$/;

const FULL_ALL_FILES = new Set([
  ".github/workflows/otto-verify-once.yml",
  "scripts/test-affected.mjs",
]);

const FRONTEND_ALL_FILES = new Set([
  "package.json",
  "bun.lock",
  "bunfig.toml",
  "vite.config.ts",
  "biome.json",
  "index.html",
]);

const FRONTEND_CHECK_FILES = new Set([
  "package.json",
  "bun.lock",
  "vite.config.ts",
  "biome.json",
  "scripts/frontend-rules.mjs",
  "scripts/rust-boundaries.mjs",
  ".agents/frontend-budget.json",
  ".agents/rust-budget.json",
]);

const FRONTEND_BUILD_FILES = new Set([
  "package.json",
  "bun.lock",
  "vite.config.ts",
  "index.html",
]);

const RUST_ALL_FILES = new Set([
  "src-tauri/Cargo.toml",
  "src-tauri/Cargo.lock",
  "src-tauri/build.rs",
  "src-tauri/src/lib.rs",
  "src-tauri/src/main.rs",
]);

const NATIVE_ALL_FILES = new Set([
  "package.json",
  "bun.lock",
  "vite.config.ts",
  "index.html",
  "src/main.tsx",
  "src-tauri/Cargo.toml",
  "src-tauri/Cargo.lock",
  "src-tauri/build.rs",
  "src-tauri/tauri.conf.json",
  "src-tauri/src/lib.rs",
  "src-tauri/src/main.rs",
  "src-tauri/src/ipc/mod.rs",
  "tests/e2e/preflight.mjs",
]);

const NATIVE_SHELL_EXACT = new Set([
  "src/style.css",
  "src/platform/tauri/index.ts",
  "src/platform/tauri/runtime.ts",
  "src/platform/tauri/shell.ts",
  "src/platform/tauri/overlay.ts",
  "src/platform/tauri/shell-shortcut.ts",
  "src-tauri/src/ipc/notch.rs",
  "src-tauri/src/ipc/overlay.rs",
  "src-tauri/src/ipc/shell_shortcut.rs",
  "src-tauri/src/ipc/app.rs",
  "src-tauri/src/platform/mod.rs",
  "src-tauri/src/platform/windows/mod.rs",
  "src-tauri/src/platform/windows/overlay.rs",
  "src-tauri/src/platform/windows/region.rs",
  "src-tauri/src/platform/windows/shell_shortcut.rs",
  "src-tauri/src/platform/windows/single_instance.rs",
  "tests/e2e/shell-native.ps1",
]);

const NATIVE_TRANSITIONS_EXACT = new Set([
  "src/style.css",
  "src/platform/tauri/index.ts",
  "src/platform/tauri/runtime.ts",
  "src/platform/tauri/shell.ts",
  "src/platform/tauri/overlay.ts",
  "src/features/agent/settings/AgentSettings.tsx",
  "src/features/agent/settings/AgentSettingsNavigation.tsx",
  "src/shared/ui/TransitionContent.tsx",
  "src/shared/ui/OttoLogo.tsx",
  "src/shared/ui/ActiveIndicatorGroup.tsx",
  "src-tauri/src/ipc/notch.rs",
  "src-tauri/src/ipc/overlay.rs",
  "src-tauri/src/platform/mod.rs",
  "src-tauri/src/platform/windows/mod.rs",
  "src-tauri/src/platform/windows/overlay.rs",
  "src-tauri/src/platform/windows/region.rs",
  "tests/e2e/transitions-native.mjs",
  "tests/e2e/shell-native.ps1",
  "tests/e2e/visual-capture.mjs",
]);

const NATIVE_P8_EXACT = new Set([
  "src/platform/tauri/index.ts",
  "src/platform/tauri/runtime.ts",
  "src/platform/tauri/agent.ts",
  "src/features/agent/index.ts",
  "src-tauri/src/ipc/agent.rs",
  "src-tauri/src/ipc/app.rs",
  "src-tauri/src/agent/mod.rs",
  "src-tauri/src/agent/model.rs",
  "src-tauri/src/agent/events.rs",
  "src-tauri/src/agent/error.rs",
  "src-tauri/src/agent/providers/mod.rs",
  "src-tauri/src/agent/providers/catalog.rs",
  "src-tauri/src/agent/providers/registry.rs",
  "src-tauri/src/agent/providers/support/mod.rs",
  "src-tauri/src/agent/providers/support/authentication.rs",
  "tests/e2e/p8-native.mjs",
  "tests/e2e/codex-fixture.mjs",
  "tests/e2e/bin/codex.cmd",
]);

function normalizePath(filePath) {
  return String(filePath ?? "")
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\.\//, "");
}

function walkFiles(dir, root, output = []) {
  if (!existsSync(dir)) return output;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, root, output);
    } else {
      output.push(relative(root, fullPath).split(sep).join("/"));
    }
  }
  return output;
}

function isCodeFile(relPath) {
  return CODE_EXTENSIONS.some((ext) => relPath.endsWith(ext));
}

function resolveCandidate(basePath, root, existsCache) {
  const tryFile = (candidate) => {
    let found = existsCache.get(candidate);
    if (found === undefined) {
      found = existsSync(candidate) && statSync(candidate).isFile();
      existsCache.set(candidate, found);
    }
    if (!found) return null;
    return relative(root, candidate).split(sep).join("/");
  };
  const exact = tryFile(basePath);
  if (exact) return exact;
  for (const ext of RESOLVE_EXTENSIONS) {
    const withExt = tryFile(`${basePath}${ext}`);
    if (withExt) return withExt;
  }
  for (const indexFile of INDEX_FILES) {
    const nested = tryFile(join(basePath, indexFile));
    if (nested) return nested;
  }
  return null;
}

function resolveRelativeSpecifier(fromFile, specifier, root, existsCache) {
  if (!specifier.startsWith(".")) return null;
  return resolveCandidate(resolve(dirname(join(root, fromFile)), specifier), root, existsCache);
}

function parseNamedBindings(block) {
  const names = [];
  for (const rawPart of block.split(",")) {
    const part = rawPart.trim();
    if (!part || part.startsWith("type ")) continue;
    const [imported] = part.split(/\s+as\s+/);
    const cleaned = imported.trim();
    if (cleaned) names.push(cleaned);
  }
  return names;
}

function parseBarrelExports(source, filePath, root, existsCache) {
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").trim();
  if (!stripped) return null;
  const statements = stripped
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
  if (statements.length === 0) return null;
  const named = new Map();
  const wildcards = [];
  for (const statement of statements) {
    const starMatch = /^export\s+\*\s+from\s+["']([^"']+)["']$/.exec(statement);
    if (starMatch) {
      const target = resolveRelativeSpecifier(filePath, starMatch[1], root, existsCache);
      if (target) wildcards.push(target);
      continue;
    }
    const namedMatch = /^export\s+(type\s+)?\{([\s\S]+?)\}\s+from\s+["']([^"']+)["']$/.exec(
      statement,
    );
    if (!namedMatch) return null;
    const isAllType = Boolean(namedMatch[1]);
    const target = resolveRelativeSpecifier(filePath, namedMatch[3], root, existsCache);
    if (!target || isAllType) continue;
    for (const rawPart of namedMatch[2].split(",")) {
      const part = rawPart.trim();
      if (!part || part.startsWith("type ")) continue;
      const pieces = part.split(/\s+as\s+/);
      const exportedName = (pieces[1] ?? pieces[0]).trim();
      if (exportedName) named.set(exportedName, target);
    }
  }
  return { named, wildcards };
}

function extractDeclaredExports(source) {
  const exported = new Set();
  const declPattern =
    /\bexport\s+(?:async\s+)?(?:function|const|let|var|class|enum)\s+([A-Za-z0-9_$]+)/g;
  for (const match of source.matchAll(declPattern)) {
    exported.add(match[1]);
  }
  const listPattern = /\bexport\s+\{([\s\S]*?)\}(?!\s*from\b)/g;
  for (const match of source.matchAll(listPattern)) {
    for (const rawPart of match[1].split(",")) {
      const part = rawPart.trim();
      if (!part || part.startsWith("type ")) continue;
      const pieces = part.split(/\s+as\s+/);
      const name = (pieces[1] ?? pieces[0]).trim();
      if (name) exported.add(name);
    }
  }
  return exported;
}

function extractFileDependencies(filePath, source, root, barrels, exportCache, existsCache) {
  const dependencies = new Set();
  const addTarget = (target, symbols = null) => {
    if (!target) return;
    dependencies.add(target);
    const barrel = barrels.get(target);
    if (!barrel) return;
    if (!symbols || symbols.length === 0) {
      for (const subTarget of barrel.named.values()) dependencies.add(subTarget);
      for (const wildTarget of barrel.wildcards) dependencies.add(wildTarget);
      return;
    }
    let matchedAny = false;
    for (const symbol of symbols) {
      const direct = barrel.named.get(symbol);
      if (direct) {
        dependencies.add(direct);
        matchedAny = true;
        continue;
      }
      for (const wildTarget of barrel.wildcards) {
        const wildExports = exportCache.get(wildTarget);
        if (wildExports?.has(symbol)) {
          dependencies.add(wildTarget);
          matchedAny = true;
        }
      }
    }
    if (!matchedAny) {
      for (const subTarget of barrel.named.values()) dependencies.add(subTarget);
      for (const wildTarget of barrel.wildcards) dependencies.add(wildTarget);
    }
  };

  const staticImport =
    /\bimport\s+(type\s+)?([\s\S]*?)\s+from\s+["']([^"']+)["']/g;
  for (const match of source.matchAll(staticImport)) {
    if (match[1]) continue;
    const clause = match[2].trim();
    const target = resolveRelativeSpecifier(filePath, match[3], root, existsCache);
    if (!target) continue;
    const braced = /^\{([\s\S]*?)\}$/.exec(clause);
    if (braced) {
      const symbols = parseNamedBindings(braced[1]);
      if (symbols.length > 0) addTarget(target, symbols);
    } else {
      addTarget(target);
    }
  }

  const sideEffectImport = /(?:^|[;\n])\s*import\s+["']([^"']+)["']/g;
  for (const match of source.matchAll(sideEffectImport)) {
    addTarget(resolveRelativeSpecifier(filePath, match[1], root, existsCache));
  }

  const reExport = /\bexport\s+(type\s+)?(\*|\{[\s\S]*?\})\s+from\s+["']([^"']+)["']/g;
  for (const match of source.matchAll(reExport)) {
    if (match[1]) continue;
    const target = resolveRelativeSpecifier(filePath, match[3], root, existsCache);
    if (!target) continue;
    if (match[2] === "*") {
      addTarget(target);
    } else {
      const symbols = parseNamedBindings(match[2].slice(1, -1));
      if (symbols.length > 0) addTarget(target, symbols);
    }
  }

  const dynamicImport = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const match of source.matchAll(dynamicImport)) {
    const target = resolveRelativeSpecifier(filePath, match[1], root, existsCache);
    if (!target) continue;
    const preceding = source.slice(Math.max(0, match.index - 180), match.index);
    const destructured = /const\s+\{([\s\S]*?)\}\s*=\s*await\s*$/.exec(preceding);
    if (destructured) {
      const symbols = parseNamedBindings(destructured[1]);
      addTarget(target, symbols.length > 0 ? symbols : null);
    } else {
      addTarget(target);
    }
  }

  const mockModule = /\bmock\.module\s*\(\s*["']([^"']+)["']/g;
  for (const match of source.matchAll(mockModule)) {
    addTarget(resolveRelativeSpecifier(filePath, match[1], root, existsCache));
  }

  const urlRead = /\bnew\s+URL\s*\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*\)/g;
  for (const match of source.matchAll(urlRead)) {
    addTarget(resolveRelativeSpecifier(filePath, match[1], root, existsCache));
  }

  const joinRoot = /\bjoin\s*\(\s*root\s*,\s*["']([^"']+)["']\s*\)/g;
  for (const match of source.matchAll(joinRoot)) {
    addTarget(resolveCandidate(join(root, match[1]), root, existsCache));
  }

  const joinDirname = /\bjoin\s*\(\s*import\.meta\.dirname\s*,\s*["']([^"']+)["']\s*\)/g;
  for (const match of source.matchAll(joinDirname)) {
    addTarget(resolveCandidate(join(dirname(join(root, filePath)), match[1]), root, existsCache));
  }

  return dependencies;
}

function buildFrontendGraph(root) {
  const walkedFiles = [
    ...walkFiles(join(root, "src"), root),
    ...walkFiles(join(root, "scripts"), root),
    ...walkFiles(join(root, "tests"), root),
  ];
  const existsCache = new Map();
  for (const file of walkedFiles) existsCache.set(join(root, file), true);
  const codeFiles = walkedFiles.filter(isCodeFile);

  const sources = new Map();
  const barrels = new Map();
  const exportCache = new Map();
  const allTests = [];

  for (const file of codeFiles) {
    const content = readFileSync(join(root, file), "utf8");
    sources.set(file, content);
    exportCache.set(file, extractDeclaredExports(content));
    const barrel = parseBarrelExports(content, file, root, existsCache);
    if (barrel) barrels.set(file, barrel);
    if (file.startsWith("tests/") && TEST_FILE_PATTERN.test(file)) {
      const runner = /\bfrom\s+["']node:test["']/.test(content) ? "node" : "bun";
      allTests.push({ file, runner });
    }
  }

  const reverseDeps = new Map();
  const addReverse = (dep, importer) => {
    let set = reverseDeps.get(dep);
    if (!set) {
      set = new Set();
      reverseDeps.set(dep, set);
    }
    set.add(importer);
  };

  for (const [file, content] of sources.entries()) {
    if (barrels.has(file)) continue;
    for (const dep of extractFileDependencies(
      file,
      content,
      root,
      barrels,
      exportCache,
      existsCache,
    )) {
      addReverse(dep, file);
    }
  }

  allTests.sort((a, b) => a.file.localeCompare(b.file));
  return { allTests, reverseDeps, barrels };
}

function collectDependentTests(seedFiles, graph) {
  const testMap = new Map(graph.allTests.map((entry) => [entry.file, entry.runner]));
  const visited = new Set();
  const queue = [...seedFiles];
  const matched = new Set();

  while (queue.length > 0) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);
    if (testMap.has(current)) matched.add(current);
    const dependents = graph.reverseDeps.get(current);
    if (!dependents) continue;
    for (const dependent of dependents) {
      if (!visited.has(dependent)) queue.push(dependent);
    }
  }

  return matched;
}

export function collapseRustFilters(filters) {
  const unique = Array.from(new Set(filters.filter(Boolean))).sort();
  return unique.filter(
    (candidate) =>
      !unique.some((other) => other !== candidate && candidate.startsWith(other)),
  );
}

function classifyRustFile(file) {
  if (RUST_ALL_FILES.has(file)) return { rustAll: true, rustLint: true, filters: [] };
  if (file === "src-tauri/tauri.conf.json") {
    return { rustAll: false, rustLint: false, filters: ["platform::windows::overlay::"] };
  }
  if (file === "src/style.css") {
    return { rustAll: false, rustLint: false, filters: ["platform::windows::region::"] };
  }
  if (!file.startsWith("src-tauri/src/") || !file.endsWith(".rs")) {
    return null;
  }

  const rel = file.slice("src-tauri/src/".length);

  if (rel === "shell/geometry.rs" || rel === "shell/mod.rs") {
    return { rustAll: false, rustLint: true, filters: ["shell::", "platform::windows::region::"] };
  }
  if (rel === "shell/notch.rs") {
    return { rustAll: false, rustLint: true, filters: ["shell::notch::"] };
  }
  if (rel === "shell/sizing.rs") {
    return { rustAll: false, rustLint: true, filters: ["shell::sizing::"] };
  }
  if (rel.startsWith("shell/")) {
    return { rustAll: false, rustLint: true, filters: ["shell::"] };
  }

  if (rel.startsWith("platform/macos/")) {
    return { rustAll: false, rustLint: true, filters: ["shell::sizing::"] };
  }
  if (rel.startsWith("platform/windows/capture/")) {
    return { rustAll: false, rustLint: true, filters: ["platform::windows::capture::"] };
  }
  if (rel === "platform/windows/overlay.rs") {
    return { rustAll: false, rustLint: true, filters: ["platform::windows::overlay::"] };
  }
  if (rel === "platform/windows/region.rs") {
    return { rustAll: false, rustLint: true, filters: ["platform::windows::region::"] };
  }
  if (rel === "platform/windows/shell_shortcut.rs") {
    return { rustAll: false, rustLint: true, filters: ["platform::windows::shell_shortcut::"] };
  }
  if (rel === "platform/windows/single_instance.rs") {
    return { rustAll: false, rustLint: true, filters: ["platform::windows::single_instance::"] };
  }
  if (rel.startsWith("platform/")) {
    return { rustAll: false, rustLint: true, filters: ["platform::windows::"] };
  }

  if (rel === "ipc/notch.rs") {
    return { rustAll: false, rustLint: true, filters: ["shell::", "platform::windows::region::"] };
  }
  if (rel === "ipc/overlay.rs") {
    return { rustAll: false, rustLint: true, filters: ["platform::windows::overlay::"] };
  }
  if (rel === "ipc/shell_shortcut.rs") {
    return { rustAll: false, rustLint: true, filters: ["platform::windows::shell_shortcut::"] };
  }
  if (rel === "ipc/agent.rs" || rel === "ipc/app.rs") {
    return { rustAll: false, rustLint: true, filters: ["agent::tests::"] };
  }
  if (rel === "ipc/agent_capture.rs") {
    return {
      rustAll: false,
      rustLint: true,
      filters: ["agent::tests::", "platform::windows::capture::"],
    };
  }
  if (rel.startsWith("ipc/")) {
    return {
      rustAll: false,
      rustLint: true,
      filters: ["agent::tests::", "shell::", "platform::windows::"],
    };
  }

  if (rel.startsWith("agent/providers/tests/")) {
    return { rustAll: false, rustLint: true, filters: ["agent::providers::tests::"] };
  }
  if (rel.startsWith("agent/providers/process/")) {
    return { rustAll: false, rustLint: true, filters: ["agent::providers::"] };
  }
  if (rel === "agent/providers/support/capture_image.rs") {
    return {
      rustAll: false,
      rustLint: true,
      filters: [
        "agent::providers::support::capture_image::",
        "agent::providers::agy::",
        "agent::providers::pi::",
      ],
    };
  }
  if (rel.startsWith("agent/providers/support/")) {
    return { rustAll: false, rustLint: true, filters: ["agent::providers::"] };
  }
  if (
    rel === "agent/providers/mod.rs" ||
    rel === "agent/providers/catalog.rs" ||
    rel === "agent/providers/registry.rs"
  ) {
    return {
      rustAll: false,
      rustLint: true,
      filters: ["agent::providers::", "agent::tests::"],
    };
  }
  const providerMatch = /^agent\/providers\/([^/]+)\//.exec(rel);
  if (providerMatch) {
    return {
      rustAll: false,
      rustLint: true,
      filters: [`agent::providers::${providerMatch[1]}::`, "agent::providers::registry::"],
    };
  }

  if (rel.startsWith("agent/conversation/")) {
    return {
      rustAll: false,
      rustLint: true,
      filters: ["agent::conversation::", "agent::events::", "agent::tests::"],
    };
  }
  if (rel === "agent/runtime/capture.rs") {
    return { rustAll: false, rustLint: true, filters: ["agent::tests::"] };
  }
  if (rel === "agent/runtime/readiness_probe.rs") {
    return {
      rustAll: false,
      rustLint: true,
      filters: ["agent::runtime::readiness_probe::", "agent::tests::"],
    };
  }
  if (rel === "agent/runtime/recovery.rs") {
    return {
      rustAll: false,
      rustLint: true,
      filters: ["agent::runtime::recovery::", "agent::tests::"],
    };
  }
  if (rel.startsWith("agent/runtime/")) {
    return { rustAll: false, rustLint: true, filters: ["agent::runtime::", "agent::tests::"] };
  }
  if (rel === "agent/error.rs") {
    return {
      rustAll: false,
      rustLint: true,
      filters: ["agent::error::", "agent::events::", "agent::conversation::", "agent::tests::"],
    };
  }
  if (rel === "agent/events.rs") {
    return { rustAll: false, rustLint: true, filters: ["agent::events::", "agent::tests::"] };
  }
  if (rel === "agent/tests/measurements.rs") {
    return { rustAll: false, rustLint: true, filters: ["agent::tests::measurements::"] };
  }
  if (rel === "agent/tests/runtime.rs") {
    return { rustAll: false, rustLint: true, filters: ["agent::tests::runtime_tests::"] };
  }
  if (rel === "agent/tests.rs") {
    return { rustAll: false, rustLint: true, filters: ["agent::tests::"] };
  }
  if (rel.startsWith("agent/")) {
    return { rustAll: false, rustLint: true, filters: ["agent::"] };
  }

  return { rustAll: true, rustLint: true, filters: [] };
}

function classifyNativeSuites(file) {
  if (NATIVE_ALL_FILES.has(file) || file.startsWith("src-tauri/capabilities/")) {
    return { shell: true, transitions: true, p8: true };
  }
  if (file.startsWith("src/app/")) {
    return { shell: true, transitions: true, p8: true };
  }
  const suites = { shell: false, transitions: false, p8: false };
  if (
    NATIVE_SHELL_EXACT.has(file) ||
    file.startsWith("src/features/shell/") ||
    file.startsWith("src-tauri/src/shell/")
  ) {
    suites.shell = true;
  }
  if (
    NATIVE_TRANSITIONS_EXACT.has(file) ||
    file.startsWith("src/features/shell/") ||
    file.startsWith("src-tauri/src/shell/")
  ) {
    suites.transitions = true;
  }
  if (
    NATIVE_P8_EXACT.has(file) ||
    file.startsWith("src/features/agent/hooks/") ||
    file.startsWith("src/features/agent/capsule/") ||
    file.startsWith("src/features/agent/conversation/") ||
    file.startsWith("src/features/agent/history/") ||
    file.startsWith("src/features/agent/model/") ||
    file.startsWith("src/features/agent/transcript/") ||
    file.startsWith("src-tauri/src/agent/conversation/") ||
    (file.startsWith("src-tauri/src/agent/runtime/") &&
      file !== "src-tauri/src/agent/runtime/capture.rs") ||
    file.startsWith("src-tauri/src/agent/providers/codex/") ||
    file.startsWith("src-tauri/src/agent/providers/process/")
  ) {
    suites.p8 = true;
  }
  return suites;
}

export function planAffected(rawFiles, options = {}) {
  const root = resolve(options.root ?? process.cwd());
  const full = Boolean(options.full);
  const changedFiles = Array.from(new Set((rawFiles ?? []).map(normalizePath).filter(Boolean)));
  const graph = buildFrontendGraph(root);
  const allBunTests = graph.allTests
    .filter((entry) => entry.runner === "bun")
    .map((entry) => entry.file);
  const allNodeTests = graph.allTests
    .filter((entry) => entry.runner === "node")
    .map((entry) => entry.file);

  if (full || changedFiles.some((file) => FULL_ALL_FILES.has(file))) {
    return {
      changedFiles,
      frontend: true,
      frontendCheck: true,
      frontendBuild: true,
      frontendAll: true,
      bunTests: allBunTests,
      nodeTests: allNodeTests,
      rust: true,
      rustLint: true,
      rustAll: true,
      rustFilters: [],
      native: true,
      nativeSuites: { shell: true, transitions: true, p8: true },
    };
  }

  let frontendCheck = false;
  let frontendBuild = false;
  let frontendAll = false;
  const selectedTests = new Set();
  const seeds = new Set();

  let rustLint = false;
  let rustAll = false;
  const rustFilters = [];

  const nativeSuites = { shell: false, transitions: false, p8: false };

  for (const file of changedFiles) {
    if (
      FRONTEND_ALL_FILES.has(file) ||
      /^tsconfig[^/]*\.json$/.test(file) ||
      file.startsWith("tests/setup/")
    ) {
      frontendAll = true;
    }
    if (FRONTEND_CHECK_FILES.has(file) || file.startsWith("src/")) {
      frontendCheck = true;
    }
    if (
      FRONTEND_BUILD_FILES.has(file) ||
      /^tsconfig[^/]*\.json$/.test(file) ||
      file.startsWith("src/")
    ) {
      frontendBuild = true;
    }

    if (file.startsWith("src/") && !existsSync(join(root, file))) {
      const featureMatch = /^src\/features\/([^/]+)\//.exec(file);
      if (featureMatch) {
        const prefix = `tests/${featureMatch[1]}/`;
        const featureTests = graph.allTests.filter((entry) => entry.file.startsWith(prefix));
        if (featureTests.length > 0) {
          for (const entry of featureTests) selectedTests.add(entry.file);
        } else {
          frontendAll = true;
        }
      } else {
        frontendAll = true;
      }
    } else {
      seeds.add(file);
    }

    if (file === "tests/e2e/bin/codex.cmd") {
      seeds.add("tests/e2e/codex-fixture.mjs");
    }

    const rustImpact = classifyRustFile(file);
    if (rustImpact) {
      if (rustImpact.rustLint) rustLint = true;
      if (rustImpact.rustAll) rustAll = true;
      rustFilters.push(...rustImpact.filters);
    }

    const nativeImpact = classifyNativeSuites(file);
    if (nativeImpact.shell) nativeSuites.shell = true;
    if (nativeImpact.transitions) nativeSuites.transitions = true;
    if (nativeImpact.p8) nativeSuites.p8 = true;
  }

  for (const matchedTest of collectDependentTests(seeds, graph)) {
    selectedTests.add(matchedTest);
  }

  const bunTests = frontendAll
    ? allBunTests
    : allBunTests.filter((file) => selectedTests.has(file));
  const nodeTests = frontendAll
    ? allNodeTests
    : allNodeTests.filter((file) => selectedTests.has(file));

  const frontend =
    frontendCheck || frontendBuild || frontendAll || bunTests.length > 0 || nodeTests.length > 0;
  const collapsedRust = rustAll ? [] : collapseRustFilters(rustFilters);
  const rust = rustLint || rustAll || collapsedRust.length > 0;
  const native = nativeSuites.shell || nativeSuites.transitions || nativeSuites.p8;

  return {
    changedFiles,
    frontend,
    frontendCheck,
    frontendBuild,
    frontendAll,
    bunTests,
    nodeTests,
    rust,
    rustLint,
    rustAll,
    rustFilters: collapsedRust,
    native,
    nativeSuites,
  };
}

export function formatGithubOutputs(plan) {
  const lines = [
    `frontend=${plan.frontend}`,
    `frontend_check=${plan.frontendCheck}`,
    `frontend_build=${plan.frontendBuild}`,
    `frontend_all=${plan.frontendAll}`,
    `bun_tests=${plan.frontendAll ? "" : plan.bunTests.join(" ")}`,
    `node_tests=${plan.frontendAll ? "" : plan.nodeTests.join(" ")}`,
    `rust=${plan.rust}`,
    `rust_lint=${plan.rustLint}`,
    `rust_all=${plan.rustAll}`,
    `rust_filters=${plan.rustAll ? "" : plan.rustFilters.join(" ")}`,
    `native=${plan.native}`,
    `native_shell=${plan.nativeSuites.shell}`,
    `native_transitions=${plan.nativeSuites.transitions}`,
    `native_p8=${plan.nativeSuites.p8}`,
  ];
  return `${lines.join("\n")}\n`;
}

function runGit(root, args) {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split(/\r?\n/)
      .map(normalizePath)
      .filter(Boolean);
  } catch {
    return [];
  }
}

function runGitStrict(root, args, description) {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
      .split(/\r?\n/)
      .map(normalizePath)
      .filter(Boolean);
  } catch (error) {
    throw new Error(`Unable to compute git diff (${description}): ${error.message}`);
  }
}

function gitRefExists(root, ref) {
  try {
    execFileSync("git", ["rev-parse", "--verify", "--quiet", ref], {
      cwd: root,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

export function collectChangedFiles(root, options = {}) {
  if (options.files && options.files.length > 0) {
    return Array.from(new Set(options.files.map(normalizePath).filter(Boolean)));
  }
  if (options.staged) {
    return Array.from(
      new Set(runGit(root, ["diff", "--cached", "--name-only", "--no-renames"])),
    );
  }
  if (options.base) {
    const baseDiff = runGitStrict(
      root,
      ["diff", "--name-only", "--no-renames", `${options.base}...HEAD`],
      `base ${options.base}`,
    );
    if (!options.includeWorktree) return Array.from(new Set(baseDiff));
    const localDiff = runGit(root, ["diff", "--name-only", "--no-renames", "HEAD"]);
    const untracked = runGit(root, ["ls-files", "--others", "--exclude-standard"]);
    return Array.from(new Set([...baseDiff, ...localDiff, ...untracked]));
  }
  const worktree = runGit(root, ["diff", "--name-only", "--no-renames", "HEAD"]);
  const untracked = runGit(root, ["ls-files", "--others", "--exclude-standard"]);
  const dirty = Array.from(new Set([...worktree, ...untracked]));
  if (dirty.length > 0) return dirty;
  for (const candidate of ["origin/master", "master", "origin/main", "main"]) {
    if (!gitRefExists(root, candidate)) continue;
    const branchDiff = runGit(root, ["diff", "--name-only", "--no-renames", `${candidate}...HEAD`]);
    if (branchDiff.length > 0) return Array.from(new Set(branchDiff));
  }
  return Array.from(new Set(runGit(root, ["diff", "--name-only", "--no-renames", "HEAD~1..HEAD"])));
}

function runCommand(command, args, root) {
  console.log(`> ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function printHumanPlan(plan) {
  console.log(`Changed files (${plan.changedFiles.length}):`);
  for (const file of plan.changedFiles.slice(0, 20)) console.log(`  - ${file}`);
  if (plan.changedFiles.length > 20) {
    console.log(`  ... and ${plan.changedFiles.length - 20} more`);
  }
  console.log(
    `Frontend: ${plan.frontend ? (plan.frontendAll ? "full" : `${plan.bunTests.length} bun, ${plan.nodeTests.length} node`) : "skip"} (check=${plan.frontendCheck}, build=${plan.frontendBuild})`,
  );
  if (!plan.frontendAll) {
    for (const file of [...plan.bunTests, ...plan.nodeTests]) console.log(`  test: ${file}`);
  }
  console.log(
    `Rust: ${plan.rust ? (plan.rustAll ? "full" : plan.rustFilters.join(" ")) : "skip"} (lint=${plan.rustLint})`,
  );
  const nativeList = Object.entries(plan.nativeSuites)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name);
  console.log(`Native E2E: ${nativeList.length > 0 ? nativeList.join(", ") : "skip"}`);
}

export function runPlan(plan, options = {}) {
  const root = resolve(options.root ?? process.cwd());
  const scope = options.scope ?? "all";
  const includeNative = Boolean(options.includeNative || scope === "native");
  const withChecks = Boolean(options.withChecks);
  const lockedArgs = options.locked ? ["--locked"] : [];
  let executed = 0;

  if ((scope === "all" || scope === "frontend") && plan.frontend) {
    if (withChecks && plan.frontendCheck) {
      runCommand("bun", ["run", "check"], root);
      executed += 1;
    }
    if (withChecks && plan.frontendBuild) {
      runCommand("bun", ["run", "build"], root);
      executed += 1;
    }
    if (plan.frontendAll) {
      runCommand("bun", ["run", "test:frontend:critical"], root);
      executed += 1;
    } else {
      if (plan.bunTests.length > 0) {
        runCommand("bun", ["test", "--isolate", ...plan.bunTests], root);
        executed += 1;
      }
      if (plan.nodeTests.length > 0) {
        runCommand(process.execPath, ["--test", ...plan.nodeTests], root);
        executed += 1;
      }
    }
  }

  if ((scope === "all" || scope === "rust") && plan.rust) {
    if (withChecks && plan.rustLint) {
      runCommand(
        "cargo",
        ["fmt", "--all", "--manifest-path", "src-tauri/Cargo.toml", "--", "--check"],
        root,
      );
      executed += 1;
    }
    if (plan.rustAll) {
      runCommand(
        "cargo",
        ["test", "--manifest-path", "src-tauri/Cargo.toml", ...lockedArgs],
        root,
      );
      executed += 1;
    } else if (plan.rustFilters.length > 0) {
      runCommand(
        "cargo",
        [
          "test",
          "--manifest-path",
          "src-tauri/Cargo.toml",
          ...lockedArgs,
          "--lib",
          "--",
          ...plan.rustFilters,
        ],
        root,
      );
      executed += 1;
    }
    if (withChecks && plan.rustLint) {
      runCommand(
        "cargo",
        [
          "clippy",
          "--manifest-path",
          "src-tauri/Cargo.toml",
          "--all-targets",
          ...lockedArgs,
          "--",
          "-D",
          "warnings",
        ],
        root,
      );
      executed += 1;
    }
  }

  if (plan.native) {
    const nativeCommands = [
      plan.nativeSuites.shell && "test:e2e:shell",
      plan.nativeSuites.transitions && "test:e2e:transitions",
      plan.nativeSuites.p8 && "test:e2e:native",
    ].filter(Boolean);
    if (includeNative) {
      for (const script of nativeCommands) {
        runCommand("bun", ["run", script], root);
        executed += 1;
      }
    } else if (scope === "all") {
      console.log(
        `Affected native E2E (pass --include-native to run): ${nativeCommands.map((script) => `bun run ${script}`).join(", ")}`,
      );
    }
  }

  if (executed === 0) {
    console.log("No affected tests to run for the detected changes.");
  }
}

function parseCliArgs(argv) {
  const options = {
    plan: false,
    json: false,
    githubOutput: false,
    full: false,
    staged: false,
    includeWorktree: false,
    includeNative: false,
    withChecks: false,
    locked: false,
    base: null,
    scope: "all",
    files: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      options.files.push(...argv.slice(index + 1));
      break;
    }
    if (arg === "--plan") options.plan = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--github-output") options.githubOutput = true;
    else if (arg === "--full") options.full = true;
    else if (arg === "--staged") options.staged = true;
    else if (arg === "--include-worktree") options.includeWorktree = true;
    else if (arg === "--include-native") options.includeNative = true;
    else if (arg === "--with-checks") options.withChecks = true;
    else if (arg === "--locked") options.locked = true;
    else if (arg === "--base") {
      options.base = argv[index + 1] ?? null;
      index += 1;
    } else if (arg.startsWith("--base=")) {
      options.base = arg.slice("--base=".length) || null;
    } else if (arg === "--scope") {
      options.scope = argv[index + 1] ?? "all";
      index += 1;
    } else if (arg.startsWith("--scope=")) {
      options.scope = arg.slice("--scope=".length) || "all";
    } else if (arg === "--files") {
      const value = argv[index + 1] ?? "";
      options.files.push(...value.split(",").filter(Boolean));
      index += 1;
    } else if (arg.startsWith("--files=")) {
      options.files.push(...arg.slice("--files=".length).split(",").filter(Boolean));
    } else if (!arg.startsWith("-")) {
      options.files.push(arg);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!["all", "frontend", "rust", "native"].includes(options.scope)) {
    throw new Error(`Unsupported scope: ${options.scope}`);
  }
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const cli = parseCliArgs(process.argv.slice(2));
  const changed = cli.full ? [] : collectChangedFiles(root, cli);
  const plan = planAffected(changed, { root, full: cli.full });

  if (cli.githubOutput) {
    const serialized = formatGithubOutputs(plan);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, serialized);
    process.stdout.write(serialized);
  } else if (cli.json) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  } else {
    printHumanPlan(plan);
    if (!cli.plan) runPlan(plan, { ...cli, root });
  }
}
