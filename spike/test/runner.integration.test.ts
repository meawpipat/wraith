import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SpikeMeta } from "../../tools/lib/spike-meta.ts";
import { EvidenceSecretError } from "../lib/evidence.ts";
import type { Hc } from "../lib/hc.ts";
import { EXIT, type SpikeModule, type SpikeOutcome } from "../lib/outcome.ts";
import { MARKER_FILE, newNonce, type OwnMarker } from "../lib/own-marker.ts";
import type { PreflightInput } from "../lib/preflight.ts";
import { main, type RunIo, type SignalHost } from "../run.ts";
import { buildSample } from "./support/samples.ts";

let base = "";

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "wraith-runner-")));
});

afterEach(() => {
  rmSync(base, { force: true, recursive: true });
});

const ENV = { PATH: "/usr/bin", HOME: "/home/tester" };
const NOW = new Date(Date.UTC(2026, 10, 18, 9, 5, 7));

function metaFor(q: string, over: Partial<SpikeMeta> = {}): SpikeMeta {
  return {
    id: q,
    group: "A",
    cost: "none",
    runBy: "loop",
    agents: [],
    maxPrompts: 0,
    maxWallSeconds: 60,
    estimateCredits: null,
    claudePrompts: 0,
    human: [],
    depends: [],
    shares: null,
    allowAlways: "never",
    assumption: "",
    ...over,
  };
}

function outcome(over: Partial<SpikeOutcome> = {}): SpikeOutcome {
  return {
    result: "PASS",
    criteria: [{ id: "c1", ok: true, observed: "ok" }],
    affects: [],
    openHumanSteps: [],
    promptsSent: 0,
    notes: [],
    ...over,
  };
}

interface Harness {
  io: RunIo;
  lines: string[];
  hcCalls: string[][];
  hcSessions: string[];
  loaded: string[];
  rootPrefix: string;
  repoRoot: string;
}

function harness(
  opts: {
    metas?: Partial<Record<string, Partial<SpikeMeta>>>;
    modules?: Partial<Record<string, SpikeModule["run"]>>;
    tty?: boolean;
    envHome?: string;
    signals?: SignalHost;
  } = {},
): Harness {
  const rootPrefix = join(base, "hcw");
  const repoRoot = join(base, "repo");
  const lines: string[] = [];
  const hcCalls: string[][] = [];
  const hcSessions: string[] = [];
  const loaded: string[] = [];
  const tty = opts.tty ?? false;
  const io: RunIo = {
    stdinIsTTY: tty,
    stdoutIsTTY: tty,
    env: ENV,
    now: () => NOW,
    out: (l) => {
      lines.push(l);
    },
    err: (l) => {
      lines.push(l);
    },
    load: async (q) => {
      loaded.push(q);
      const run = opts.modules?.[q];
      return { run: run ?? (async () => outcome()) };
    },
    record: () => EXIT.INTERNAL,
    budget: () => EXIT.INTERNAL,
    repoRoot,
    rootPrefix,
    ledgerPath: join(base, "ledger.json"),
    today: "2026-11-18",
    readMeta: (q) => ({ ok: true, meta: metaFor(q, opts.metas?.[q]) }),
    gatherPreflight: async (q): Promise<PreflightInput> => ({
      mode: "normal",
      q,
      env: ENV,
      session: `wsp-${q}`,
      root: join(rootPrefix, q),
      realRoot: join(rootPrefix, q),
      stateHome: `/tmp/hcw/${q}/s`,
      configHome: `/tmp/hcw/${q}/c`,
      realStateHome: `/tmp/hcw/${q}/s`,
      realConfigHome: `/tmp/hcw/${q}/c`,
      hcSocketVar: null,
      socketPaths: [`/tmp/hcw/${q}/s/herdr-core/x`],
      defaultStateDir: "/nonexistent/default-state",
      envHome: opts.envHome ?? "/home/tester",
      realHome: "/home/tester",
      hcVersion: "hc 0.1.20",
      needsHcAtLeast: [0, 1, 18],
      rootState: { kind: "absent" },
      scriptTreeViolations: [],
    }),
    makeHc: (i): Hc => {
      hcSessions.push(i.session);
      return {
        session: i.session,
        mode: "normal",
        run: async (args) => {
          hcCalls.push([...args]);
          return { code: 0, stdout: "{}", stderr: "", ms: 0 };
        },
        spawnLong: () => {
          throw new Error("the fake hc starts no process");
        },
      };
    },
  };
  if (opts.signals !== undefined) io.signals = opts.signals;
  return { io, lines, hcCalls, hcSessions, loaded, rootPrefix, repoRoot };
}

const stopCalls = (h: Harness): number =>
  h.hcCalls.filter((c) => c[0] === "server" && c[1] === "stop").length;

describe("runner integration (fakes)", () => {
  it("ends pending for an owner spike without a terminal and starts nothing", async () => {
    const h = harness({ metas: { q3: { runBy: "owner" } } });
    expect(await main(["q3"], h.io)).toBe(EXIT.PENDING);
    expect(h.lines.join("\n")).toContain("needs interactive terminal");
    expect(h.loaded).toEqual([]);
    expect(h.hcSessions).toEqual([]);
    expect(existsSync(h.rootPrefix)).toBe(false);
  });

  it("exits 1 on an unknown id, lists the known ids and starts nothing", async () => {
    const h = harness();
    expect(await main(["nope"], h.io)).toBe(EXIT.INTERNAL);
    expect(h.lines.join("\n")).toContain("q43");
    expect(h.hcSessions).toEqual([]);
    expect(existsSync(h.rootPrefix)).toBe(false);
  });

  it("cleans its root after a batch and keeps the evidence", async () => {
    const order: string[] = [];
    const h = harness({
      modules: {
        q2: async (ctx) => {
          order.push(ctx.q);
          writeFileSync(join(ctx.scratch, "work.txt"), "x");
          return outcome();
        },
        q13: async (ctx) => {
          order.push(ctx.q);
          return outcome();
        },
      },
    });
    expect(await main(["q2", "q13"], h.io)).toBe(EXIT.OK);
    expect(order).toEqual(["q2", "q13"]);
    expect(h.hcSessions).toEqual(["wsp-q2"]);
    expect(stopCalls(h)).toBe(1);
    expect(existsSync(join(h.rootPrefix, "q2"))).toBe(false);
    const evidence = join(h.repoRoot, "spike/hc/q2/evidence");
    const stamp = readdirSync(evidence)[0] as string;
    expect(existsSync(join(evidence, stamp, "index.json"))).toBe(true);
  });

  it("cleans a stale root with a dead pid, and its agent file, before a new run", async () => {
    const dead = spawnSync(process.execPath, ["-e", ""]);
    const deadPid = dead.pid;
    const root = join(base, "hcw", "q2");
    mkdirSync(root, { recursive: true });
    const agentFile = join(base, "agents", "wraith-spike-q2.json");
    mkdirSync(join(base, "agents"));
    writeFileSync(agentFile, "{}");
    const stale: OwnMarker = {
      v: 1,
      session: "wsp-q2",
      qs: ["q2"],
      root: realpathSync(root),
      runnerPid: deadPid,
      startedAt: NOW.toISOString(),
      nonce: newNonce(),
      pids: [],
      agentFiles: [{ path: agentFile, created: true }],
    };
    writeFileSync(join(root, MARKER_FILE), JSON.stringify(stale));
    writeFileSync(join(root, "leftover.txt"), "x");

    const seen: boolean[] = [];
    const h = harness({
      modules: {
        q2: async (ctx) => {
          seen.push(existsSync(join(ctx.root, "leftover.txt")), existsSync(agentFile));
          return outcome();
        },
      },
    });
    expect(await main(["q2"], h.io)).toBe(EXIT.OK);
    expect(seen).toEqual([false, false]);
    expect(h.hcSessions).toEqual(["wsp-q2", "wsp-q2"]);
    expect(stopCalls(h)).toBe(2);
  });

  it("exits 20 on a preflight failure, prints ids only and starts nothing", async () => {
    const h = harness({ envHome: "/home/someone-else" });
    expect(await main(["q2"], h.io)).toBe(EXIT.PREFLIGHT);
    const text = h.lines.join("\n");
    expect(text).toContain("PF-HOME");
    expect(h.hcSessions).toEqual([]);
    expect(h.loaded).toEqual([]);
    expect(existsSync(h.rootPrefix)).toBe(false);
  });

  it("exits 21 when the budget gate refuses and starts nothing", async () => {
    const h = harness({
      metas: {
        q43: {
          cost: "low",
          agents: ["kiro"],
          maxPrompts: 2,
          estimateCredits: { lo: 1, hi: 2 },
          assumption: "two prompts",
        },
      },
    });
    expect(await main(["q43"], h.io)).toBe(EXIT.BUDGET);
    expect(h.lines.join("\n")).toContain("NO-AUTHORING");
    expect(h.hcSessions).toEqual([]);
    expect(h.loaded).toEqual([]);
  });

  it("fails a spike on a secret finding, exits 22 with the class only and cleans up", async () => {
    const { text: secret } = buildSample("github-token");
    const h = harness({
      modules: {
        q2: async () => {
          throw new EvidenceSecretError("github-token");
        },
      },
    });
    expect(await main(["q2"], h.io)).toBe(EXIT.NEEDS_HUMAN);
    const text = h.lines.join("\n");
    expect(text).toContain("github-token");
    expect(text).not.toContain(secret);
    expect(existsSync(join(h.rootPrefix, "q2"))).toBe(false);
  });

  it("redacts a planted secret before it reaches the evidence folder", async () => {
    const { text: secret } = buildSample("github-token");
    let dir = "";
    const h = harness({
      modules: {
        q2: async (ctx) => {
          dir = ctx.evidence.dir;
          await ctx.evidence.addText("out.txt", `before\n${secret}\nafter\n`);
          return outcome();
        },
      },
    });
    expect(await main(["q2"], h.io)).toBe(EXIT.OK);
    const written = readFileSync(join(dir, "out.txt"), "utf8");
    expect(written).not.toContain(secret);
    expect(written).toContain("[REDACTED-LINE:github-token]");
    expect(h.lines.join("\n")).not.toContain(secret);
  });

  it("runs one cleanup pass on SIGINT and exits 130", async () => {
    const handlers = new Map<string, () => void>();
    const signals: SignalHost = {
      on: (sig, handler) => {
        handlers.set(sig, handler);
      },
      off: (sig) => {
        handlers.delete(sig);
      },
      exit: () => {
        throw new Error("a single signal must not force an exit");
      },
    };
    const h = harness({
      signals,
      modules: {
        q2: async () => {
          handlers.get("SIGINT")?.();
          await new Promise((r) => setTimeout(r, 30));
          return outcome();
        },
      },
    });
    expect(await main(["q2"], h.io)).toBe(130);
    expect(stopCalls(h)).toBe(1);
    expect(existsSync(join(h.rootPrefix, "q2"))).toBe(false);
    expect(handlers.size).toBe(0);
  });
});
