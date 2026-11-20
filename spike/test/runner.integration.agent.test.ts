import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SpikeMeta } from "../../tools/lib/spike-meta.ts";
import { type AcpEcho, PromptCapReached, startRawAcp } from "../lib/acp-echo.ts";
import { type ApprovalPolicy, pickOption } from "../lib/approval.ts";
import type { Hc } from "../lib/hc.ts";
import { EXIT, type SpikeContext, type SpikeModule, type SpikeOutcome } from "../lib/outcome.ts";
import type { PreflightInput } from "../lib/preflight.ts";
import { main, type RunIo } from "../run.ts";
import { withBinDir } from "./support/bin-dir.ts";
import { type FakeKiroOptions, fakeKiroSource } from "./support/fake-kiro.ts";

/** Runner integration tests, part 2: loop-run Kiro-style spikes against the fake agent (task 8.8). */

let base = "";

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "wraith-runner-agent-")));
});

afterEach(() => {
  rmSync(base, { force: true, recursive: true });
});

const ENV = { PATH: "/usr/bin", HOME: "/home/tester" };
const NOW = new Date(Date.UTC(2026, 10, 18, 9, 5, 7));
const AGENT_NAME = "wraith-spike-q32";

function metaFor(q: string, over: Partial<SpikeMeta> = {}): SpikeMeta {
  return {
    id: q,
    group: "B",
    cost: "none",
    runBy: "loop",
    agents: [],
    maxPrompts: 2,
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

interface Rec {
  kind: string;
  [k: string]: unknown;
}

interface Harness {
  io: RunIo;
  lines: string[];
  policies: ApprovalPolicy[];
}

function harness(
  metas: Partial<Record<string, Partial<SpikeMeta>>>,
  modules: Partial<Record<string, SpikeModule["run"]>>,
): Harness {
  const rootPrefix = join(base, "hcw");
  const lines: string[] = [];
  const policies: ApprovalPolicy[] = [];
  const io: RunIo = {
    stdinIsTTY: false,
    stdoutIsTTY: false,
    env: ENV,
    now: () => NOW,
    out: (l) => {
      lines.push(l);
    },
    err: (l) => {
      lines.push(l);
    },
    load: async (q) => {
      const run = modules[q];
      if (run === undefined) throw new Error(`no fake module for ${q}`);
      return { run };
    },
    record: () => EXIT.INTERNAL,
    budget: () => EXIT.INTERNAL,
    approve: async (req, policy) => {
      policies.push(policy);
      const a = pickOption(req, null, policy, false, false);
      if (a === null) throw new Error("a non-interactive policy must answer");
      return a;
    },
    repoRoot: join(base, "repo"),
    rootPrefix,
    ledgerPath: join(base, "ledger.json"),
    today: "2026-11-18",
    readMeta: (q) => ({ ok: true, meta: metaFor(q, metas[q]) }),
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
      envHome: "/home/tester",
      realHome: "/home/tester",
      hcVersion: "hc 0.1.20",
      needsHcAtLeast: [0, 1, 18],
      rootState: { kind: "absent" },
      scriptTreeViolations: [],
    }),
    makeHc: (i): Hc => ({
      session: i.session,
      mode: "normal",
      run: async () => ({ code: 0, stdout: "{}", stderr: "", ms: 0 }),
      spawnLong: () => {
        throw new Error("the fake hc starts no process");
      },
    }),
  };
  return { io, lines, policies };
}

/** Runs `fn` with a fake `kiro-cli` on a private PATH; returns the fake's log records too. */
async function withFakeKiro<T>(
  opts: Partial<FakeKiroOptions>,
  fn: (kiro: string, env: Record<string, string>, records: () => Rec[]) => Promise<T>,
): Promise<T> {
  const logFile = join(base, "fake.jsonl");
  return withBinDir(
    { "kiro-cli": fakeKiroSource({ version: "2.0.1", listSessionsHelp: "", logFile, ...opts }) },
    (env, dir) =>
      fn(join(dir, "kiro-cli"), env, () =>
        existsSync(logFile)
          ? readFileSync(logFile, "utf8")
              .split("\n")
              .filter(Boolean)
              .map((l) => JSON.parse(l) as Rec)
          : [],
      ),
  );
}

function startAgent(
  ctx: SpikeContext,
  kiro: string,
  binEnv: Record<string, string>,
  extraArgs: string[],
): AcpEcho {
  return startRawAcp({
    argv: [kiro, "acp", "--agent-engine", "v3", ...extraArgs],
    cwd: ctx.scratch,
    env: { ...ctx.env("agent"), PATH: binEnv.PATH as string },
    maxPrompts: ctx.meta.maxPrompts,
    killAfterMs: 20_000,
    root: ctx.root,
    rawLog: join(ctx.root, "frames.raw.jsonl"),
  });
}

function readIndex(dir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, "index.json"), "utf8")) as Record<string, unknown>;
}

describe("runner integration with fake-kiro (part 2)", () => {
  it("answers the fake's permission request with reject_once and the fake records no allow", async () => {
    await withFakeKiro({}, async (kiro, binEnv, records) => {
      let dir = "";
      const h = harness(
        { q43: { agents: ["kiro"], maxPrompts: 1 } },
        {
          q43: async (ctx) => {
            dir = ctx.evidence.dir;
            const acp = startAgent(ctx, kiro, binEnv, ["--agent", AGENT_NAME]);
            const asked: string[] = [];
            acp.onPermission(async (req) => {
              asked.push(...req.options.map((o) => o.kind));
              return ctx.approval(req);
            });
            try {
              await acp.initialize({});
              const { sessionId } = await acp.newSession(ctx.scratch);
              const r = await acp.prompt(sessionId, "read a file");
              return outcome({
                result:
                  asked.includes("allow_once") && r.stopReason === "end_turn" ? "PASS" : "FAIL",
                promptsSent: acp.promptsSent(),
              });
            } finally {
              await acp.close();
            }
          },
        },
      );
      expect(await main(["q43"], h.io)).toBe(EXIT.OK);
      expect(h.policies.map((p) => p.kind)).toEqual(["reject-all"]);
      const answers = records().filter((r) => r.kind === "permission");
      expect(answers).toEqual([
        { kind: "permission", answer: { outcome: "selected", optionId: "reject-once" } },
      ]);
      const tools = records().filter((r) => r.kind === "tool");
      expect(tools).toEqual([{ kind: "tool", ran: false }]);
      expect(readIndex(dir)).toMatchObject({ result: "PASS", promptsSent: 1 });
    });
  });

  it("stops a spike that sends more prompts than its maximum: PARTIAL with the reason and promptsSent", async () => {
    await withFakeKiro({}, async (kiro, binEnv, records) => {
      let dir = "";
      const h = harness(
        { q43: { agents: ["kiro"], maxPrompts: 1 } },
        {
          q43: async (ctx) => {
            dir = ctx.evidence.dir;
            const acp = startAgent(ctx, kiro, binEnv, ["--agent", AGENT_NAME]);
            acp.onPermission((req) => ctx.approval(req));
            try {
              await acp.initialize({});
              const { sessionId } = await acp.newSession(ctx.scratch);
              await acp.prompt(sessionId, "first");
              await acp.prompt(sessionId, "second, over the cap");
              return outcome({ result: "PASS", promptsSent: acp.promptsSent() });
            } catch (e) {
              if (!(e instanceof PromptCapReached)) throw e;
              return outcome({
                result: "PARTIAL",
                reason: `prompt cap reached: ${e.maxPrompts} prompt(s) allowed`,
                promptsSent: acp.promptsSent(),
              });
            } finally {
              await acp.close();
            }
          },
        },
      );
      expect(await main(["q43"], h.io)).toBe(EXIT.OK);
      expect(readIndex(dir)).toMatchObject({
        result: "PARTIAL",
        reason: "prompt cap reached: 1 prompt(s) allowed",
        promptsSent: 1,
      });
      // the second prompt never reached the agent
      expect(records().filter((r) => r.kind === "prompt")).toEqual([{ kind: "prompt", number: 1 }]);
      expect(h.lines.join("\n")).toContain("q43: PARTIAL");
    });
  });

  it("after a Q43 FAIL the next spike omits --agent and selects the agent after initialize", async () => {
    await withFakeKiro({ acceptedAgents: [] }, async (kiro, binEnv, records) => {
      let agentAccepted: boolean | null = null;
      const dirs: Record<string, string> = {};
      let selection: { afterInitialize: boolean; text: string } | null = null;
      const h = harness(
        {
          q43: { agents: ["kiro"], maxPrompts: 0 },
          q32: { agents: ["kiro"], maxPrompts: 2, depends: ["q43"] },
        },
        {
          q43: async (ctx) => {
            dirs.q43 = ctx.evidence.dir;
            const acp = startAgent(ctx, kiro, binEnv, ["--agent", AGENT_NAME]);
            try {
              await acp.initialize({});
              agentAccepted = true;
              return outcome({ result: "PASS" });
            } catch {
              agentAccepted = false;
              return outcome({
                result: "FAIL",
                branch: "launch without --agent, select after initialize",
              });
            } finally {
              await acp.close();
            }
          },
          q32: async (ctx) => {
            dirs.q32 = ctx.evidence.dir;
            const extra = agentAccepted === true ? ["--agent", AGENT_NAME] : [];
            const acp = startAgent(ctx, kiro, binEnv, extra);
            acp.onPermission((req) => ctx.approval(req));
            try {
              await acp.initialize({});
              const { sessionId } = await acp.newSession(ctx.scratch);
              const text = `/agent ${AGENT_NAME}`;
              await acp.prompt(sessionId, text);
              const sent = acp
                .frames()
                .filter((f) => f.dir === "c2a")
                .map((f) => (f.msg as { method?: string }).method);
              selection = {
                afterInitialize: sent.indexOf("initialize") < sent.indexOf("session/prompt"),
                text,
              };
              return outcome({ result: "PASS", promptsSent: acp.promptsSent() });
            } finally {
              await acp.close();
            }
          },
        },
      );
      expect(await main(["q32", "q43"], h.io)).toBe(EXIT.OK);
      expect(agentAccepted).toBe(false);
      expect(readIndex(dirs.q43 as string)).toMatchObject({ result: "FAIL" });
      expect(h.lines.join("\n")).toContain(
        "q32: q43 FAIL: launch without the agent argument and select the agent after initialize",
      );

      const argvs = records()
        .filter((r) => r.kind === "argv")
        .map((r) => r.argv as string[]);
      expect(argvs).toHaveLength(2);
      expect(argvs[0]).toContain("--agent");
      expect(argvs[1]).not.toContain("--agent");
      expect(argvs[1]).toEqual(["acp", "--agent-engine", "v3"]);
      expect(selection).toEqual({ afterInitialize: true, text: `/agent ${AGENT_NAME}` });
      expect(readIndex(dirs.q32 as string)).toMatchObject({ result: "PASS", promptsSent: 1 });
      expect(readdirSync(join(base, "hcw"))).toEqual([]);
    });
  });
});

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
