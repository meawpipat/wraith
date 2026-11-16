import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Finding } from "./lib/finding.ts";
import { EXIT_ERROR, EXIT_FINDINGS, EXIT_OK, formatFinding, ToolError } from "./lib/finding.ts";

export type PinProblem =
  | "no-ref"
  | "bad-action"
  | "mutable-ref"
  | "short-sha"
  | "long-sha"
  | "uppercase-sha"
  | "docker-no-digest";

const WORKFLOWS_DIR = ".github/workflows";
const USES_LINE = /^\s*(-\s+)?uses\s*:\s*(.*)$/;
const ACTION_PATH = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)*$/;
const DOCKER_DIGEST = /@sha256:[0-9a-f]{64}$/;
const FULL_SHA = /^[0-9a-f]{40}$/;
const HEX_ONLY = /^[0-9a-fA-F]+$/;

/** Drops a trailing YAML comment: a `#` at line start or after whitespace, outside quotes. */
function stripComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i] as string;
    if (quote !== null) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === "#" && (i === 0 || /\s/.test(line[i - 1] as string))) {
      return line.slice(0, i);
    }
  }
  return line;
}

function unquote(value: string): string {
  const v = value.trim();
  if (v.length >= 2) {
    const first = v[0];
    if ((first === '"' || first === "'") && v.endsWith(first)) return v.slice(1, -1).trim();
  }
  return v;
}

/** Returns the problem of one `uses:` value, or null when it passes. */
function classify(v: string): PinProblem | null {
  if (v.length === 0) return "no-ref";
  if (v.startsWith("./")) return null;
  if (v.startsWith("docker://")) return DOCKER_DIGEST.test(v) ? null : "docker-no-digest";
  const at = v.lastIndexOf("@");
  if (at < 0) return "no-ref";
  if (!ACTION_PATH.test(v.slice(0, at))) return "bad-action";
  const ref = v.slice(at + 1);
  if (FULL_SHA.test(ref)) return null;
  if (HEX_ONLY.test(ref)) {
    if (ref.length < 40) return "short-sha";
    if (ref.length > 40) return "long-sha";
    return "uppercase-sha";
  }
  return "mutable-ref";
}

export function checkWorkflowText(file: string, text: string): Finding[] {
  const findings: Finding[] = [];
  const lines = text.split(/\r\n|\n|\r/);
  for (let i = 0; i < lines.length; i++) {
    const code = stripComment(lines[i] as string);
    if (code.trim().length === 0) continue;
    const m = USES_LINE.exec(code);
    if (m === null) continue;
    const problem = classify(unquote(m[2] as string));
    if (problem !== null) findings.push({ file, line: i + 1, rule: `pin/${problem}` });
  }
  return findings;
}

/** Scans the top level of `<root>/.github/workflows` for `*.yml` and `*.yaml`. */
export function checkWorkflowsDir(root: string): Finding[] {
  const dir = join(root, WORKFLOWS_DIR);
  if (!existsSync(dir)) return [];
  let names: string[];
  try {
    if (!statSync(dir).isDirectory()) throw new ToolError("not a directory", WORKFLOWS_DIR);
    names = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && /\.ya?ml$/.test(e.name))
      .map((e) => e.name)
      .sort();
  } catch (e) {
    if (e instanceof ToolError) throw e;
    throw new ToolError("cannot read workflows directory", WORKFLOWS_DIR);
  }
  const findings: Finding[] = [];
  for (const name of names) {
    const rel = `${WORKFLOWS_DIR}/${name}`;
    let text: string;
    try {
      text = readFileSync(join(dir, name), "utf8");
    } catch {
      throw new ToolError("cannot read workflow file", rel);
    }
    findings.push(...checkWorkflowText(rel, text));
  }
  return findings;
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
      throw new ToolError("usage: check-workflow-pins.ts [--root <dir>]");
    }
  }
  return root;
}

export function main(argv: readonly string[]): number {
  try {
    const findings = checkWorkflowsDir(parseRoot(argv));
    for (const f of findings) console.log(formatFinding(f));
    console.log(
      findings.length === 0
        ? "check-workflow-pins: clean"
        : `check-workflow-pins: ${findings.length} finding(s)`,
    );
    return findings.length === 0 ? EXIT_OK : EXIT_FINDINGS;
  } catch (e) {
    if (e instanceof ToolError) {
      console.error(e.path === undefined ? e.message : `${e.message}: ${e.path}`);
    } else {
      console.error("check-workflow-pins: unexpected error");
    }
    return EXIT_ERROR;
  }
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href) {
  process.exitCode = main(process.argv.slice(2));
}
