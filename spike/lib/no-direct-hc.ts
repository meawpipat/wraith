import { readFileSync } from "node:fs";
import { join } from "node:path";
import { maskComments } from "../../tools/lib/mask.ts";
import { walkFiles } from "../../tools/lib/walk.ts";

const PROGRAMS: ReadonlySet<string> = new Set(["hc", "herdr-core", "hold"]);
const KILLERS: ReadonlySet<string> = new Set(["pkill", "killall"]);
const SHELLS: ReadonlySet<string> = new Set(["sh", "bash", "zsh", "dash"]);
const SHELL_CALLS: ReadonlySet<string> = new Set(["exec", "execSync"]);
const CALL_RE = /(?<![\w$])(spawn|spawnSync|exec|execSync|execFile|execFileSync|fork)\s*\(/g;
const EXEMPT = "spike/lib/hc.ts";

const base = (s: string): string => s.replace(/^.*\//, "");

/** True when a shell string runs one of the programs, or pkill/killall aimed at one. */
function shellHit(str: string): boolean {
  for (const segment of str.split(/&&|\|\||[;|&\n(]/)) {
    const words = segment
      .trim()
      .split(/\s+/)
      .map((w) => w.replace(/^["'`]|["'`]$/g, ""))
      .filter((w) => w !== "");
    while (words.length > 0 && /^[A-Za-z_]\w*=/.test(words[0] ?? "")) words.shift();
    const cmd = base(words[0] ?? "");
    if (PROGRAMS.has(cmd)) return true;
    if (KILLERS.has(cmd) && words.slice(1).some((w) => PROGRAMS.has(w))) return true;
  }
  return false;
}

/** Text of the call arguments and its string literals, from just after the opening paren. */
function readArgs(
  src: string,
  start: number,
): { text: string; literals: string[]; firstIsLiteral: boolean } {
  const literals: string[] = [];
  let depth = 1;
  let i = start;
  while (i < src.length && depth > 0) {
    const ch = src[i] ?? "";
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < src.length && src[j] !== ch) j += src[j] === "\\" ? 2 : 1;
      literals.push(src.slice(i + 1, j));
      i = j + 1;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    i++;
  }
  const rest = src.slice(start, i).trimStart();
  return { text: rest, literals, firstIsLiteral: /^["'`]/.test(rest) };
}

function callHits(fn: string, args: { literals: string[]; firstIsLiteral: boolean }): boolean {
  if (!args.firstIsLiteral) return false;
  const first = args.literals[0] ?? "";
  const rest = args.literals.slice(1);
  if (SHELL_CALLS.has(fn) && shellHit(first)) return true;
  const prog = base(first.trim());
  if (PROGRAMS.has(prog)) return true;
  if (KILLERS.has(prog)) return rest.some((l) => PROGRAMS.has(l.trim()) || shellHit(l));
  if (SHELLS.has(prog)) return rest.some(shellHit);
  return false;
}

/** `<file>:<line>` for each line of `text` where a spawn-family call names hc, herdr-core or hold. */
export function findDirectHcSpawn(file: string, text: string): string[] {
  const path = file.replace(/\\/g, "/");
  if (path === EXEMPT || path.endsWith("/lib/hc.ts") || path === "lib/hc.ts") return [];
  const src = maskComments(text);
  const out: string[] = [];
  for (const m of src.matchAll(CALL_RE)) {
    const idx = m.index ?? 0;
    const args = readArgs(src, idx + m[0].length);
    if (callHits(m[1] ?? "", args)) {
      const line = src.slice(0, idx).split("\n").length;
      out.push(`${path}:${line}`);
    }
  }
  return out;
}

/** Walks `<root>/spike` and returns the violations of every file except `lib/hc.ts`. */
export function scanSpikeTree(root: string): string[] {
  const files = walkFiles({
    root,
    dirs: ["spike"],
    skipDirNames: new Set(["node_modules", "dist", ".git"]),
  });
  const out: string[] = [];
  for (const rel of files) {
    if (!rel.endsWith(".ts") || rel === EXEMPT) continue;
    out.push(...findDirectHcSpawn(rel, readFileSync(join(root, rel), "utf8")));
  }
  return out;
}
