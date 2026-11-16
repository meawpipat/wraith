import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  EXIT_ERROR,
  EXIT_FINDINGS,
  EXIT_OK,
  type Finding,
  formatFinding,
  ToolError,
} from "./lib/finding.ts";
import { maskComments } from "./lib/mask.ts";
import { walkFiles } from "./lib/walk.ts";

export type PlatformTokenId =
  | "process-platform"
  | "os-platform"
  | "os-type"
  | "launchctl"
  | "systemctl"
  | "chmod"
  | "sighup"
  | "sigterm"
  | "tmp-path";

export interface PlatformToken {
  readonly id: PlatformTokenId;
  readonly pattern: RegExp;
}

// Global patterns; every use resets lastIndex through matchAll on a fresh copy.
export const PLATFORM_TOKENS: readonly PlatformToken[] = [
  { id: "process-platform", pattern: /\bprocess\s*\.\s*platform\b/g },
  { id: "os-platform", pattern: /\bos\s*\.\s*platform\s*\(/g },
  { id: "os-type", pattern: /\bos\s*\.\s*type\s*\(/g },
  { id: "launchctl", pattern: /launchctl/g },
  { id: "systemctl", pattern: /systemctl/g },
  { id: "chmod", pattern: /chmod/g },
  { id: "sighup", pattern: /\bSIGHUP\b/g },
  { id: "sigterm", pattern: /\bSIGTERM\b/g },
  { id: "tmp-path", pattern: /\/tmp\//g },
];

const SCANNED_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"] as const;
const EXCLUDED_SEGMENTS: ReadonlySet<string> = new Set([
  "node_modules",
  "dist",
  "generated",
  "test",
]);
const EXCLUDED_SUFFIXES = [".test.ts", ".test.tsx", ".d.ts"] as const;
const SKIP_DIR_NAMES: ReadonlySet<string> = new Set([".reports", ".wrangler", "target"]);

/** R5.3, R9.9: only apps/ and packages/ (minus packages/platform/ and packages/fakes/). */
export function isScannedPath(rel: string): boolean {
  const p = rel.replace(/\\/g, "/");
  if (!(p.startsWith("apps/") || p.startsWith("packages/"))) return false;
  if (!SCANNED_EXTENSIONS.some((e) => p.endsWith(e))) return false;
  if (p.startsWith("packages/platform/") || p.startsWith("packages/fakes/")) return false;
  if (p.split("/").some((s) => EXCLUDED_SEGMENTS.has(s))) return false;
  if (EXCLUDED_SUFFIXES.some((s) => p.endsWith(s))) return false;
  return true;
}

export function checkPlatformSource(rel: string, text: string): Finding[] {
  if (!isScannedPath(rel)) return [];
  const masked = maskComments(text);
  const lineStarts: number[] = [0];
  for (let i = 0; i < masked.length; i++) {
    if (masked.charCodeAt(i) === 10) lineStarts.push(i + 1);
  }
  const locate = (offset: number): { line: number; column: number } => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((lineStarts[mid] as number) <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: offset - (lineStarts[lo] as number) + 1 };
  };
  const out: Finding[] = [];
  for (const token of PLATFORM_TOKENS) {
    for (const m of masked.matchAll(new RegExp(token.pattern.source, "g"))) {
      const { line, column } = locate(m.index ?? 0);
      out.push({ file: rel, line, column, rule: `platform/${token.id}` });
    }
  }
  return sortFindings(out);
}

function sortFindings(findings: Finding[]): Finding[] {
  return findings.sort(
    (a, b) =>
      (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) ||
      a.line - b.line ||
      (a.column ?? 0) - (b.column ?? 0) ||
      (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0),
  );
}

export function checkPlatformTree(root: string): Finding[] {
  const files = walkFiles({ root, dirs: ["apps", "packages"], skipDirNames: SKIP_DIR_NAMES });
  const out: Finding[] = [];
  for (const rel of files) {
    if (!isScannedPath(rel)) continue;
    let text: string;
    try {
      text = readFileSync(resolve(root, rel), "utf8");
    } catch {
      throw new ToolError("unreadable file", rel);
    }
    out.push(...checkPlatformSource(rel, text));
  }
  return sortFindings(out);
}

function parseRoot(argv: readonly string[]): string {
  const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  let root = defaultRoot;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--"))
        throw new ToolError("--root needs a directory");
      root = resolve(value);
      i++;
    } else {
      throw new ToolError("usage: check-platform.ts [--root <dir>]");
    }
  }
  return root;
}

export function main(argv: readonly string[]): number {
  try {
    const findings = checkPlatformTree(parseRoot(argv));
    for (const f of findings) console.log(formatFinding(f));
    console.log(
      findings.length === 0
        ? "check-platform: clean"
        : `check-platform: ${findings.length} finding(s)`,
    );
    return findings.length === 0 ? EXIT_OK : EXIT_FINDINGS;
  } catch (e) {
    if (e instanceof ToolError) {
      console.error(e.path === undefined ? e.message : `${e.message}: ${e.path}`);
    } else {
      console.error("check-platform: unexpected error");
    }
    return EXIT_ERROR;
  }
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href) {
  process.exitCode = main(process.argv.slice(2));
}
