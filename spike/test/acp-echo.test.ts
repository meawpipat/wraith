import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type AcpEcho,
  type AcpStartInput,
  PromptCapReached,
  startRawAcp,
  startSdkAcp,
} from "../lib/acp-echo.ts";
import {
  type ApprovalPolicy,
  type PermissionAnswer,
  type PermissionRequest,
  pickOption,
} from "../lib/approval.ts";
import { withBinDir } from "./support/bin-dir.ts";
import { type FakeKiroOptions, fakeKiroSource } from "./support/fake-kiro.ts";

interface Rec {
  kind: string;
  [k: string]: unknown;
}

interface Ctx {
  start(over?: {
    maxPrompts?: number;
    killAfterMs?: number;
    setTimer?: AcpStartInput["setTimer"];
    env?: Record<string, string>;
    sdk?: boolean;
  }): AcpEcho;
  records(): Promise<Rec[]>;
  rawLog: string;
  cwd: string;
}

async function withFake<T>(opts: Partial<FakeKiroOptions>, fn: (c: Ctx) => Promise<T>): Promise<T> {
  const tmp = await mkdtemp(join(tmpdir(), "wraith-acp-"));
  const logFile = join(tmp, "fake.jsonl");
  const rawLog = join(tmp, "raw", "frames.jsonl");
  const started: AcpEcho[] = [];
  try {
    return await withBinDir(
      { "kiro-cli": fakeKiroSource({ version: "2.0.1", listSessionsHelp: "", logFile, ...opts }) },
      async (env, dir) => {
        const ctx: Ctx = {
          rawLog,
          cwd: tmp,
          start: (over = {}) => {
            const acp = (over.sdk === true ? startSdkAcp : startRawAcp)({
              argv: [join(dir, "kiro-cli"), "acp"],
              cwd: tmp,
              env: { ...env, ...over.env },
              maxPrompts: over.maxPrompts ?? 2,
              killAfterMs: over.killAfterMs ?? 20_000,
              ...(over.setTimer === undefined ? {} : { setTimer: over.setTimer }),
              root: tmp,
              rawLog,
            });
            started.push(acp);
            return acp;
          },
          records: async () => {
            const text = await readFile(logFile, "utf8").catch(() => "");
            return text
              .split("\n")
              .filter(Boolean)
              .map((l) => JSON.parse(l) as Rec);
          },
        };
        try {
          return await fn(ctx);
        } finally {
          for (const a of started) await a.close();
        }
      },
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/** A wall timer that fires only when the test says so, so no real time decides the outcome. */
function manualTimer(): { setTimer: NonNullable<AcpStartInput["setTimer"]>; fire(): void } {
  const pending: (() => void)[] = [];
  return {
    setTimer: (fn) => {
      pending.push(fn);
      return {
        clear: () => {
          const i = pending.indexOf(fn);
          if (i >= 0) pending.splice(i, 1);
        },
      };
    },
    fire: () => {
      for (const fn of pending.splice(0)) fn();
    },
  };
}

const REJECT_ALL: ApprovalPolicy = { kind: "reject-all", allowAlways: "never", timeoutMs: 120_000 };

function rejectAll(req: PermissionRequest): Promise<PermissionAnswer> {
  const a = pickOption(req, null, REJECT_ALL, true, false);
  if (a === null) throw new Error("reject-all must answer");
  return Promise.resolve(a);
}

describe("acp-echo raw client with fake-kiro", () => {
  it("initialize, new session, prompt, update and permission work", async () => {
    await withFake({}, async (c) => {
      const acp = c.start();
      const updates: unknown[] = [];
      const asked: PermissionRequest[] = [];
      acp.onUpdate((u) => updates.push(u));
      acp.onPermission((r) => {
        asked.push(r);
        return rejectAll(r);
      });
      await acp.initialize({});
      const { sessionId } = await acp.newSession(c.cwd);
      const { stopReason } = await acp.prompt(sessionId, "hello");
      expect(stopReason).toBe("end_turn");
      expect(asked).toHaveLength(1);
      expect(asked[0]?.options.map((o) => o.kind)).toEqual(["allow_once", "reject_once"]);
      expect(updates.length).toBeGreaterThan(2);
      expect(acp.promptsSent()).toBe(1);
      const methods = acp
        .frames()
        .map((f) => (f.msg as { method?: string }).method)
        .filter((m) => m === "initialize" || m === "session/new" || m === "session/prompt");
      expect(methods).toEqual(
        expect.arrayContaining(["initialize", "session/new", "session/prompt"]),
      );
    });
  });

  it("a reject-all policy answers reject_once and the fake never runs the tool", async () => {
    await withFake({}, async (c) => {
      const acp = c.start();
      acp.onPermission(rejectAll);
      await acp.initialize({});
      const { sessionId } = await acp.newSession(c.cwd);
      await acp.prompt(sessionId, "hello");
      const recs = await c.records();
      const perm = recs.find((r) => r.kind === "permission");
      expect(perm?.answer).toEqual({ outcome: "selected", optionId: "reject-once" });
      expect(recs.find((r) => r.kind === "tool")?.ran).toBe(false);
    });
  });

  it("without a permission handler the request is cancelled, never allowed", async () => {
    await withFake({}, async (c) => {
      const acp = c.start();
      await acp.initialize({});
      const { sessionId } = await acp.newSession(c.cwd);
      await acp.prompt(sessionId, "hello");
      const recs = await c.records();
      expect(recs.find((r) => r.kind === "permission")?.answer).toEqual({ outcome: "cancelled" });
      expect(recs.find((r) => r.kind === "tool")?.ran).toBe(false);
    });
  });

  it("an answer naming an option that was not offered cancels", async () => {
    await withFake({}, async (c) => {
      const acp = c.start();
      acp.onPermission(() =>
        Promise.resolve({
          outcome: "selected",
          optionId: "invented",
          kind: "allow_once",
          by: "owner",
        }),
      );
      await acp.initialize({});
      const { sessionId } = await acp.newSession(c.cwd);
      await acp.prompt(sessionId, "hello");
      const recs = await c.records();
      expect(recs.find((r) => r.kind === "permission")?.answer).toEqual({ outcome: "cancelled" });
    });
  });

  it("the prompt cap closes the agent and counts prompts sent", async () => {
    await withFake({ askPermission: false }, async (c) => {
      const acp = c.start({ maxPrompts: 1 });
      await acp.initialize({});
      const { sessionId } = await acp.newSession(c.cwd);
      await acp.prompt(sessionId, "one");
      await expect(acp.prompt(sessionId, "two")).rejects.toBeInstanceOf(PromptCapReached);
      expect(acp.promptsSent()).toBe(1);
      const recs = await c.records();
      expect(recs.filter((r) => r.kind === "prompt")).toHaveLength(1);
      await expect(acp.prompt(sessionId, "three")).rejects.toBeInstanceOf(PromptCapReached);
    });
  });

  it("the wall-time timer closes the agent and reports a partial reason", async () => {
    await withFake({}, async (c) => {
      const timer = manualTimer();
      const acp = c.start({ setTimer: timer.setTimer });
      // The timer fires only once the prompt is pending: the agent asks, the handler never answers.
      acp.onPermission(() => {
        timer.fire();
        return new Promise<PermissionAnswer>(() => undefined);
      });
      await acp.initialize({});
      const { sessionId } = await acp.newSession(c.cwd);
      await expect(acp.prompt(sessionId, "hello")).rejects.toThrow();
      expect(acp.partialReason()).toMatch(/max-wall-seconds/);
      expect(acp.promptsSent()).toBe(1);
    });
  });

  it("writes every frame to the raw log", async () => {
    await withFake({ askPermission: false }, async (c) => {
      const acp = c.start();
      await acp.initialize({});
      const { sessionId } = await acp.newSession(c.cwd);
      await acp.prompt(sessionId, "hello");
      const lines = (await readFile(c.rawLog, "utf8")).split("\n").filter(Boolean);
      expect(lines).toHaveLength(acp.frames().length);
      const parsed = lines.map((l) => JSON.parse(l) as { dir: string; t: number });
      expect(parsed.some((p) => p.dir === "c2a")).toBe(true);
      expect(parsed.some((p) => p.dir === "a2c")).toBe(true);
    });
  });

  it("declares terminal:true only when asked", async () => {
    await withFake({}, async (c) => {
      const off = c.start();
      const r1 = (await off.initialize({})) as { _meta?: { clientTerminal?: boolean } };
      expect(r1._meta?.clientTerminal).toBe(false);
      const on = c.start();
      const r2 = (await on.initialize({ terminal: true })) as {
        _meta?: { clientTerminal?: boolean };
      };
      expect(r2._meta?.clientTerminal).toBe(true);
    });
  });

  it("loadSession returns the replayed updates", async () => {
    await withFake({ askPermission: false }, async (c) => {
      const acp = c.start();
      await acp.initialize({});
      const { sessionId } = await acp.newSession(c.cwd);
      const { replay } = await acp.loadSession(sessionId, c.cwd);
      expect(replay.length).toBeGreaterThanOrEqual(3);
    });
  });

  it("the child env holds no HC_*, HERDR_* or XDG_* name", async () => {
    await withFake({ askPermission: false }, async (c) => {
      const acp = c.start({
        env: { HC_SESSION: "x", HERDR_PANE: "y", XDG_STATE_HOME: "/z", XDG_CONFIG_HOME: "/w" },
      });
      await acp.initialize({});
      const recs = await c.records();
      expect(recs.find((r) => r.kind === "env")?.names).toEqual([]);
    });
  });

  it("refuses an argv holding an unsafe token and a relative raw log", () => {
    const unsafe = `--trust-all-${"tools"}`;
    const base = { cwd: tmpdir(), env: {}, maxPrompts: 1, killAfterMs: 1000, root: tmpdir() };
    expect(() =>
      startRawAcp({ ...base, argv: ["node", "acp", unsafe], rawLog: join(tmpdir(), "x.jsonl") }),
    ).toThrow(/spike-agent-unsafe/);
    expect(() => startRawAcp({ ...base, argv: ["node"], rawLog: "relative.jsonl" })).toThrow(
      /absolute/,
    );
  });

  it("refuses a rawLog outside the Spike_Root, segment-wise, in both clients", () => {
    const root = join(tmpdir(), "wsp-root");
    const base = { argv: ["node"], cwd: tmpdir(), env: {}, maxPrompts: 1, killAfterMs: 1000, root };
    for (const start of [startRawAcp, startSdkAcp]) {
      for (const rawLog of [
        join(tmpdir(), "elsewhere", "x.jsonl"),
        join(`${root}-sibling`, "x.jsonl"),
        join(root, "..", "x.jsonl"),
        root,
      ]) {
        expect(() => start({ ...base, rawLog })).toThrow(/under the Spike_Root/);
      }
    }
  });
});

function clientMethods(acp: AcpEcho): (string | undefined)[] {
  return acp
    .frames()
    .filter((f) => f.dir === "c2a")
    .map((f) => (f.msg as { method?: string }).method);
}

describe("acp-echo SDK client with fake-kiro", () => {
  it("the same scenario produces the same method sequence as the raw client", async () => {
    const run = async (sdk: boolean) =>
      withFake({}, async (c) => {
        const acp = c.start({ sdk });
        acp.onPermission(rejectAll);
        await acp.initialize({});
        const { sessionId } = await acp.newSession(c.cwd);
        const { stopReason } = await acp.prompt(sessionId, "hello");
        expect(stopReason).toBe("end_turn");
        const recs = await c.records();
        expect(recs.find((r) => r.kind === "permission")?.answer).toEqual({
          outcome: "selected",
          optionId: "reject-once",
        });
        expect(recs.find((r) => r.kind === "tool")?.ran).toBe(false);
        const lines = (await readFile(c.rawLog, "utf8")).split("\n").filter(Boolean);
        expect(lines).toHaveLength(acp.frames().length);
        return clientMethods(acp);
      });
    const raw = await run(false);
    const viaSdk = await run(true);
    expect(viaSdk).toEqual(raw);
    expect(viaSdk).toEqual(["initialize", "session/new", "session/prompt", undefined]);
  });

  it("the prompt cap closes the agent and counts prompts sent", async () => {
    await withFake({ askPermission: false }, async (c) => {
      const acp = c.start({ sdk: true, maxPrompts: 1 });
      await acp.initialize({});
      const { sessionId } = await acp.newSession(c.cwd);
      await acp.prompt(sessionId, "one");
      await expect(acp.prompt(sessionId, "two")).rejects.toBeInstanceOf(PromptCapReached);
      expect(acp.promptsSent()).toBe(1);
      expect((await c.records()).filter((r) => r.kind === "prompt")).toHaveLength(1);
    });
  });

  it("the wall-time timer closes the agent and reports a partial reason", async () => {
    await withFake({}, async (c) => {
      const timer = manualTimer();
      const acp = c.start({ sdk: true, setTimer: timer.setTimer });
      // The timer fires only once the prompt is pending: the agent asks, the handler never answers.
      acp.onPermission(() => {
        timer.fire();
        return new Promise<PermissionAnswer>(() => undefined);
      });
      await acp.initialize({});
      const { sessionId } = await acp.newSession(c.cwd);
      await expect(acp.prompt(sessionId, "hello")).rejects.toThrow();
      expect(acp.partialReason()).toMatch(/max-wall-seconds/);
    });
  });

  it("without a permission handler the request is cancelled, never allowed", async () => {
    await withFake({}, async (c) => {
      const acp = c.start({ sdk: true });
      await acp.initialize({});
      const { sessionId } = await acp.newSession(c.cwd);
      await acp.prompt(sessionId, "hello");
      const recs = await c.records();
      expect(recs.find((r) => r.kind === "permission")?.answer).toEqual({ outcome: "cancelled" });
      expect(recs.find((r) => r.kind === "tool")?.ran).toBe(false);
    });
  });

  it("declares terminal:true only when asked, and loads a session", async () => {
    await withFake({ askPermission: false }, async (c) => {
      const off = c.start({ sdk: true });
      const r1 = (await off.initialize({})) as { _meta?: { clientTerminal?: boolean } };
      expect(r1._meta?.clientTerminal).toBe(false);
      const on = c.start({ sdk: true });
      const r2 = (await on.initialize({ terminal: true })) as {
        _meta?: { clientTerminal?: boolean };
      };
      expect(r2._meta?.clientTerminal).toBe(true);
      const { sessionId } = await on.newSession(c.cwd);
      const { replay } = await on.loadSession(sessionId, c.cwd);
      expect(replay.length).toBeGreaterThanOrEqual(3);
    });
  });
});
