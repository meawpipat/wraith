import { readFileSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import {
  EXIT_ERROR,
  EXIT_FINDINGS,
  EXIT_OK,
  type Finding,
  formatFinding,
  ToolError,
} from "./finding.ts";
import {
  extractHookText,
  HOOK_PSEUDO_FILE,
  isShellTool,
  isWriteTool,
  parseHookInput,
  readHookStdin,
} from "./hook-stdin.ts";
import { checkSiSource, checkSiTree, type SiHook } from "./si-rules.ts";

export type SiMode =
  | { kind: "tree" }
  | { kind: "hook-stdin" }
  | { kind: "paths"; paths: readonly string[] };

function usage(name: string): string {
  return `usage: ${name} --tree | --hook-stdin | <path>…`;
}

export function parseSiArgs(name: string, argv: readonly string[]): SiMode {
  const first = argv[0];
  if (first === undefined) throw new ToolError(usage(name));
  if (first === "--tree" || first === "--hook-stdin") {
    if (argv.length !== 1) throw new ToolError(usage(name));
    return { kind: first === "--tree" ? "tree" : "hook-stdin" };
  }
  if (argv.some((a) => a.startsWith("--"))) throw new ToolError(usage(name));
  return { kind: "paths", paths: argv };
}

function posix(p: string): string {
  return p.replace(/\\/g, "/");
}

/** Repo-relative path, or undefined when the path lies outside `cwd`. */
function repoRelative(cwd: string, p: string): string | undefined {
  const rel = posix(relative(cwd, isAbsolute(p) ? p : resolve(cwd, p)));
  if (rel === "" || rel === ".." || rel.startsWith("../") || isAbsolute(rel)) return undefined;
  return rel;
}

function scanPaths(hook: SiHook, cwd: string, paths: readonly string[]): Finding[] {
  const out: Finding[] = [];
  for (const p of paths) {
    let text: string;
    try {
      if (statSync(resolve(cwd, p)).isDirectory()) throw new ToolError("path is a directory", p);
      text = readFileSync(resolve(cwd, p), "utf8");
    } catch (e) {
      if (e instanceof ToolError) throw e;
      throw new ToolError("path not found", p);
    }
    out.push(...checkSiSource(hook, repoRelative(cwd, p) ?? posix(p), text));
  }
  return out;
}

function scanHookPayload(hook: SiHook, trustAll: boolean, raw: string, cwd: string): Finding[] {
  const json = parseHookInput(raw);
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    throw new ToolError("hook input is not a JSON object");
  }
  const text = extractHookText(json);
  const tool = text.toolName;
  if (tool !== undefined && isShellTool(tool)) {
    // Only the trust-all hook reads the shell tool; its text has no path.
    if (!trustAll || text.command === undefined) return [];
    return checkSiSource(hook, HOOK_PSEUDO_FILE, text.command);
  }
  if (tool !== undefined && !isWriteTool(tool)) return [];
  let name = HOOK_PSEUDO_FILE;
  if (text.path !== undefined) {
    // A path outside the repository is not product code.
    const rel = repoRelative(text.cwd ?? cwd, text.path);
    if (rel === undefined) return [];
    name = rel;
  }
  // Each string is scanned alone, so a line number is relative to the matched string.
  return text.strings.flatMap((s) => checkSiSource(hook, name, s));
}

export function runSi(hook: SiHook, mode: SiMode, cwd: string, stdin?: string): Finding[] {
  switch (mode.kind) {
    case "tree":
      return checkSiTree(hook, cwd);
    case "paths":
      return scanPaths(hook, cwd, mode.paths);
    case "hook-stdin":
      return scanHookPayload(hook, hook !== "no-auto-approve", stdin ?? readHookStdin(), cwd);
  }
}

/** Shared CLI body of both scanners. Returns the exit code. */
export function mainSi(hook: SiHook, argv: readonly string[], cwd: string): number {
  try {
    const mode = parseSiArgs(hook, argv);
    const hookMode = mode.kind === "hook-stdin";
    const findings = runSi(hook, mode, cwd);
    // Hook mode: stderr is what Kiro shows on exit 2; formatFinding lines only.
    const out = hookMode ? console.error : console.log;
    for (const f of findings) out(formatFinding(f));
    if (findings.length === 0) return EXIT_OK;
    return hookMode ? EXIT_ERROR : EXIT_FINDINGS;
  } catch (e) {
    if (e instanceof ToolError) {
      console.error(e.path === undefined ? e.message : `${e.message}: ${e.path}`);
    } else {
      console.error(`${hook}: unexpected error`);
    }
    return EXIT_ERROR;
  }
}
