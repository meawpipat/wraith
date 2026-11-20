// spike-meta
// id: q1
// group: A
// cost: none
// run-by: loop
// agents:
// max-prompts: 0
// max-wall-seconds: 2400
// estimate-credits: none
// claude-prompts: 0
// human: HS-S1, HS-S5
// depends: q2
// shares: none
// allow-always: never
// assumption:
// end-spike-meta

import { execFile } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pidIsOwn } from "../../lib/cleanup.ts";
import type { Hc } from "../../lib/hc.ts";
import type { CriterionRecord, SpikeContext, SpikeOutcome } from "../../lib/outcome.ts";
import { cpuSeconds, increasePoints } from "./metrics.ts";

/** Pass thresholds (R13.3). */
export const MAX_INCREASE_POINTS = 5;
export const MAX_PAYLOAD_BYTES = 64 * 1024;

export const BRANCH_POLL_SLOWER = "poll 1 s";
export const BRANCH_LINE_DIFFS = "send only line diffs (Q20)";
export const BRANCH_AS_DESIGNED = "keep terminal.read at 250 ms";

export const CLI_CAVEAT =
  "The CLI `read` starts one hc process per read; the figures cover the Test_Core only, not those short-lived client processes.";

export interface Q1Verdict {
  result: "PASS" | "FAIL";
  branch: string;
  cpuOk: boolean;
  payloadOk: boolean;
}

/** Pure: PASS when the increase is below 5 points and the largest payload below 64 KB. */
export function q1Verdict(increase: number, maxPayloadBytes: number): Q1Verdict {
  const cpuOk = increase < MAX_INCREASE_POINTS;
  const payloadOk = maxPayloadBytes < MAX_PAYLOAD_BYTES;
  const branches: string[] = [];
  if (!cpuOk) branches.push(BRANCH_POLL_SLOWER);
  if (!payloadOk) branches.push(BRANCH_LINE_DIFFS);
  return {
    result: cpuOk && payloadOk ? "PASS" : "FAIL",
    branch: branches.length === 0 ? BRANCH_AS_DESIGNED : branches.join("; "),
    cpuOk,
    payloadOk,
  };
}

/** The full-screen program: `htop` when on PATH, else `top -s 1` (D17, OQ-7). */
export function chooseProgram(htopOnPath: boolean): {
  argv: string[];
  substitute: boolean;
  label: string;
} {
  return htopOnPath
    ? { argv: ["htop"], substitute: false, label: "htop" }
    : {
        argv: ["top", "-s", "1"],
        substitute: true,
        label: "top -s 1 (substitute, htop not on PATH)",
      };
}

/** Pids named by `server status` output: JSON keys `pid`/`pids`, else `pid <n>` text. */
export function pidsFromStatus(text: string): number[] {
  const out = new Set<number>();
  const add = (n: unknown): void => {
    if (typeof n === "number" && Number.isInteger(n) && n > 0) out.add(n);
  };
  const walk = (x: unknown): void => {
    if (Array.isArray(x)) {
      for (const v of x) walk(v);
    } else if (typeof x === "object" && x !== null) {
      for (const [k, v] of Object.entries(x)) {
        if (/^pids?$/i.test(k)) {
          for (const n of Array.isArray(v) ? v : [v]) add(n);
        } else walk(v);
      }
    }
  };
  try {
    walk(JSON.parse(text));
  } catch {
    for (const m of text.matchAll(/\bpid\D{0,4}(\d+)/gi)) add(Number(m[1]));
  }
  return [...out];
}

export interface Q1Options {
  baselineMs: number;
  readEveryMs: number;
  durationMs: number;
  settleMs: number;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  isOnPath: (program: string) => boolean;
  /** cputime in seconds per pid; a pid that is gone is left out. */
  cpuOf: (pids: readonly number[]) => Promise<Map<number, number>>;
  cmdlineOf: (pid: number) => Promise<string>;
  schemaExists: () => boolean;
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function onPath(program: string): boolean {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (dir !== "" && existsSync(join(dir, program))) return true;
  }
  return false;
}

function psOut(args: string[]): Promise<string> {
  return new Promise((res) => {
    execFile("ps", args, { encoding: "utf8" }, (err, out) => res(err ? "" : out));
  });
}

async function defaultCpuOf(pids: readonly number[]): Promise<Map<number, number>> {
  const m = new Map<number, number>();
  for (const pid of pids) {
    const s = cpuSeconds(await psOut(["-o", "cputime=", "-p", String(pid)]));
    if (Number.isFinite(s)) m.set(pid, s);
  }
  return m;
}

export const DEFAULT_OPTIONS: Q1Options = {
  baselineMs: 60_000,
  readEveryMs: 250,
  durationMs: 300_000,
  settleMs: 2_000,
  now: () => performance.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  isOnPath: onPath,
  cpuOf: defaultCpuOf,
  cmdlineOf: (pid) => psOut(["-o", "command=", "-p", String(pid)]),
  schemaExists: () => existsSync(join(REPO_ROOT, "spike/hc/schema.json")),
};

function realOr(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/** Sum of the cputime deltas of pids present in both maps. */
function cpuDelta(a: Map<number, number>, b: Map<number, number>): number {
  let sum = 0;
  for (const [pid, end] of b) {
    const start = a.get(pid);
    if (start !== undefined) sum += Math.max(0, end - start);
  }
  return sum;
}

async function ownPids(hc: Hc, root: string, o: Q1Options): Promise<number[]> {
  const r = await hc.run(["server", "status"], { timeoutMs: 10_000 });
  const statusPids = pidsFromStatus(r.stdout);
  const roots = [root, realOr(root)];
  const own: number[] = [];
  for (const pid of statusPids) {
    const cmd = await o.cmdlineOf(pid);
    if (roots.some((rt) => pidIsOwn(pid, [], statusPids, cmd, rt))) own.push(pid);
  }
  return own;
}

function terminalId(stdout: string): string | null {
  return /\bt\d+\b/.exec(stdout)?.[0] ?? null;
}

function pending(
  reason: string,
  criteria: CriterionRecord[],
  notes: string[],
  open: string[],
): SpikeOutcome {
  return {
    result: "PARTIAL",
    reason,
    criteria,
    affects: ["S-console"],
    openHumanSteps: open,
    promptsSent: 0,
    notes,
  };
}

export async function runQ1(ctx: SpikeContext, o: Q1Options): Promise<SpikeOutcome> {
  const hc = ctx.hc;
  if (hc === null) throw new Error("q1 needs hc");
  const notes: string[] = [CLI_CAVEAT];
  const open = ["HS-S5"];
  const program = chooseProgram(o.isOnPath("htop"));
  if (program.substitute) {
    notes.push(`Full-screen program: ${program.label}; the htop run stays optional (OQ-7, D17).`);
    ctx.humanStep(
      "HS-S1",
      "Optional: install htop and rerun Q1 to compare with the top substitute.",
    );
    open.push("HS-S1");
  } else {
    notes.push("Full-screen program: htop.");
  }
  notes.push(
    o.schemaExists()
      ? "Q2 schema.json is present; the read form follows it."
      : "Q2 schema.json is absent; the CLI forms `run -- <program>` and `read <id>` are assumed.",
  );
  notes.push("Herdr.app and Herdr Core app behaviour: unobserved (HS-S5).");

  const own = await ownPids(hc, ctx.root, o);
  if (own.length === 0) {
    return pending("no Test_Core pid passed the own-pid check", [], notes, open);
  }

  const started = await hc.run(["run", "--", ...program.argv], { timeoutMs: 20_000 });
  const id = started.code === 0 ? terminalId(started.stdout) : null;
  if (id === null) {
    return pending("the full-screen pane did not start", [], notes, open);
  }

  const rows: string[] = ["t_ms,bytes,ms,code"];
  let maxBytes = 0;
  let reads = 0;
  let failed = 0;
  let escReads = 0;
  let base: { cpuStart: number; cpuEnd: number; wallSeconds: number };
  let during: { cpuStart: number; cpuEnd: number; wallSeconds: number };
  try {
    await o.sleep(o.settleMs);

    const b0 = await o.cpuOf(own);
    const tb0 = o.now();
    await o.sleep(o.baselineMs);
    const b1 = await o.cpuOf(own);
    const tb1 = o.now();
    base = { cpuStart: 0, cpuEnd: cpuDelta(b0, b1), wallSeconds: (tb1 - tb0) / 1000 };

    const d0 = await o.cpuOf(own);
    const td0 = o.now();
    let next = td0;
    while (o.now() - td0 < o.durationMs) {
      const t = o.now();
      const r = await hc.run(["read", id], { timeoutMs: 10_000 });
      const bytes = Buffer.byteLength(r.stdout, "utf8");
      reads++;
      if (r.code !== 0) failed++;
      if (r.stdout.includes("\u001b")) escReads++;
      if (bytes > maxBytes) maxBytes = bytes;
      rows.push(`${Math.round(t - td0)},${bytes},${r.ms},${r.code ?? ""}`);
      next += o.readEveryMs;
      const wait = next - o.now();
      if (wait > 0) await o.sleep(wait);
    }
    const d1 = await o.cpuOf(own);
    const td1 = o.now();
    during = { cpuStart: 0, cpuEnd: cpuDelta(d0, d1), wallSeconds: (td1 - td0) / 1000 };
  } finally {
    try {
      await hc.run(["kill", id], { timeoutMs: 10_000 });
    } catch {
      // The runner cleanup stops the core and every child anyway.
    }
  }

  const increase = increasePoints(base, during);
  const v = q1Verdict(increase, maxBytes);
  const summary = {
    program: program.label,
    ownPids: own.length,
    reads,
    failedReads: failed,
    readsWithEscapeBytes: escReads,
    maxPayloadBytes: maxBytes,
    baselineCpuSeconds: base.cpuEnd,
    baselineWallSeconds: base.wallSeconds,
    duringCpuSeconds: during.cpuEnd,
    duringWallSeconds: during.wallSeconds,
    increasePoints: Number(increase.toFixed(3)),
    thresholds: { maxIncreasePoints: MAX_INCREASE_POINTS, maxPayloadBytes: MAX_PAYLOAD_BYTES },
    caveat: CLI_CAVEAT,
  };
  await ctx.evidence.addText("samples.csv", `${rows.join("\n")}\n`);
  await ctx.evidence.addText("summary.json", `${JSON.stringify(summary, null, 2)}\n`);
  if (escReads > 0) notes.push(`${escReads} reads contained escape bytes (text was not plain).`);

  const criteria: CriterionRecord[] = [
    {
      id: "cpu-increase",
      ok: v.cpuOk,
      observed: `${increase.toFixed(2)} points of one core over the baseline (limit ${MAX_INCREASE_POINTS})`,
    },
    {
      id: "payload-size",
      ok: v.payloadOk,
      observed: `largest read ${maxBytes} bytes (limit ${MAX_PAYLOAD_BYTES})`,
    },
  ];
  return {
    result: v.result,
    criteria,
    branch: v.branch,
    affects: ["S-console"],
    openHumanSteps: open,
    promptsSent: 0,
    notes,
  };
}

export async function run(ctx: SpikeContext): Promise<SpikeOutcome> {
  return runQ1(ctx, DEFAULT_OPTIONS);
}
