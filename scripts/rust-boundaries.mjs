import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const root = resolve(import.meta.dirname, "..");
const sourceRoot = join(root, "src-tauri", "src");
const coreRoot = join(sourceRoot, "agent");
const windowsRoot = join(sourceRoot, "windows");

function rustFiles(folder) {
  return readdirSync(folder, { withFileTypes: true }).flatMap((item) => {
    const path = join(folder, item.name);
    return item.isDirectory() ? rustFiles(path) : item.name.endsWith(".rs") ? [path] : [];
  });
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

if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  process.exit(1);
}
console.log("Rust boundaries F6/F7 pass.");
