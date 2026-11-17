import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  EXIT_ERROR,
  EXIT_FINDINGS,
  EXIT_OK,
  type Finding,
  formatFinding,
  ToolError,
} from "./lib/finding.ts";
import { changedPaths, stagedContent, stagedPaths, trackedPaths, treePaths } from "./lib/git.ts";
import {
  extractHookText,
  HOOK_PSEUDO_FILE,
  isGitCommit,
  isShellTool,
  parseHookInput,
  readHookStdin,
} from "./lib/hook-stdin.ts";
import { scanText } from "./lib/secret-rules.ts";

export type ScanMode =
  | { kind: "staged" }
  | { kind: "changed"; base: string }
  | { kind: "tracked" }
  | { kind: "tree" }
  | { kind: "paths"; paths: readonly string[] }
  | { kind: "hook-stdin" };

export interface ScanResult {
  findings: Finding[];
  scanned: number;
}

const SKIPPED_SEGMENTS: ReadonlySet<string> = new Set(["node_modules", "dist", ".git"]);
const USAGE =
  "usage: secret-scan.ts --staged | --changed <base> | --tracked | --tree | <path>… | --hook-stdin";

/** R3.12: any path with a node_modules, dist or .git segment is not scanned. */
export function isSkippedPath(rel: string): boolean {
  return rel
    .replace(/\\/g, "/")
    .split("/")
    .some((s) => SKIPPED_SEGMENTS.has(s));
}

/** Binary content is decoded as UTF-8 with replacement and scanned like text. */
function decode(content: Buffer): string {
  return content.toString("utf8");
}

function posix(p: string): string {
  return p.replace(/\\/g, "/");
}

function readWorkingFile(cwd: string, rel: string): Buffer {
  try {
    return readFileSync(resolve(cwd, rel));
  } catch {
    throw new ToolError("unreadable file", rel);
  }
}

function checkExplicitPath(cwd: string, rel: string): void {
  let isDir: boolean;
  try {
    isDir = statSync(resolve(cwd, rel)).isDirectory();
  } catch {
    throw new ToolError("path not found", rel);
  }
  if (isDir) throw new ToolError("path is a directory", rel);
}

function selectFiles(
  mode: ScanMode,
  cwd: string,
): { paths: string[]; read: (rel: string) => Buffer } {
  const fromWorkingTree = (rel: string): Buffer => readWorkingFile(cwd, rel);
  switch (mode.kind) {
    case "staged":
      return { paths: stagedPaths(cwd), read: (rel) => stagedContent(cwd, rel) };
    case "changed":
      return { paths: changedPaths(cwd, mode.base), read: fromWorkingTree };
    case "tracked":
      return { paths: trackedPaths(cwd), read: fromWorkingTree };
    case "tree":
      return { paths: treePaths(cwd), read: fromWorkingTree };
    case "paths":
      for (const p of mode.paths) checkExplicitPath(cwd, p);
      return { paths: [...mode.paths], read: fromWorkingTree };
    case "hook-stdin":
      throw new ToolError(USAGE);
  }
}

function scanHookPayload(raw: string, cwd: string): ScanResult {
  const json = parseHookInput(raw);
  // Fail closed: valid JSON that is not an object cannot be a hook payload.
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    throw new ToolError("hook input is not a JSON object");
  }
  const text = extractHookText(json);
  if (isShellTool(text.toolName) && text.command !== undefined && isGitCommit(text.command)) {
    return runSecretScan({ kind: "staged" }, text.cwd ?? cwd);
  }
  const name = text.path === undefined ? HOOK_PSEUDO_FILE : posix(text.path);
  // Each string is scanned alone, so a line number is relative to the matched string.
  const findings = text.strings.flatMap((s) => scanText(name, s));
  return { findings, scanned: 1 };
}

export function runSecretScan(mode: ScanMode, cwd: string, stdin?: string): ScanResult {
  if (mode.kind === "hook-stdin") return scanHookPayload(stdin ?? readHookStdin(), cwd);
  const { paths, read } = selectFiles(mode, cwd);
  const findings: Finding[] = [];
  let scanned = 0;
  for (const raw of paths) {
    const rel = posix(raw);
    if (isSkippedPath(rel)) continue;
    findings.push(...scanText(rel, decode(read(raw))));
    scanned++;
  }
  return { findings, scanned };
}

export function parseArgs(argv: readonly string[]): ScanMode {
  const first = argv[0];
  if (first === undefined) throw new ToolError(USAGE);
  switch (first) {
    case "--staged":
    case "--tracked":
    case "--tree":
    case "--hook-stdin":
      if (argv.length !== 1) throw new ToolError(USAGE);
      return { kind: first.slice(2) as "staged" | "tracked" | "tree" | "hook-stdin" };
    case "--changed": {
      const base = argv[1];
      if (argv.length !== 2 || base === undefined || base.startsWith("--")) {
        throw new ToolError(USAGE);
      }
      return { kind: "changed", base };
    }
    default:
      if (argv.some((a) => a.startsWith("--"))) throw new ToolError(USAGE);
      return { kind: "paths", paths: argv };
  }
}

export function main(argv: readonly string[], cwd: string): number {
  try {
    const mode = parseArgs(argv);
    const hook = mode.kind === "hook-stdin";
    const { findings, scanned } = runSecretScan(mode, cwd);
    // Hook mode: stderr is what Kiro shows on exit 2; only formatFinding lines, never the payload.
    const out = hook ? console.error : console.log;
    for (const f of findings) out(formatFinding(f));
    out(`secret-scan: ${scanned} file(s) scanned, ${findings.length} finding(s)`);
    if (findings.length === 0) return EXIT_OK;
    return hook ? EXIT_ERROR : EXIT_FINDINGS;
  } catch (e) {
    if (e instanceof ToolError) {
      console.error(e.path === undefined ? e.message : `${e.message}: ${e.path}`);
    } else {
      console.error("secret-scan: unexpected error");
    }
    return EXIT_ERROR;
  }
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href) {
  process.exitCode = main(process.argv.slice(2), process.cwd());
}
