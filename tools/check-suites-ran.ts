import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse as parseYaml } from "yaml";
import { EXIT_ERROR, EXIT_FINDINGS, EXIT_OK, formatFinding, ToolError } from "./lib/finding.ts";
import { checkSuites, parseRequired, parseSuiteReport } from "./lib/suites.ts";

const REQUIRED_FILE = "tools/required-suites.json";
const REPORT_NAME = ".reports/suites.json";

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function workspacePatterns(root: string): string[] {
  const file = join(root, "pnpm-workspace.yaml");
  let doc: unknown;
  try {
    doc = parseYaml(readFileSync(file, "utf8"));
  } catch {
    throw new ToolError("cannot read pnpm-workspace.yaml", "pnpm-workspace.yaml");
  }
  const list = (doc as { packages?: unknown } | null)?.packages;
  if (!Array.isArray(list) || !list.every((p): p is string => typeof p === "string")) {
    throw new ToolError("pnpm-workspace.yaml has no packages list", "pnpm-workspace.yaml");
  }
  return list;
}

function expandPattern(root: string, pattern: string): string[] {
  const plain = pattern.replace(/\/+$/, "");
  if (plain.length === 0 || plain.startsWith("/") || plain.split("/").includes("..")) {
    throw new ToolError("unsupported workspace pattern", pattern);
  }
  if (plain.endsWith("/*")) {
    const base = plain.slice(0, -2);
    if (/[*?[\]{}!]/.test(base)) throw new ToolError("unsupported workspace pattern", pattern);
    const baseDir = join(root, base);
    if (!isDirectory(baseDir)) return [];
    return readdirSync(baseDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== "node_modules")
      .map((e) => `${base}/${e.name}`)
      .sort();
  }
  if (/[*?[\]{}!]/.test(plain)) throw new ToolError("unsupported workspace pattern", pattern);
  return isDirectory(join(root, plain)) ? [plain] : [];
}

/** Repo-relative dirs (posix, sorted) whose package.json has a `test` script. */
export function packagesWithTests(root: string): string[] {
  const dirs = new Set<string>();
  for (const pattern of workspacePatterns(root)) {
    for (const dir of expandPattern(root, pattern)) dirs.add(dir);
  }
  const out: string[] = [];
  for (const dir of [...dirs].sort()) {
    const pkgFile = join(root, dir, "package.json");
    if (!existsSync(pkgFile)) continue;
    let pkg: unknown;
    try {
      pkg = JSON.parse(readFileSync(pkgFile, "utf8"));
    } catch {
      throw new ToolError("invalid package.json", `${dir}/package.json`);
    }
    const scripts = (pkg as { scripts?: unknown } | null)?.scripts;
    const test =
      typeof scripts === "object" && scripts !== null
        ? (scripts as Record<string, unknown>).test
        : undefined;
    if (typeof test === "string" && test.length > 0) out.push(dir);
  }
  return out;
}

function readJson(path: string): unknown | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return "unparseable";
  }
}

function parseRoot(argv: readonly string[]): string {
  let root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--"))
        throw new ToolError("--root needs a directory");
      root = resolve(value);
      i++;
    } else {
      throw new ToolError("usage: check-suites-ran.ts [--root <dir>]");
    }
  }
  return root;
}

export function main(argv: readonly string[]): number {
  try {
    const root = parseRoot(argv);
    const withTests = packagesWithTests(root);
    const requiredPath = join(root, REQUIRED_FILE);
    if (!existsSync(requiredPath)) throw new ToolError("required file is missing", REQUIRED_FILE);
    const required = readJson(requiredPath);
    const dirs = new Set<string>(withTests);
    for (const r of parseRequired(required) ?? []) dirs.add(r.package);
    const reports = new Map<string, unknown | null>();
    for (const dir of dirs) reports.set(dir, readJson(join(root, dir, REPORT_NAME)));

    const lines: string[] = [];
    for (const r of parseRequired(required) ?? []) {
      const report = parseSuiteReport(reports.get(r.package) ?? null);
      if (report === null) continue;
      for (const project of r.projects) {
        const runs = report.runs.filter((x) => x.file === r.file && x.project === project);
        if (runs.length === 0) continue;
        const passed = runs.reduce((n, x) => n + x.passed, 0);
        lines.push(`${r.package}/${r.file} ${project} ${passed} passed`);
      }
    }
    for (const line of lines) console.log(line);

    const findings = checkSuites({ required, packagesWithTests: withTests, reports });
    for (const f of findings) console.log(formatFinding(f));
    console.log(
      findings.length === 0
        ? "check-suites-ran: clean"
        : `check-suites-ran: ${findings.length} finding(s)`,
    );
    return findings.length === 0 ? EXIT_OK : EXIT_FINDINGS;
  } catch (e) {
    if (e instanceof ToolError) {
      console.error(e.path === undefined ? e.message : `${e.message}: ${e.path}`);
    } else {
      console.error("check-suites-ran: unexpected error");
    }
    return EXIT_ERROR;
  }
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href) {
  process.exitCode = main(process.argv.slice(2));
}
