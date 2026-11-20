import { mkdirSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { SpikeMeta } from "../tools/lib/spike-meta.ts";
import {
  type ApprovalPolicy,
  askOwner,
  type PermissionAnswer,
  type PermissionRequest,
} from "./lib/approval.ts";
import {
  type BudgetLedger,
  canStart,
  readLedger,
  reserve,
  settle,
  writeLedger,
} from "./lib/budget.ts";
import { type ChildHandle, cleanupRun } from "./lib/cleanup.ts";
import { buildChildEnv, type EnvProfile } from "./lib/env.ts";
import { createEvidenceWriter, type EvidenceIndex, EvidenceSecretError } from "./lib/evidence.ts";
import { createHc, type Hc, markPreflightPassed } from "./lib/hc.ts";
import { locate, OWNER_LIST, type SpikeId } from "./lib/ids.ts";
import { type ReadMetaResult, readSpikeMeta } from "./lib/meta.ts";
import { observeLockHeld, runObserve } from "./lib/observe.ts";
import { dependencyNote, orderBatch, runByGate } from "./lib/order.ts";
import {
  EXIT,
  type ResultValue,
  type SharedSession,
  type SpikeContext,
  type SpikeModule,
  type SpikeOutcome,
} from "./lib/outcome.ts";
import { newNonce, type OwnMarker, pidAlive, readMarker, writeMarker } from "./lib/own-marker.ts";
import {
  formatPreflight,
  type GatherOptions,
  gatherPreflightInput,
  type PreflightInput,
  runPreflight,
} from "./lib/preflight.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_ROOT_PREFIX = "/tmp/hcw";
const SUBCOMMANDS = ["list", "record", "budget"] as const;

export interface RunArgs {
  ids: SpikeId[];
  observeDefault: boolean;
  subcommand?: "list" | "record" | "budget";
  /** Arguments after the subcommand (for `record` and `budget`). */
  rest: string[];
}

function isSpikeId(s: string): s is SpikeId {
  return (OWNER_LIST as readonly string[]).includes(s);
}

export function parseArgs(argv: string[]): RunArgs | { error: string } {
  const known = `known ids: ${OWNER_LIST.join(", ")}`;
  const first = argv[0];
  if (first !== undefined && (SUBCOMMANDS as readonly string[]).includes(first)) {
    return {
      ids: [],
      observeDefault: false,
      subcommand: first as (typeof SUBCOMMANDS)[number],
      rest: argv.slice(1),
    };
  }
  const ids: SpikeId[] = [];
  let observeDefault = false;
  for (const raw of argv) {
    if (raw === "--observe-default") {
      observeDefault = true;
      continue;
    }
    if (raw.startsWith("-")) return { error: `unknown option; ${known}` };
    const id = raw.toLowerCase();
    if (!isSpikeId(id)) return { error: `unknown spike id; ${known}` };
    if (!ids.includes(id)) ids.push(id);
  }
  if (ids.length === 0) return { error: `no spike id given; ${known}` };
  if (observeDefault && !(ids.length === 1 && ids[0] === "q14")) {
    return { error: "--observe-default is only for q14" };
  }
  return { ids, observeDefault, rest: [] };
}

export interface SignalHost {
  on(sig: "SIGINT" | "SIGTERM", handler: () => void): void;
  off(sig: "SIGINT" | "SIGTERM", handler: () => void): void;
  /** Called by a second signal: leaves at once. */
  exit(code: number): void;
}

export interface RunIo {
  stdinIsTTY: boolean;
  stdoutIsTTY: boolean;
  env: NodeJS.ProcessEnv;
  now: () => Date;
  out: (line: string) => void;
  err: (line: string) => void;
  /** Loads the module of a spike; tests inject their own. */
  load: (q: SpikeId) => Promise<SpikeModule>;
  /** `pnpm spike record ...`; receives the arguments after `record`. */
  record: (args: string[]) => Promise<number> | number;
  /** `pnpm spike budget ...`; receives the arguments after `budget`. */
  budget: (args: string[]) => Promise<number> | number;
  /** Repo root that holds `spike/`. Default: this checkout. */
  repoRoot?: string;
  /** Parent folder of every Spike_Root. Default `/tmp/hcw`; tests use a folder under `os.tmpdir()`. */
  rootPrefix?: string;
  /** Budget ledger file. Default `<repoRoot>/spike/budget-ledger.json`. */
  ledgerPath?: string;
  /** Local calendar day `YYYY-MM-DD`. Default: from `now`. */
  today?: string;
  /** Replaces the metadata reader. */
  readMeta?: (q: SpikeId) => ReadMetaResult;
  /** Replaces `gatherPreflightInput` (which runs `hc --version`). */
  gatherPreflight?: (
    q: string,
    env: NodeJS.ProcessEnv,
    opts: GatherOptions,
  ) => Promise<PreflightInput>;
  /** Replaces `createHc`. */
  makeHc?: (i: {
    session: string;
    root: string;
    baseEnv: NodeJS.ProcessEnv;
    marker: OwnMarker;
  }) => Hc;
  /** Replaces the owner prompt for permission requests. */
  approve?: (req: PermissionRequest, policy: ApprovalPolicy) => Promise<PermissionAnswer>;
  /** Names of environment variables the `agent` profile may pass. Default none. */
  agentEnvNames?: string[];
  signals?: SignalHost;
}

const processSignals: SignalHost = {
  on: (sig, h) => {
    process.on(sig, h);
  },
  off: (sig, h) => {
    process.off(sig, h);
  },
  exit: (code) => process.exit(code),
};

export function defaultRunIo(): RunIo {
  const ledgerPath = join(REPO_ROOT, "spike/budget-ledger.json");
  return {
    stdinIsTTY: process.stdin.isTTY === true,
    stdoutIsTTY: process.stdout.isTTY === true,
    env: process.env,
    now: () => new Date(),
    out: (l) => {
      process.stdout.write(`${l}\n`);
    },
    err: (l) => {
      process.stderr.write(`${l}\n`);
    },
    async load(q) {
      const url = pathToFileURL(join(REPO_ROOT, locate(q).script)).href;
      const mod = (await import(url)) as Partial<SpikeModule>;
      if (typeof mod.run !== "function") throw new Error("spike module has no run()");
      return { run: mod.run };
    },
    record: (args) => {
      process.stderr.write(`record is not wired yet (${args.length} arguments ignored)\n`);
      return EXIT.INTERNAL;
    },
    async budget(args) {
      const { budgetCommand } = await import("./lib/budget-cli.ts");
      const d = new Date();
      return budgetCommand(args, {
        ledgerPath,
        today: localDay(d),
        out: (l) => {
          process.stdout.write(`${l}\n`);
        },
        err: (l) => {
          process.stderr.write(`${l}\n`);
        },
      });
    },
    signals: processSignals,
  };
}

function localDay(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function realOr(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

function emptyLedger(): BudgetLedger {
  return { v: 1, days: {} };
}

function readLedgerOrEmpty(path: string): BudgetLedger {
  try {
    return readLedger(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptyLedger();
    throw err;
  }
}

function listCommand(io: RunIo): number {
  const read = io.readMeta ?? ((q: SpikeId) => readSpikeMeta(q, io.repoRoot ?? REPO_ROOT));
  for (const q of OWNER_LIST) {
    const r = read(q);
    if (r.ok) io.out(`${q}  run-by ${r.meta.runBy}  group ${r.meta.group}  ${locate(q).dir}`);
    else io.out(`${q}  run-by ?  group ?  ${locate(q).dir}  (metadata not readable)`);
  }
  return EXIT.OK;
}

/** Stale roots: a valid marker whose runner pid is dead (R3.6). */
function staleMarkers(prefix: string): OwnMarker[] {
  let names: string[];
  try {
    names = readdirSync(prefix);
  } catch {
    return [];
  }
  const out: OwnMarker[] = [];
  for (const n of names) {
    if (n.startsWith(".")) continue;
    const m = readMarker(join(prefix, n));
    if (m !== null && !pidAlive(m.runnerPid)) out.push(m);
  }
  return out;
}

function validOutcome(o: SpikeOutcome): string | null {
  if (!["PASS", "FAIL", "PARTIAL", "pending"].includes(o.result)) return "invalid result value";
  if ((o.result === "PARTIAL" || o.result === "pending") && !o.reason) return "reason missing";
  return null;
}

/** Runs one invocation of `pnpm spike`. Returns the exit code. */
export async function main(argv: string[], io: RunIo): Promise<number> {
  const args = parseArgs(argv);
  if ("error" in args) {
    io.err(args.error);
    return EXIT.INTERNAL;
  }
  if (args.subcommand === "list") return listCommand(io);
  if (args.subcommand === "record") return await io.record(args.rest);
  if (args.subcommand === "budget") return await io.budget(args.rest);

  const repoRoot = io.repoRoot ?? REPO_ROOT;
  const rootPrefix = io.rootPrefix ?? DEFAULT_ROOT_PREFIX;

  if (args.observeDefault) {
    const r = await runObserve({
      stdinIsTTY: io.stdinIsTTY,
      stdoutIsTTY: io.stdoutIsTTY,
      baseEnv: io.env,
      rootsDir: rootPrefix,
      print: io.out,
    });
    if (r.ok) return EXIT.OK;
    io.err(`observe: ${r.reason}`);
    return r.reason === "needs interactive terminal" ? EXIT.PENDING : EXIT.INTERNAL;
  }

  if (observeLockHeld(rootPrefix)) {
    io.err("an Observe_Mode run holds the lock; no other spike starts now");
    return EXIT.INTERNAL;
  }

  // Cleanup state shared with the signal handlers.
  let marker: OwnMarker | null = null;
  let runHc: Hc | null = null;
  let cleanupPromise: Promise<{ stopped: boolean; removed: boolean }> | null = null;
  const children: ChildHandle[] = [];
  const prefixes = (): string[] => [...new Set([rootPrefix, realOr(rootPrefix)])];
  const cleanupOnce = async (): Promise<{ stopped: boolean; removed: boolean } | null> => {
    if (marker === null) return null;
    cleanupPromise ??= cleanupRun({
      hc: runHc,
      marker,
      children,
      rootPrefixes: prefixes(),
      log: io.err,
    });
    return await cleanupPromise;
  };

  const signals = io.signals ?? processSignals;
  let interrupted: number | null = null;
  let signalCount = 0;
  let resolveSignal: (code: number) => void = () => {};
  const signalDone = new Promise<number>((r) => {
    resolveSignal = r;
  });
  const handlerFor = (code: number) => (): void => {
    signalCount += 1;
    if (signalCount > 1) {
      signals.exit(code);
      return;
    }
    interrupted = code;
    cleanupOnce().then(
      () => resolveSignal(code),
      () => resolveSignal(code),
    );
  };
  const onInt = handlerFor(130);
  const onTerm = handlerFor(143);
  signals.on("SIGINT", onInt);
  signals.on("SIGTERM", onTerm);

  const pipeline = async (): Promise<number> => {
    const first = args.ids[0] as SpikeId;
    const read = io.readMeta ?? ((q: SpikeId) => readSpikeMeta(q, repoRoot));

    // Metadata blocks (R4.2).
    const metas: Record<string, SpikeMeta> = {};
    for (const q of args.ids) {
      const r = read(q);
      if (!r.ok) {
        io.err(`${q}: refused, ${r.reason}`);
        return EXIT.INTERNAL;
      }
      metas[q] = r.meta;
    }

    const ordered = orderBatch(args.ids, metas);
    if (ordered.error !== undefined) {
      io.err(ordered.error);
      return EXIT.INTERNAL;
    }
    for (const w of ordered.warnings) io.out(`warning: ${w}`);

    // Run_By gate (R6.10).
    const runIds: SpikeId[] = [];
    let anyPending = false;
    for (const q of ordered.order) {
      const g = runByGate(metas[q] as SpikeMeta, {
        stdinTty: io.stdinIsTTY,
        stdoutTty: io.stdoutIsTTY,
      });
      if (g.go) runIds.push(q);
      else {
        anyPending = true;
        io.out(`${q}: pending (${g.reason})`);
      }
    }
    if (runIds.length === 0) return EXIT.PENDING;

    const interactive = io.stdinIsTTY && io.stdoutIsTTY;
    const day = io.today ?? localDay(io.now());
    const ledgerPath = io.ledgerPath ?? join(repoRoot, "spike/budget-ledger.json");

    // Budget gate: reserve before the first prompt (R9).
    const runMetas = runIds.map((q) => metas[q] as SpikeMeta);
    const kiroHi = runMetas.reduce((n, m) => n + (m.estimateCredits?.hi ?? 0), 0);
    const claudePrompts = runMetas.reduce((n, m) => n + m.claudePrompts, 0);
    const spendsBudget = runMetas.some((m) => m.cost !== "none");
    let batchId: string | null = null;
    if (spendsBudget) {
      let ledger: BudgetLedger;
      try {
        ledger = readLedgerOrEmpty(ledgerPath);
      } catch {
        io.err("budget ledger could not be read");
        return EXIT.BUDGET;
      }
      const gate = canStart(ledger, day, { kiroHi, claudePrompts }, { interactive });
      if (!gate.ok) {
        io.err(`budget: ${gate.code}: ${gate.message}`);
        return EXIT.BUDGET;
      }
      batchId = `${day}-${first}-${(ledger.days[day]?.batches.length ?? 0) + 1}`;
      writeLedger(
        ledgerPath,
        reserve(ledger, day, {
          id: batchId,
          spikes: runIds,
          estimateHi: kiroHi,
          claudePrompts,
        }),
      );
    }

    let promptsTotal = 0;
    let code: number = EXIT.OK;
    try {
      // Preflight: failure prints ids only (R2).
      const gather =
        io.gatherPreflight ??
        ((q: string, env: NodeJS.ProcessEnv, o: GatherOptions) => gatherPreflightInput(q, env, o));
      const pre = await gather(first, io.env, { rootPrefix, repoRoot });
      const report = runPreflight(pre, { buildChildEnv });
      if (!report.ok) {
        io.err(formatPreflight(report, pre));
        return EXIT.PREFLIGHT;
      }
      markPreflightPassed();

      const makeHc =
        io.makeHc ??
        ((i: { session: string; root: string; baseEnv: NodeJS.ProcessEnv; marker: OwnMarker }) =>
          createHc({ mode: "normal", ...i }));

      // Stale roots from earlier runs, then our own root and marker (R3.6, D6).
      mkdirSync(rootPrefix, { recursive: true, mode: 0o700 });
      for (const stale of staleMarkers(rootPrefix)) {
        const staleHc = makeHc({
          session: stale.session,
          root: stale.root,
          baseEnv: io.env,
          marker: stale,
        });
        const r = await cleanupRun({
          hc: staleHc,
          marker: stale,
          children: [],
          rootPrefixes: prefixes(),
          log: io.err,
        });
        if (!r.stopped && stale.root === realOr(pre.root)) return EXIT.CLEANUP_UNCONFIRMED;
      }
      if (interrupted !== null) return interrupted;

      mkdirSync(pre.root, { recursive: true, mode: 0o700 });
      const own: OwnMarker = {
        v: 1,
        session: pre.session,
        qs: [...runIds],
        root: realpathSync(pre.root),
        runnerPid: process.pid,
        startedAt: io.now().toISOString(),
        nonce: newNonce(),
        pids: [],
        agentFiles: [],
      };
      writeMarker(own);
      marker = own;
      runHc = makeHc({ session: pre.session, root: pre.root, baseEnv: io.env, marker: own });

      const results = new Map<string, ResultValue>();
      const shared = new Map<string, SharedSession>();
      const openSteps: string[] = [];
      for (const q of runIds) {
        const m = metas[q] as SpikeMeta;
        const target = m.shares !== null && runIds.includes(m.shares as SpikeId) ? m.shares : null;
        const key = target ?? q;
        if ((target !== null || runIds.some((o) => metas[o]?.shares === q)) && !shared.has(key)) {
          shared.set(key, { owner: key as SpikeId, data: {} });
        }
      }

      for (const q of runIds) {
        if (interrupted !== null) return interrupted;
        const meta = metas[q] as SpikeMeta;
        for (const dep of [...meta.depends, ...(meta.shares === null ? [] : [meta.shares])]) {
          const note = dependencyNote(dep as SpikeId, results.get(dep) ?? null);
          if (note !== null) io.out(`${q}: ${note}`);
        }

        const scratch = join(own.root, q);
        mkdirSync(scratch, { recursive: true, mode: 0o700 });
        const recorded: string[] = [];
        const evidence = createEvidenceWriter({
          evidenceRoot: join(repoRoot, locate(q).evidenceRoot),
          q,
          now: io.now,
          env: io.env,
        });
        const policy: ApprovalPolicy = {
          kind: interactive ? "ask-owner" : "reject-all",
          allowAlways: meta.allowAlways,
          timeoutMs: 120_000,
        };
        const ctx: SpikeContext = {
          q,
          meta,
          root: own.root,
          session: pre.session,
          scratch,
          hc: runHc,
          env: (profile: EnvProfile) =>
            buildChildEnv({
              base: io.env,
              profile,
              session: pre.session,
              root: pre.root,
              extraPass: profile === "agent" ? (io.agentEnvNames ?? []) : [],
            }),
          evidence,
          approval: (req) =>
            io.approve !== undefined
              ? io.approve(req, policy)
              : askOwner(req, policy, { stdin: process.stdin, stdout: process.stdout }),
          shared: shared.get(meta.shares ?? q) ?? null,
          humanStep(id, text) {
            io.out(`human step ${id}: ${text}`);
            if (!recorded.includes(id)) recorded.push(id);
          },
          now: io.now,
          interactive,
        };

        let outcome: SpikeOutcome;
        try {
          const mod = await io.load(q);
          outcome = await mod.run(ctx);
          const bad = validOutcome(outcome);
          if (bad !== null) {
            io.err(`${q}: outcome refused, ${bad}`);
            code = EXIT.INTERNAL;
            break;
          }
          for (const id of recorded) {
            if (!outcome.openHumanSteps.includes(id)) outcome.openHumanSteps.push(id);
          }
          const versions: EvidenceIndex["versions"] = { node: process.version };
          if (pre.hcVersion !== null) versions.hc = pre.hcVersion;
          await evidence.finish(outcome, { id: q, runBy: meta.runBy, interactive }, versions);
        } catch (err) {
          if (err instanceof EvidenceSecretError) {
            io.err(`${q}: secret in evidence (${err.cls}); the file was deleted`);
            code = err.exitCode;
          } else {
            io.err(`${q}: failed with an internal error`);
            code = EXIT.INTERNAL;
          }
          break;
        }
        results.set(q, outcome.result);
        promptsTotal += outcome.promptsSent;
        openSteps.push(...outcome.openHumanSteps);
        if (outcome.result === "pending") anyPending = true;
        io.out(`${q}: ${outcome.result} (evidence ${evidence.stamp})`);
      }

      if (openSteps.length > 0) {
        io.out(`open human steps: ${[...new Set(openSteps)].join(", ")}`);
      }
      if (code === EXIT.OK && anyPending) code = EXIT.PENDING;
      return code;
    } finally {
      try {
        await cleanupOnce();
      } catch {
        io.err("cleanup failed");
      }
      if (batchId !== null) {
        try {
          writeLedger(
            ledgerPath,
            settle(readLedgerOrEmpty(ledgerPath), day, batchId, promptsTotal),
          );
        } catch {
          io.err("budget settle failed");
        }
      }
    }
  };

  try {
    // The pipeline's finally block has run the cleanup; its result decides exit 30.
    const run = pipeline().then(async (c) => {
      const r = marker === null ? null : await cleanupOnce();
      if (r !== null && !r.stopped && (c === EXIT.OK || c === EXIT.PENDING)) {
        return EXIT.CLEANUP_UNCONFIRMED;
      }
      return c;
    });
    return await Promise.race([run, signalDone]);
  } catch {
    io.err("runner failed with an internal error");
    return EXIT.INTERNAL;
  } finally {
    signals.off("SIGINT", onInt);
    signals.off("SIGTERM", onTerm);
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2), defaultRunIo()).then(
    (code) => {
      process.exitCode = code;
    },
    () => {
      process.exitCode = EXIT.INTERNAL;
    },
  );
}
