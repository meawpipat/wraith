import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findUnsafeToken } from "../../tools/lib/unsafe-tokens.ts";
import { buildChildEnv } from "./env.ts";
import type { CriterionRecord, ResultValue, SpikeOutcome } from "./outcome.ts";
import { type RedactOptions, type RedactResult, redactText } from "./redact.ts";

export interface EvidenceIndex {
  v: 1;
  q: string;
  stamp: string;
  startedAt: string;
  endedAt: string;
  runner: "loop" | "owner";
  interactive: boolean;
  /** Run options that widen what a spike may do. */
  options: { allowHomeProfile: boolean };
  versions: {
    hc?: string;
    kiroCli?: string;
    claudeCode?: string;
    claudeAgentSdk?: string;
    node: string;
  };
  result: ResultValue;
  reason?: string;
  promptsSent: number;
  criteria: CriterionRecord[];
  files: { path: string; bytes: number; sha256: string; redacted: Record<string, number> }[];
  openHumanSteps: string[];
  branch?: string;
  affects: string[];
}

/** Local structural stand-in for the tools `SpikeMeta` type (task 4.1 creates that later). */
export interface FinishMeta {
  id: string;
  runBy: "loop" | "owner";
  interactive?: boolean;
  allowHomeProfile?: boolean;
}

/** The stop condition 8 failure: a secret-shaped or SI-token line reached evidence. Class only. */
export class EvidenceSecretError extends Error {
  readonly cls: string;
  readonly exitCode = 22;

  constructor(cls: string) {
    super(`secret in evidence: ${cls}`);
    this.name = "EvidenceSecretError";
    this.cls = cls;
  }
}

export type Redactor = (input: string, o: RedactOptions) => RedactResult;

export interface EvidenceOptions {
  /** Absolute folder that holds the stamp folders, for example `<repo>/spike/hc/q2/evidence`. */
  evidenceRoot: string;
  q: string;
  /** Repo root that holds `tools/secret-scan.ts`. Defaults to this checkout. */
  toolsRoot?: string;
  now?: () => Date;
  home?: string;
  realHome?: string;
  env?: Readonly<Record<string, string | undefined>>;
  /** Replaceable so a test can prove the scan catches what the redactor missed. */
  redact?: Redactor;
}

const DEFAULT_TOOLS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function pad(n: number, w = 2): string {
  return String(n).padStart(w, "0");
}

/** `YYYYMMDDTHHMMSSZ` in UTC; a `-2`, `-3`, ... suffix when the folder already exists (R5.5). */
export function newStamp(now: Date, exists: (p: string) => boolean, dir: string): string {
  const base = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(
    now.getUTCHours(),
  )}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  if (!exists(join(dir, base))) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!exists(join(dir, candidate))) return candidate;
  }
}

function realOr(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

function resolveRedaction(o: EvidenceOptions, file: string): RedactOptions {
  const home = o.home ?? homedir();
  return {
    file,
    home,
    realHome: o.realHome ?? realOr(home),
    env: o.env ?? process.env,
  };
}

/**
 * Writes `text` to `path`, then runs the secret scan child process and the SI-token check on
 * what is on disk. A finding deletes the file and throws with the class only.
 */
function writeChecked(path: string, text: string, toolsRoot: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, text, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  // A rename replaces a symlink at `path` itself instead of following it.
  renameSync(tmp, path);
  const fail = (e: Error): never => {
    rmSync(path, { force: true });
    throw e;
  };
  const scan = spawnSync(
    process.execPath,
    ["--experimental-strip-types", join(toolsRoot, "tools/secret-scan.ts"), basename(path)],
    {
      cwd: dirname(path),
      env: buildChildEnv({ base: process.env, profile: "tool" }),
      encoding: "utf8",
    },
  );
  if (scan.status === 1) {
    const cls = /secret\/([a-z0-9-]+)/.exec(scan.stdout)?.[1] ?? "unknown";
    fail(new EvidenceSecretError(cls));
  } else if (scan.status !== 0) {
    fail(new Error("evidence secret scan did not run cleanly"));
  }
  const written = readFileSync(path, "utf8");
  for (const line of written.split("\n")) {
    if (findUnsafeToken(line) !== null) fail(new EvidenceSecretError("si-token"));
  }
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function validName(name: string): void {
  if (
    name === "" ||
    name === "index.json" ||
    name.startsWith(".") ||
    name.includes("/") ||
    name.includes("\\") ||
    name.includes("\0")
  ) {
    throw new Error("invalid evidence file name");
  }
}

export interface EvidenceWriter {
  dir: string;
  stamp: string;
  addText(name: string, rawText: string): Promise<void>;
  addJsonl(name: string, rawLines: AsyncIterable<string>): Promise<void>;
  finish(
    outcome: SpikeOutcome,
    meta: FinishMeta,
    versions: EvidenceIndex["versions"],
  ): Promise<EvidenceIndex>;
}

function counts(r: RedactResult): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(r.replaced)) if (v) out[k] = v;
  if (r.homeMasked > 0) out.home = r.homeMasked;
  if (r.envMasked > 0) out.env = r.envMasked;
  return out;
}

export function createEvidenceWriter(o: EvidenceOptions): EvidenceWriter {
  const now = o.now ?? (() => new Date());
  const redact = o.redact ?? redactText;
  const toolsRoot = o.toolsRoot ?? DEFAULT_TOOLS_ROOT;
  const startedAt = now();
  mkdirSync(o.evidenceRoot, { recursive: true });
  const stamp = newStamp(startedAt, existsSync, o.evidenceRoot);
  const dir = join(o.evidenceRoot, stamp);
  mkdirSync(dir, { mode: 0o700 });
  const files: EvidenceIndex["files"] = [];

  const add = (name: string, raw: string): void => {
    validName(name);
    const r = redact(raw, resolveRedaction(o, name));
    writeChecked(join(dir, name), r.text, toolsRoot);
    files.push({
      path: name,
      bytes: Buffer.byteLength(r.text, "utf8"),
      sha256: sha256(r.text),
      redacted: counts(r),
    });
  };

  const oneLine = (s: string): string => redact(s, resolveRedaction(o, "index.json")).text;

  return {
    dir,
    stamp,
    async addText(name, rawText) {
      add(name, rawText);
    },
    async addJsonl(name, rawLines) {
      const lines: string[] = [];
      for await (const l of rawLines) lines.push(l);
      add(name, lines.length === 0 ? "" : `${lines.join("\n")}\n`);
    },
    async finish(outcome, meta, versions) {
      const index: EvidenceIndex = {
        v: 1,
        q: o.q,
        stamp,
        startedAt: startedAt.toISOString(),
        endedAt: now().toISOString(),
        runner: meta.runBy,
        interactive: meta.interactive ?? false,
        options: { allowHomeProfile: meta.allowHomeProfile ?? false },
        versions,
        result: outcome.result,
        promptsSent: outcome.promptsSent,
        criteria: outcome.criteria.map((c) => ({
          id: c.id,
          ok: c.ok,
          observed: oneLine(c.observed),
        })),
        files: [...files],
        openHumanSteps: [...outcome.openHumanSteps],
        affects: [...outcome.affects],
      };
      if (outcome.reason !== undefined) index.reason = oneLine(outcome.reason);
      if (outcome.branch !== undefined) index.branch = oneLine(outcome.branch);
      writeChecked(join(dir, "index.json"), `${JSON.stringify(index, null, 2)}\n`, toolsRoot);
      return index;
    },
  };
}

const NAMED_COPY: Record<"q2" | "q3", string> = {
  q2: "spike/hc/schema.json",
  q3: "spike/kiro/q3.jsonl",
};

export interface NamedCopyOptions extends Omit<EvidenceOptions, "evidenceRoot" | "q"> {
  /** Repo root that receives the named copy. */
  repoRoot: string;
  result: ResultValue;
}

/**
 * Writes a redacted COPY (never a link) of `from` to the §19 path, only for PASS or PARTIAL
 * (D8, A4). Returns whether a copy was written.
 */
export function publishNamedCopy(q: "q2" | "q3", from: string, o: NamedCopyOptions): boolean {
  if (o.result !== "PASS" && o.result !== "PARTIAL") return false;
  const target = join(o.repoRoot, NAMED_COPY[q]);
  const redact = o.redact ?? redactText;
  const r = redact(
    readFileSync(from, "utf8"),
    resolveRedaction({ ...o, evidenceRoot: "", q }, basename(target)),
  );
  try {
    if (lstatSync(target).isSymbolicLink()) rmSync(target, { force: true });
  } catch {
    // No existing target.
  }
  writeChecked(target, r.text, o.toolsRoot ?? DEFAULT_TOOLS_ROOT);
  return true;
}
