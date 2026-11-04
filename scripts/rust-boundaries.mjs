import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const root = resolve(import.meta.dirname, "..");
const sourceRoot = join(root, "src-tauri", "src");
const coreRoot = join(sourceRoot, "agent");
const osEventsRoot = join(sourceRoot, "os_events");
const windowsRoot = join(sourceRoot, "windows");
const ipcRoot = join(sourceRoot, "ipc");
const budgetPath = join(root, ".agents", "rust-budget.json");

function rustFiles(folder) {
  if (!existsSync(folder)) return [];
  return readdirSync(folder, { withFileTypes: true }).flatMap((item) => {
    const path = join(folder, item.name);
    return item.isDirectory() ? rustFiles(path) : item.name.endsWith(".rs") ? [path] : [];
  });
}

function prodLines(path) {
  const lines = readFileSync(path, "utf8").split("\n");
  const tests = lines.findIndex(
    (line, index) =>
      line.trim() === "#[cfg(test)]" && lines[index + 1]?.trim().startsWith("mod tests"),
  );
  return tests === -1 ? lines.length : tests;
}

const failures = [];

for (const path of rustFiles(coreRoot)) {
  if (path.includes(`${sep}providers${sep}`)) continue;
  const source = readFileSync(path, "utf8");
  const forbidden = [
    /\b(?:crate|super)::windows::\b/,
    /\b(?:crate::agent::|super::)?providers::(?:codex|pi|agy)::/,
  ];
  if (forbidden.some((pattern) => pattern.test(source))) {
    failures.push(`F6: ${relative(root, path)} imports a concrete native adapter`);
  }
}

for (const path of rustFiles(osEventsRoot)) {
  const source = readFileSync(path, "utf8");
  const forbidden = [
    /\b(?:crate|super)::windows::\b/,
    /\b(?:crate::agent::|super::)?providers::(?:codex|pi|agy)::/,
    /\bWebviewWindow\b/,
  ];
  if (forbidden.some((pattern) => pattern.test(source))) {
    failures.push(`F8: ${relative(root, path)} imports a native adapter or window type`);
  }
}

for (const path of rustFiles(join(windowsRoot, "observers"))) {
  const source = readFileSync(path, "utf8");
  const forbidden = [
    /crate::os_events::Hub\b/,
    /crate::os_events::policy\b/,
    /\bobserve_now\s*\(/,
  ];
  if (forbidden.some((pattern) => pattern.test(source))) {
    failures.push(`F8: ${relative(root, path)} owns hub policy instead of reporting observations`);
  }
}

for (const path of rustFiles(windowsRoot)) {
  const source = readFileSync(path, "utf8");
  const forbidden = [
    /\bAgentRuntime\b/,
    /\b(?:crate::)?agent::history\b/,
    /\bHistoryStore\b/,
    /\.capture_hotkey\s*\(/,
    /\.begin_capture\s*\(/,
  ];
  if (forbidden.some((pattern) => pattern.test(source))) {
    failures.push(`F7: ${relative(root, path)} owns agent runtime or conversation persistence`);
  }
}

const geometry = /\bfn (?:surface_size|content_size|placement_origin|hit_region_plan|window_size|top_inset|attached_gutter|needs_region_update)\b/;

if (existsSync(join(sourceRoot, "commands.rs"))) {
  failures.push("F11: src/commands.rs exists again — command files belong under src/ipc/");
}

for (const path of rustFiles(ipcRoot)) {
  if (geometry.test(readFileSync(path, "utf8"))) {
    failures.push(`F11: ${relative(root, path)} owns notch geometry instead of delegating`);
  }
}

if (existsSync(budgetPath)) {
  const ceiling = JSON.parse(readFileSync(budgetPath, "utf8")).maxProdLines ?? 0;
  for (const path of rustFiles(sourceRoot)) {
    const size = prodLines(path);
    if (size > ceiling) {
      failures.push(
        `F12: ${relative(root, path)} has ${size} prod lines, ceiling ${ceiling} — split by owner`,
      );
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  process.exit(1);
}
console.log("Rust boundaries F6/F7/F8/F11/F12 pass.");
