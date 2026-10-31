// Frontend composition rules — ratchet, not a rewrite.
//
// The rule is: the frontend may not get *worse* than the recorded baseline.
// Fix violations and lower the baseline with `--write-baseline`; never raise it
// to make a change pass.
//
// Run: bun run lint:frontend
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");
const BASELINE = join(ROOT, ".agents", "frontend-budget.json");

const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const THEME_BLOCK = /@theme\s*\{[\s\S]*?\n\}/;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const files = walk(SRC).map((f) => relative(ROOT, f).split(sep).join("/"));
const tsx = files.filter((f) => f.endsWith(".tsx"));
const css = files.filter((f) => f.endsWith(".css"));
const read = (f) => readFileSync(join(ROOT, f), "utf8");

// R1 — colors come from tokens, never from a literal in a component or module.
const tsFiles = files.filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
const tsxHex = tsFiles.reduce((n, f) => n + (read(f).match(HEX)?.length ?? 0), 0);

// R2 — src/style.css may only name colors inside its @theme token block.
const cssHexOutsideTheme = css.reduce((n, f) => {
  const body = read(f);
  const theme = body.match(THEME_BLOCK)?.[0] ?? "";
  return n + ((body.replace(theme, "").match(HEX)?.length ?? 0) || 0);
}, 0);

// R3 — a component file stays a component, not a module.
const maxTsxLines = tsx.reduce((max, f) => Math.max(max, read(f).split("\n").length), 0);

// R4 — a feature is consumed through its public entry, never its internals.
const featuresDir = join(SRC, "features");
const features = existsSync(featuresDir)
  ? readdirSync(featuresDir).filter((d) => statSync(join(featuresDir, d)).isDirectory())
  : [];
const featuresWithoutEntry = features.filter(
  (d) => !existsSync(join(featuresDir, d, "index.ts")) && !existsSync(join(featuresDir, d, "index.tsx")),
).length;

// R6 — an accessible name is rendered text, never an aria-label attribute.
// Icon-only controls use VisuallyHidden / IconButton from shared/ui.
const ariaLabelCount = tsFiles.reduce(
  (n, f) => n + (read(f).match(/aria-label=/g)?.length ?? 0),
  0,
);

// R7 — no hand-drawn <svg> in a feature or the shell; icons come from
// shared/ui (lucide-react).
const inlineSvgCount = [...tsFiles, ...css].reduce((n, f) => {
  if (f.startsWith("src/shared/ui/")) return n;
  return n + (read(f).match(/<svg/g)?.length ?? 0);
}, 0);
// violates the complexity rules; the ratchet makes sure it never gets worse.
function biomeWarnings() {
  // Windows ships a .cmd shim, which execFileSync refuses without a shell;
  // running the Node entry point directly is cross-platform and shell-free.
  const entry = join(ROOT, "node_modules", "@biomejs", "biome", "bin", "biome");
  const args = [entry, "check", "src", "vite.config.ts", "--reporter=json", "--max-diagnostics=500"];
  let raw = "";
  try {
    raw = execFileSync(process.execPath, args, {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "ignore"],
    }).toString();
  } catch (error) {
    // Non-zero exit still prints the diagnostics JSON on stdout.
    raw = error.stdout?.toString() ?? "";
  }
  try {
    return (JSON.parse(raw).diagnostics ?? []).length;
  } catch {
    return 0;
  }
}

const actual = {
  tsxHex,
  cssHexOutsideTheme,
  maxTsxLines,
  featuresWithoutEntry,
  ariaLabelCount,
  inlineSvgCount,
  biomeWarnings: biomeWarnings(),
};

if (process.argv.includes("--write-baseline")) {
  writeFileSync(BASELINE, `${JSON.stringify(actual, null, 2)}\n`);
  console.log("baseline written:", actual);
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.error("Missing baseline. Run: bun run lint:frontend --write-baseline");
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
const RISK = {
  tsxHex: "raw color literal in a component — use a token from src/style.css @theme",
  cssHexOutsideTheme: "color literal outside @theme — add a token or reuse one",
  maxTsxLines: "largest component file grew — split by responsibility, not by line count",
  featuresWithoutEntry: "a feature is missing its public entry (index.ts) — internals must not leak",
  ariaLabelCount: "aria-label used — render the name with VisuallyHidden or IconButton instead",
  inlineSvgCount: "hand-drawn <svg> outside shared/ui — use an icon from shared/ui (lucide-react)",
  biomeWarnings: "Biome warning count grew — fix the new warning instead of adding one",
};

// Enforce boundaries on imports rather than counting line length or file names.
// Type-only platform contracts are safe in views; runtime IPC is container-owned.
function isTypeOnlyImport(clause) {
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  if (clause.name || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings))
    return false;
  return clause.namedBindings.elements.every((entry) => entry.isTypeOnly);
}

const boundaryViolations = [];
for (const file of tsFiles) {
  const source = ts.createSourceFile(
    file, read(file), ts.ScriptTarget.Latest, true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const feature = file.match(/^src\\/features\\/([^/]+)\\//)?.[1];
  const examine = (specifier, typeOnly) => {
    if (specifier.startsWith("@tauri-apps/") && !file.startsWith("src/platform/")) {
      boundaryViolations.push(`${file}: Tauri APIs belong in src/platform/`);
    }
    if (!specifier.startsWith(".")) return;
    const target = relative(ROOT, resolve(dirname(join(ROOT, file)), specifier))
      .split(sep).join("/");
    if (file.startsWith("src/shared/ui/") &&
      (target.startsWith("src/features/") || target.startsWith("src/platform/"))) {
      boundaryViolations.push(`${file}: shared/ui cannot depend on ${target}`);
    }
    if (feature && target.startsWith("src/features/")) {
      const targetFeature = target.split("/")[2];
      if (targetFeature !== feature &&
        target !== `src/features/${targetFeature}` &&
        target !== `src/features/${targetFeature}/index`) {
        boundaryViolations.push(`${file}: cross-feature import bypasses public entry: ${target}`);
      }
    }
    if (file.endsWith(".tsx") && file.startsWith("src/features/") &&
      target.startsWith("src/platform/") && !typeOnly) {
      boundaryViolations.push(`${file}: view must not perform native IPC: ${target}`);
    }
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      examine(node.moduleSpecifier.text, isTypeOnlyImport(node.importClause));
    } else if (ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) {
      examine(node.arguments[0].text, false);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

let failed = false;
for (const violation of boundaryViolations) {
  failed = true;
  console.error(`FAIL boundary: ${violation}`);
}
for (const key of Object.keys(actual)) {
  const now = actual[key];
  const was = baseline[key] ?? 0;
  if (now > was) {
    failed = true;
    console.error(`FAIL ${key}: ${was} -> ${now}. ${RISK[key]}`);
  } else if (now < was) {
    console.log(`OK   ${key}: ${was} -> ${now} (run with --write-baseline to lock it in)`);
  } else {
    console.log(`OK   ${key}: ${now}`);
  }
}

if (failed) {
  console.error("\nFrontend rules failed. Fix the change; do not raise the baseline.");
  process.exit(1);
}
console.log("\nFrontend rules pass.");
