import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type Finding, ToolError } from "./finding.ts";
import { findUnsafeToken, type UnsafeGroup } from "./unsafe-tokens.ts";
import { walkFiles } from "./walk.ts";

/** Hook names. The first is not spelled like the SI-1 token, so this file holds none. */
export const HOOK_TRUST_ALL = "no-trust-all" as const;
export const HOOK_AUTO_APPROVE = "no-auto-approve" as const;
export type SiHook = typeof HOOK_TRUST_ALL | typeof HOOK_AUTO_APPROVE;

/**
 * Group-to-hook assignment (task 9.2 / 9.3).
 * SI-2 (agent flags, agent settings values, settings shapes) goes to
 * the trust-all hook. The auto-approve hook checks every group, including the
 * environment names. A group missing from both lists would be left unchecked,
 * so the tests assert that every group of the unsafe-token module is listed.
 */
export const HOOK_GROUPS: Readonly<Record<SiHook, readonly UnsafeGroup[]>> = {
  [HOOK_TRUST_ALL]: ["argvFlags", "settingsValues", "patterns"],
  [HOOK_AUTO_APPROVE]: ["argvFlags", "envNames", "settingsValues", "patterns"],
};

/** The only files that may hold an unsafe token (SI-1 / SI-2 "Allowed locations"). */
export const TOKEN_ALLOWED_FILES: readonly string[] = [
  "packages/protocol/src/unsafe.ts",
  "packages/protocol/templates/claude-terminal-guard.json",
];

const MARKER_ALLOWED_PREFIXES: readonly string[] = [
  "packages/protocol/",
  "apps/node/src/autopilot/",
];

const ALLOW_UNVERIFIED_PREFIXES: readonly string[] = [
  "packages/protocol/",
  "apps/web/",
  "apps/watch-zepp/",
  "apps/desktop/",
  "apps/node/src/autopilot/",
];

/** Lines after the statement start that may carry the `allow_` option. */
const STATEMENT_LOOKAHEAD = 8;

// Patterns are assembled from fragments so that this file does not hold them.
const MARKER_RE = new RegExp(["\\bby\\s*:\\s*", "[\"'`]", "auto", "pilot", "[\"'`]"].join(""));
const APPROVAL_TYPE_RE = new RegExp(["approval", "\\.", "(?:answer|respond)", "\\b"].join(""));
const ALLOW_OPTION_RE = new RegExp(["\\ballow", "_", "[a-z]"].join(""));

const TEXT_EXTENSIONS: ReadonlySet<string> = new Set([
  "ts",
  "tsx",
  "mts",
  "cts",
  "js",
  "mjs",
  "cjs",
  "json",
  "yml",
  "yaml",
  "toml",
  "sh",
]);

const SKIPPED_SEGMENTS: ReadonlySet<string> = new Set(["node_modules", "dist", ".git"]);
const EXCLUDED_PREFIXES: readonly string[] = [
  "packages/fakes/",
  "spike/",
  "fixtures/",
  "docs/",
  ".kiro/",
];

function posix(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

/** R12.5: product code, minus the scanner skips and non-text file types. */
export function isProductCode(rel: string): boolean {
  const p = posix(rel);
  const parts = p.split("/");
  const base = parts[parts.length - 1] ?? "";
  if (parts.some((s) => SKIPPED_SEGMENTS.has(s) || s === "test")) return false;
  if (EXCLUDED_PREFIXES.some((x) => p.startsWith(x))) return false;
  if (/\.test\.[cm]?[jt]sx?$/.test(base) || base.endsWith(".md")) return false;
  if (p.startsWith(".githooks/") && parts.length === 2 && !base.includes(".")) return true;
  const dot = base.lastIndexOf(".");
  return dot > 0 && TEXT_EXTENSIONS.has(base.slice(dot + 1));
}

/** Distinct groups that match anywhere in `line`, restricted to `groups`. */
function groupsInLine(line: string, groups: readonly UnsafeGroup[]): UnsafeGroup[] {
  const found = new Set<UnsafeGroup>();
  let offset = 0;
  while (offset <= line.length) {
    const m = findUnsafeToken(line.slice(offset));
    if (m === null) break;
    if (groups.includes(m.group)) found.add(m.group);
    offset += m.index + 1;
  }
  return [...found];
}

/** Findings for one file. Never carries matched text. */
export function checkSiSource(hook: SiHook, rel: string, text: string): Finding[] {
  const file = posix(rel);
  if (!isProductCode(file)) return [];
  const out: Finding[] = [];
  const lines = text.split(/\r\n|\r|\n/);
  const tokenAllowed = TOKEN_ALLOWED_FILES.includes(file);
  const groups = HOOK_GROUPS[hook];
  const markerAllowed = MARKER_ALLOWED_PREFIXES.some((x) => file.startsWith(x));
  const allowUnverifiedOk = ALLOW_UNVERIFIED_PREFIXES.some((x) => file.startsWith(x));

  lines.forEach((line, i) => {
    const n = i + 1;
    if (!tokenAllowed) {
      for (const g of groupsInLine(line, groups)) {
        out.push({ file, line: n, rule: `si/${hook}/${g}` });
      }
    }
    if (hook !== HOOK_AUTO_APPROVE) return;
    if (!markerAllowed && MARKER_RE.test(line)) {
      out.push({ file, line: n, rule: `si/${hook}/autopilot-marker` });
    }
    if (!allowUnverifiedOk && APPROVAL_TYPE_RE.test(line)) {
      const end = Math.min(lines.length, i + 1 + STATEMENT_LOOKAHEAD);
      if (lines.slice(i, end).some((l) => ALLOW_OPTION_RE.test(l))) {
        out.push({ file, line: n, rule: `si/${hook}/allow-unverified` });
      }
    }
  });
  return out;
}

/** Scans every product file under `root`. `generated/` is not exempt (O4). */
export function checkSiTree(hook: SiHook, root: string): Finding[] {
  const files = walkFiles({ root, dirs: ["."], skipDirNames: SKIPPED_SEGMENTS }).filter(
    isProductCode,
  );
  const out: Finding[] = [];
  for (const rel of files) {
    let text: string;
    try {
      text = readFileSync(resolve(root, rel), "utf8");
    } catch {
      throw new ToolError("unreadable file", rel);
    }
    out.push(...checkSiSource(hook, rel, text));
  }
  return out;
}
