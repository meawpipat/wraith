import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  EXIT_ERROR,
  EXIT_FINDINGS,
  EXIT_OK,
  type Finding,
  formatFinding,
  ToolError,
} from "./lib/finding.ts";
import { parseMetaBlock } from "./lib/spike-meta.ts";
import {
  checkResults,
  evaluateGate,
  parseResults,
  RESULTS_FILE,
  type ResultsEntry,
} from "./lib/spike-results.ts";
import { findUnsafeToken } from "./lib/unsafe-tokens.ts";
import { walkFiles } from "./lib/walk.ts";

const SKIP_DIRS: ReadonlySet<string> = new Set(["node_modules", ".reports"]);
const SCRIPT_RE = /^spike\/(hc|kiro|agents)\/([a-z0-9]+)\/([a-z0-9]+)\.ts$/;
/** An import or export that reaches into `spike/`: the dependency runs spike -> tools only. */
const TOOLS_TO_SPIKE_RE = /\bfrom\s+["'](?:\.\.?\/)+spike\//;
const GITIGNORE_SPIKE_RE = /^\/?(?:spike|docs\/spikes)(?:\/\*{0,2})?$/;

function readText(root: string, rel: string): string {
  try {
    return readFileSync(join(root, rel), "utf8");
  } catch {
    throw new ToolError("cannot read file", rel);
  }
}

function lineOfEveryUnsafe(text: string): { line: number; group: string }[] {
  const out: { line: number; group: string }[] = [];
  text.split("\n").forEach((l, i) => {
    const m = findUnsafeToken(l);
    if (m !== null) out.push({ line: i + 1, group: m.group });
  });
  return out;
}

function tokenFindings(root: string): Finding[] {
  const out: Finding[] = [];
  const files = [
    RESULTS_FILE,
    ...walkFiles({ root, dirs: ["spike"], skipDirNames: SKIP_DIRS }).filter(
      (f) => f.endsWith(".ts") || f.endsWith("README.md"),
    ),
  ];
  for (const file of files) {
    for (const hit of lineOfEveryUnsafe(readText(root, file))) {
      out.push({ file, line: hit.line, rule: `spike/unsafe-token-${hit.group}` });
    }
  }
  return out;
}

function metaFindings(root: string): Finding[] {
  const out: Finding[] = [];
  const files = walkFiles({ root, dirs: ["spike"], skipDirNames: SKIP_DIRS });
  for (const file of files) {
    const m = SCRIPT_RE.exec(file);
    if (m === null || m[2] !== m[3]) continue;
    const r = parseMetaBlock(readText(root, file));
    if (!r.ok) out.push({ file, line: 1, rule: "spike/meta-block" });
    else if (r.meta.id !== m[2]) out.push({ file, line: 1, rule: "spike/meta-id" });
  }
  return out;
}

function gitignoreFindings(root: string): Finding[] {
  const path = join(root, ".gitignore");
  if (!existsSync(path)) return [];
  const out: Finding[] = [];
  readText(root, ".gitignore")
    .split("\n")
    .forEach((raw, i) => {
      const l = raw.trim();
      if (GITIGNORE_SPIKE_RE.test(l))
        out.push({ file: ".gitignore", line: i + 1, rule: "spike/gitignored" });
    });
  return out;
}

function directionFindings(root: string): Finding[] {
  const out: Finding[] = [];
  const files = walkFiles({ root, dirs: ["tools"], skipDirNames: SKIP_DIRS }).filter((f) =>
    f.endsWith(".ts"),
  );
  for (const file of files) {
    readText(root, file)
      .split("\n")
      .forEach((l, i) => {
        if (TOOLS_TO_SPIKE_RE.test(l))
          out.push({ file, line: i + 1, rule: "spike/tools-imports-spike" });
      });
  }
  return out;
}

function version(entries: readonly ResultsEntry[], re: RegExp): string {
  for (const e of entries) {
    const m = re.exec(e.experiment);
    if (m?.[1] !== undefined) return m[1];
  }
  return "unknown";
}

function parseArgs(argv: readonly string[]): { root: string; gate: boolean } {
  let root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  let gate = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--"))
        throw new ToolError("--root needs a directory");
      root = resolve(value);
      i++;
    } else if (argv[i] === "--gate") gate = true;
    else throw new ToolError("usage: check-spike-results.ts [--root <dir>] [--gate]");
  }
  return { root, gate };
}

export function main(argv: readonly string[]): number {
  try {
    const { root, gate } = parseArgs(argv);
    const md = readText(root, RESULTS_FILE);
    const exists = (p: string): boolean => existsSync(join(root, p));
    const findings: Finding[] = [
      ...checkResults(md, { repoRoot: root, exists, gate: false }),
      ...tokenFindings(root),
      ...metaFindings(root),
      ...gitignoreFindings(root),
      ...directionFindings(root),
    ];
    for (const f of findings) console.log(formatFinding(f));
    let open = true;
    if (gate) {
      const { entries } = parseResults(md);
      const g = evaluateGate(entries, exists);
      open = g.open;
      const c = g.counts;
      console.log(
        `counts: PASS ${c.PASS}, FAIL ${c.FAIL}, PARTIAL ${c.PARTIAL}, pending ${c.pending}`,
      );
      console.log(`hc: ${version(entries, /\bhc\s+v?(\d+\.\d+\.\d+)/i)}`);
      console.log(`kiro-cli: ${version(entries, /\bkiro-cli\s+v?(\d+\.\d+\.\d+)/i)}`);
      console.log(`claude code: ${version(entries, /\bclaude(?:\s+code)?\s+v?(\d+\.\d+\.\d+)/i)}`);
      console.log(`date: ${new Date().toISOString().slice(0, 10)}`);
      if (g.missing.length > 0) console.log(`gate missing: ${g.missing.join(", ")}`);
      if (g.pending.length > 0) console.log(`gate pending: ${g.pending.join(", ")}`);
      console.log(open ? "gate: open" : "gate: closed");
    }
    const ok = findings.length === 0 && open;
    console.log(
      findings.length === 0
        ? "check-spike-results: clean"
        : `check-spike-results: ${findings.length} finding(s)`,
    );
    return ok ? EXIT_OK : EXIT_FINDINGS;
  } catch (e) {
    if (e instanceof ToolError) {
      console.error(e.path === undefined ? e.message : `${e.message}: ${e.path}`);
    } else {
      console.error("check-spike-results: unexpected error");
    }
    return EXIT_ERROR;
  }
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href) {
  process.exitCode = main(process.argv.slice(2));
}
