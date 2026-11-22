import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { run, terminalCalls } from "../../kiro/q4/q4.ts";
import { startRawAcp } from "../../lib/acp-echo.ts";
import type { PermissionAnswer, PermissionRequest } from "../../lib/approval.ts";
import { readSpikeMeta } from "../../lib/meta.ts";
import type { SpikeContext } from "../../lib/outcome.ts";
import { newNonce, writeMarker } from "../../lib/own-marker.ts";
import { withBinDir } from "../support/bin-dir.ts";
import { type FakeKiroOptions, fakeKiroSource } from "../support/fake-kiro.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function temp(prefix: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  dirs.push(d);
  return d;
}

const ALLOW: PermissionAnswer = {
  outcome: "selected",
  optionId: "allow-once",
  kind: "allow_once",
  by: "owner",
};
const TIMEOUT: PermissionAnswer = {
  outcome: "rejected",
  optionId: "reject-once",
  reason: "timeout",
};

interface Setup {
  ctx: SpikeContext;
  root: string;
  repo: string;
  home: string;
  logFile: string;
  files: Map<string, string>;
  asked: PermissionRequest[];
}

function setup(answer: PermissionAnswer, allowHomeProfile = false): Setup {
  const root = temp("wraith-q4-");
  const repo = temp("wraith-q4-repo-");
  const home = temp("wraith-q4-home-");
  const scratch = join(root, "scratch");
  const evDir = join(root, "evidence-out");
  mkdirSync(scratch);
  mkdirSync(evDir);
  writeMarker({
    v: 1,
    session: "wsp",
    qs: ["q4"],
    root,
    runnerPid: process.pid,
    startedAt: new Date().toISOString(),
    nonce: newNonce(),
    pids: [],
    agentFiles: [],
  });
  const meta = readSpikeMeta("q4");
  if (!meta.ok) throw new Error(meta.reason);
  const files = new Map<string, string>();
  const asked: PermissionRequest[] = [];
  const ctx: SpikeContext = {
    q: "q4",
    meta: meta.meta,
    root,
    session: "wsp",
    scratch,
    hc: null,
    env: () => ({}),
    evidence: {
      dir: evDir,
      stamp: "test",
      async addText(name, text) {
        files.set(name, text);
        writeFileSync(join(evDir, name), text);
      },
      async addJsonl(name, src) {
        const out: string[] = [];
        for await (const l of src) out.push(l);
        const text = out.length === 0 ? "" : `${out.join("\n")}\n`;
        files.set(name, text);
        writeFileSync(join(evDir, name), text);
      },
      async finish() {
        throw new Error("not used");
      },
    },
    approval: async (req) => {
      asked.push(req);
      return answer;
    },
    shared: null,
    humanStep: () => {},
    now: () => new Date(),
    interactive: true,
    allowHomeProfile,
  };
  return { ctx, root, repo, home, logFile: join(root, "fake.log"), files, asked };
}

function records(logFile: string): Record<string, unknown>[] {
  if (!existsSync(logFile)) return [];
  return readFileSync(logFile, "utf8")
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

async function withFake<T>(
  s: Setup,
  opts: Partial<FakeKiroOptions>,
  fn: () => Promise<T>,
  noTerminal = false,
): Promise<T> {
  let body = fakeKiroSource({
    version: "2.0.1",
    listSessionsHelp: "",
    logFile: s.logFile,
    ...opts,
  });
  if (noTerminal) {
    // An agent that ignores the client's terminal capability and never calls terminal/*.
    const patched = body.replace(
      "terminalDeclared = Boolean(p.clientCapabilities && p.clientCapabilities.terminal);",
      "terminalDeclared = false;",
    );
    if (patched === body) throw new Error("fake-kiro source changed: patch not applied");
    body = patched;
  }
  return withBinDir({ "kiro-cli": body }, async (env) => {
    s.ctx.env = () => env;
    return fn();
  });
}

describe("Q4 script (fake kiro-cli, stubbed owner)", () => {
  it("has a valid metadata block", () => {
    const m = readSpikeMeta("q4");
    expect(m.ok && m.meta.runBy).toBe("owner");
    expect(m.ok && m.meta.maxPrompts).toBe(3);
    expect(m.ok && m.meta.maxWallSeconds).toBe(1200);
    expect(m.ok && m.meta.depends).toEqual(["q43", "q3"]);
    expect(m.ok && m.meta.human).toEqual(["HS-S2", "HS-S3"]);
  });

  it("passes when terminal/create and terminal/output arrive, and runs nothing itself", async () => {
    const s = setup(ALLOW);
    await withFake(s, {}, async () => {
      const out = await run(s.ctx, { home: s.home, repoRoot: s.repo, placement: "scratch" });
      expect(out.result).toBe("PASS");
      expect(out.promptsSent).toBe(1);
      expect(s.asked).toHaveLength(1);
      const log = records(s.logFile);
      expect(log.filter((r) => r.kind === "terminal").map((r) => r.method)).toEqual([
        "terminal/create",
        "terminal/output",
      ]);
      // Each terminal request got a JSON-RPC error back: no result, so no process was started.
      const raw = readFileSync(join(s.root, "q4.jsonl"), "utf8")
        .split("\n")
        .filter((l) => l !== "")
        .map((l) => JSON.parse(l) as { dir: string; msg: Record<string, unknown> });
      const ids = raw
        .filter((f) => f.dir === "a2c" && String(f.msg.method ?? "").startsWith("terminal/"))
        .map((f) => f.msg.id);
      expect(ids).toHaveLength(2);
      for (const id of ids) {
        const reply = raw.find((f) => f.dir === "c2a" && f.msg.id === id);
        expect(reply?.msg.error).toMatchObject({ code: -32601 });
        expect(reply?.msg.result).toBeUndefined();
      }
      expect(s.files.has("frames.jsonl")).toBe(true);
      expect(log.filter((r) => r.kind === "argv").map((r) => r.argv)).toEqual([
        ["acp", "--agent-engine", "v3", "--agent", "wraith-spike-q4"],
      ]);
    });
  });

  it("is PARTIAL 'approval tap missing' when the owner times out and no terminal call came", async () => {
    const s = setup(TIMEOUT);
    await withFake(
      s,
      {},
      async () => {
        const out = await run(s.ctx, { home: s.home, repoRoot: s.repo, placement: "scratch" });
        expect(out.result).toBe("PARTIAL");
        expect(out.reason).toBe("approval tap missing");
      },
      true,
    );
  });

  it("fails with the ToolCard branch when the owner allowed and no terminal request arrived", async () => {
    const s = setup(ALLOW);
    await withFake(
      s,
      {},
      async () => {
        const out = await run(s.ctx, { home: s.home, repoRoot: s.repo, placement: "scratch" });
        expect(out.result).toBe("FAIL");
        expect(out.branch).toBe("show output in the ToolCard");
        expect(out.criteria.find((c) => c.id === "q4-terminal-create")?.ok).toBe(false);
        expect(records(s.logFile).filter((r) => r.kind === "terminal")).toEqual([]);
      },
      true,
    );
  });

  it("is PARTIAL when the owner rejects without a timeout", async () => {
    const s = setup({ outcome: "rejected", optionId: "reject-once", reason: "policy" });
    await withFake(
      s,
      {},
      async () => {
        const out = await run(s.ctx, { home: s.home, repoRoot: s.repo, placement: "scratch" });
        expect(out.result).toBe("PARTIAL");
      },
      true,
    );
  });

  it("launches without --agent when Q43 failed", async () => {
    const s = setup(ALLOW);
    await withFake(s, {}, async () => {
      await run(s.ctx, { home: s.home, repoRoot: s.repo, placement: "none" });
      expect(records(s.logFile).find((r) => r.kind === "argv")?.argv).toEqual([
        "acp",
        "--agent-engine",
        "v3",
      ]);
    });
  });

  it("stays pending for a home placement without --allow-home-profile and writes nothing", async () => {
    const s = setup(ALLOW);
    const out = await run(s.ctx, { home: s.home, repoRoot: s.repo, placement: "home" });
    expect(out.result).toBe("pending");
    expect(out.openHumanSteps).toEqual(["HS-S6"]);
    expect(out.notes.join(" ")).toContain("--allow-home-profile");
    expect(existsSync(join(s.home, ".kiro"))).toBe(false);
  });

  it("writes one home file with the flag and deletes it afterwards", async () => {
    const s = setup(ALLOW, true);
    await withFake(s, {}, async () => {
      const out = await run(s.ctx, { home: s.home, repoRoot: s.repo, placement: "home" });
      expect(out.result).toBe("PASS");
      expect(existsSync(join(s.home, ".kiro", "agents", "wraith-spike-q4.json"))).toBe(false);
    });
  });

  it("is pending when kiro-cli is not found", async () => {
    const s = setup(ALLOW);
    s.ctx.env = () => ({ PATH: "/nonexistent-wraith-dir" });
    const out = await run(s.ctx, { home: s.home, repoRoot: s.repo, placement: "scratch" });
    expect(out.result).toBe("pending");
    expect(out.reason).toContain("kiro-cli");
  });
});

describe("terminal declaration", () => {
  it("the fake agent sends no terminal/* request when the client did not declare terminal", async () => {
    const s = setup(ALLOW);
    await withFake(s, {}, async () => {
      const acp = startRawAcp({
        argv: ["kiro-cli", "acp", "--agent-engine", "v3"],
        cwd: s.ctx.scratch,
        env: s.ctx.env("agent"),
        maxPrompts: 1,
        killAfterMs: 20000,
        root: s.root,
        rawLog: join(s.root, "plain.jsonl"),
      });
      acp.onPermission(async () => ALLOW);
      try {
        await acp.initialize({});
        const created = await acp.newSession(s.ctx.scratch);
        await acp.prompt(created.sessionId, "hi");
        expect(terminalCalls(acp.frames())).toEqual([]);
      } finally {
        await acp.close();
      }
    });
  });

  it("terminalCalls lists only agent requests with an id", () => {
    expect(
      terminalCalls([
        { dir: "a2c", msg: { id: 1, method: "terminal/create" } },
        { dir: "a2c", msg: { method: "terminal/output" } },
        { dir: "c2a", msg: { id: 2, method: "terminal/output" } },
        { dir: "a2c", msg: { id: 3, method: "terminal/output" } },
      ]),
    ).toEqual(["terminal/create", "terminal/output"]);
  });
});
