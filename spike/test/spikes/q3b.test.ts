import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ALLOW_OPTION_ID,
  BLOCK_OPTION_ID,
  decideBranch,
  HOLD_CAP_MS,
  hookCommand,
  ONE_SHOT_BRANCH,
  type Q3bIo,
  readQ3Result,
  run,
  STOP_BRANCH,
  shellQuote,
} from "../../kiro/q3b/q3b.ts";
import type { TimerHandle } from "../../lib/acp-echo.ts";
import type { PermissionAnswer, PermissionRequest } from "../../lib/approval.ts";
import { HOOK_PORT } from "../../lib/hook-receiver.ts";
import { readSpikeMeta } from "../../lib/meta.ts";
import type { SpikeContext } from "../../lib/outcome.ts";
import { newNonce, writeMarker } from "../../lib/own-marker.ts";
import { withBinDir } from "../support/bin-dir.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function temp(prefix: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  dirs.push(d);
  return d;
}

const BLOCK: PermissionAnswer = {
  outcome: "selected",
  optionId: BLOCK_OPTION_ID,
  kind: "reject_once",
  by: "owner",
};
const ALLOW: PermissionAnswer = {
  outcome: "selected",
  optionId: ALLOW_OPTION_ID,
  kind: "allow_once",
  by: "owner",
};
const TIMEOUT: PermissionAnswer = {
  outcome: "rejected",
  optionId: BLOCK_OPTION_ID,
  reason: "timeout",
};

interface FakeOptions {
  /** `none`: the agent never calls a hook (Q3b FAIL). */
  hooks: "run" | "none";
  /** Run the tool whatever the hook exit code (Q3b FAIL: exit 2 does not block). */
  ignoreExit: boolean;
  /** Kill the hook after this many ms on the second prompt; 0 waits for it. */
  killSecondMs: number;
  logFile: string;
  /** Also look for the profile in <home>/.kiro/agents (Q43 home placement). */
  home: string;
}

/** A local fake `kiro-cli acp` that runs the profile's `preToolUse` hook command like Kiro would. */
function fakeAgentSource(o: FakeOptions): string {
  return `const CONFIG = ${JSON.stringify(o)};\n${String.raw`
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const argv = process.argv.slice(2);
function log(r) { fs.appendFileSync(CONFIG.logFile, JSON.stringify(r) + "\n"); }
function send(m) { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\n"); }
function notify(sessionId, update) { send({ method: "session/update", params: { sessionId, update } }); }
log({ kind: "argv", argv });
let prompts = 0;
function hookCommand() {
  for (const base of [process.cwd(), CONFIG.home]) {
    const file = path.join(base, ".kiro", "agents", "wraith-spike-q3b.json");
    try {
      const p = JSON.parse(fs.readFileSync(file, "utf8"));
      return p.hooks.preToolUse[0].command;
    } catch {}
  }
  return null;
}
function onRequest(msg) {
  const p = msg.params || {};
  if (msg.method === "initialize") {
    send({ id: msg.id, result: { protocolVersion: 1, agentCapabilities: {}, authMethods: [] } });
  } else if (msg.method === "session/new") {
    send({ id: msg.id, result: { sessionId: "sess-1" } });
  } else if (msg.method === "session/prompt") {
    prompts++;
    notify("sess-1", { sessionUpdate: "tool_call", toolCallId: "tc-" + prompts, title: "shell", kind: "execute", status: "pending" });
    let run = true;
    const cmd = hookCommand();
    if (CONFIG.hooks === "run" && cmd !== null) {
      const timeout = prompts === 2 && CONFIG.killSecondMs > 0 ? CONFIG.killSecondMs : undefined;
      const r = spawnSync("/bin/sh", ["-c", cmd], {
        input: JSON.stringify({ hook_event_name: "preToolUse", tool_name: "execute_bash", tool_input: { command: "echo hi" } }),
        timeout,
        killSignal: "SIGKILL",
      });
      log({ kind: "hook", status: r.status, signal: r.signal, prompt: prompts });
      if (!CONFIG.ignoreExit && r.status !== 0) run = false;
    }
    log({ kind: "tool", ran: run, prompt: prompts });
    notify("sess-1", { sessionUpdate: "tool_call_update", toolCallId: "tc-" + prompts, status: run ? "completed" : "failed" });
    send({ id: msg.id, result: { stopReason: "end_turn" } });
  } else {
    send({ id: msg.id, error: { code: -32601, message: "method not found" } });
  }
}
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let at;
  while ((at = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, at);
    buffer = buffer.slice(at + 1);
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (msg.method !== undefined && msg.id !== undefined) onRequest(msg);
  }
});
process.stdin.on("end", () => process.exit(0));
`}`;
}

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
  const root = temp("wraith-q3b-");
  const repo = temp("wraith-q3b-repo-");
  const home = temp("wraith-q3b-home-");
  const scratch = join(root, "scratch");
  const evDir = join(root, "evidence-out");
  mkdirSync(scratch);
  mkdirSync(evDir);
  writeMarker({
    v: 1,
    session: "wsp",
    qs: ["q3b"],
    root,
    runnerPid: process.pid,
    startedAt: new Date().toISOString(),
    nonce: newNonce(),
    pids: [],
    agentFiles: [],
  });
  const meta = readSpikeMeta("q3b");
  if (!meta.ok) throw new Error(meta.reason);
  const files = new Map<string, string>();
  const asked: PermissionRequest[] = [];
  const ctx: SpikeContext = {
    q: "q3b",
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

async function withFake<T>(s: Setup, opts: Partial<FakeOptions>, fn: () => Promise<T>): Promise<T> {
  const body = fakeAgentSource({
    hooks: "run",
    ignoreExit: false,
    // Long enough for the hook client (a Node process) to start and reach the receiver under
    // full-workspace parallel load; 300 ms let it be killed first about 1 run in 4.
    killSecondMs: 3000,
    logFile: s.logFile,
    home: s.home,
    ...opts,
  });
  return withBinDir({ "kiro-cli": body }, async (env) => {
    s.ctx.env = () => env;
    return fn();
  });
}

/** Fake clock: 0 at hold start, 7000 at release. */
function clock(): Pick<Q3bIo, "nowMs"> {
  const ticks = [0, 7000];
  return { nowMs: () => ticks.shift() ?? 7000 };
}

function baseIo(s: Setup, extra: Q3bIo = {}): Q3bIo {
  return {
    home: s.home,
    repoRoot: s.repo,
    placement: "scratch",
    q3Result: "PASS",
    ...clock(),
    ...extra,
  };
}

function criterion(out: { criteria: { id: string; ok: boolean }[] }, id: string): boolean | null {
  return out.criteria.find((c) => c.id === id)?.ok ?? null;
}

describe("Q3b script (fake kiro-cli that runs the hook command, stubbed owner)", () => {
  it("has a valid metadata block", () => {
    const r = readSpikeMeta("q3b");
    if (!r.ok) throw new Error(r.reason);
    const m = r.meta;
    expect(m.runBy).toBe("owner");
    expect(m.maxPrompts).toBe(4);
    expect(m.depends).toEqual(["q43", "q3"]);
    expect(m.human).toEqual(["HS-S2", "HS-S3"]);
  });

  it("passes: the hook fires first, exit 2 blocks the tool, the timeout is measured", async () => {
    const s = setup(BLOCK);
    await withFake(s, {}, async () => {
      const out = await run(s.ctx, baseIo(s));
      expect(out.result).toBe("PASS");
      expect(out.promptsSent).toBe(2);
      expect(out.branch).toBeUndefined();
      expect(s.asked).toHaveLength(1);
      expect(s.asked[0]?.options.map((o) => o.kind)).toEqual(["reject_once", "allow_once"]);
      const log = records(s.logFile);
      expect(log.filter((r) => r.kind === "hook").map((r) => r.status)).toEqual([2, null]);
      expect(log.filter((r) => r.kind === "tool").map((r) => r.ran)).toEqual([false, false]);
      expect(log.find((r) => r.kind === "argv")?.argv).toEqual([
        "acp",
        "--agent-engine",
        "v3",
        "--agent",
        "wraith-spike-q3b",
      ]);
      const timeout = JSON.parse(s.files.get("hook-timeout.json") ?? "{}");
      expect(timeout.measured).toEqual({ ms: 7000, how: "agent-resumed" });
      const events = (s.files.get("hook-events.jsonl") ?? "")
        .split("\n")
        .filter((l) => l !== "")
        .map((l) => JSON.parse(l));
      expect(events.map((e: { decision: string }) => e.decision)).toEqual(["block", "block"]);
      expect(events[0].why).toBe("owner-selected");
      expect(events[1].why).toBe("timeout");
      for (const id of [
        "q3b-hook-fires",
        "q3b-before-tool",
        "q3b-exit2-blocks",
        "q3b-timeout-measured",
      ]) {
        expect(criterion(out, id)).toBe(true);
      }
      // The profile holds the hook command with the root, never the token.
      const profile = readFileSync(
        join(s.ctx.scratch, ".kiro", "agents", "wraith-spike-q3b.json"),
        "utf8",
      );
      const token = readFileSync(join(s.root, "hook.token"), "utf8");
      expect(profile).toContain("node --experimental-strip-types");
      expect(profile).toContain("hook-client.ts");
      expect(profile).toContain(s.root);
      expect(profile).not.toContain(token);
      for (const text of s.files.values()) expect(text).not.toContain(token);
    });
  });

  it("records the cap when the agent keeps waiting and the receiver then blocks", async () => {
    const s = setup(BLOCK);
    const timers: { fn: () => void; ms: number }[] = [];
    const setTimer = (fn: () => void, ms: number): TimerHandle => {
      timers.push({ fn, ms });
      return { clear: () => {} };
    };
    await withFake(s, { killSecondMs: 0 }, async () => {
      const done = run(s.ctx, baseIo(s, { setTimer }));
      for (let i = 0; i < 200 && timers.length === 0; i++) {
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(timers.map((t) => t.ms)).toEqual([HOLD_CAP_MS]);
      timers[0]?.fn();
      const out = await done;
      expect(out.result).toBe("PASS");
      const timeout = JSON.parse(s.files.get("hook-timeout.json") ?? "{}");
      expect(timeout.measured.how).toBe("cap");
      expect(out.criteria.find((c) => c.id === "q3b-timeout-measured")?.observed).toContain("cap");
      expect(
        records(s.logFile)
          .filter((r) => r.kind === "hook")
          .map((r) => r.status),
      ).toEqual([2, 2]);
    });
  });

  it("allows one call only after the owner's tap and then reports PARTIAL", async () => {
    const s = setup(ALLOW);
    await withFake(s, {}, async () => {
      const out = await run(s.ctx, baseIo(s));
      expect(out.result).toBe("PARTIAL");
      expect(out.reason).toContain("block path was not observed");
      const log = records(s.logFile);
      expect(log.find((r) => r.kind === "hook")?.status).toBe(0);
      expect(log.find((r) => r.kind === "tool")?.ran).toBe(true);
      const events = (s.files.get("hook-events.jsonl") ?? "")
        .split("\n")
        .filter((l) => l !== "")
        .map((l) => JSON.parse(l));
      expect(events[0].decision).toBe("allow");
      expect(events[0].why).toBe("owner-allow-once");
    });
  });

  it("blocks when the owner tap times out", async () => {
    const s = setup(TIMEOUT);
    await withFake(s, {}, async () => {
      const out = await run(s.ctx, baseIo(s));
      expect(out.result).toBe("PASS");
      expect(records(s.logFile).find((r) => r.kind === "tool")?.ran).toBe(false);
    });
  });

  it("fails and stops when exit 2 does not block and Q3 also failed", async () => {
    const s = setup(BLOCK);
    await withFake(s, { ignoreExit: true }, async () => {
      const out = await run(s.ctx, baseIo(s, { q3Result: "FAIL" }));
      expect(out.result).toBe("FAIL");
      expect(criterion(out, "q3b-exit2-blocks")).toBe(false);
      expect(out.branch).toBe(STOP_BRANCH);
      expect(out.stop).toEqual({ reason: "Q3 and Q3b both FAIL: STOP (agent-loop 22.2)" });
      expect(JSON.parse(s.files.get("decision.json") ?? "{}")).toEqual({
        q3: "FAIL",
        q3b: "FAIL",
        stop: true,
        branch: STOP_BRANCH,
      });
    });
  });

  it("fails without a probe when the hook never fires", async () => {
    const s = setup(BLOCK);
    await withFake(s, { hooks: "none" }, async () => {
      const out = await run(s.ctx, baseIo(s, { q3Result: "PASS" }));
      expect(out.result).toBe("FAIL");
      expect(out.promptsSent).toBe(1);
      expect(criterion(out, "q3b-hook-fires")).toBe(false);
      expect(out.branch).toBeUndefined();
      expect(s.asked).toEqual([]);
    });
  });

  it("stays pending for a home placement without --allow-home-profile and writes nothing", async () => {
    const s = setup(BLOCK);
    const out = await run(s.ctx, baseIo(s, { placement: "home" }));
    expect(out.result).toBe("pending");
    expect(out.openHumanSteps).toEqual(["HS-S6"]);
    expect(out.notes.join(" ")).toContain("--allow-home-profile");
    expect(existsSync(join(s.home, ".kiro"))).toBe(false);
    expect(existsSync(join(s.root, "hook.token"))).toBe(false);
  });

  it("writes one home file with the flag and deletes it afterwards", async () => {
    const s = setup(BLOCK, true);
    await withFake(s, {}, async () => {
      const out = await run(s.ctx, baseIo(s, { placement: "home" }));
      expect(out.result).toBe("PASS");
      expect(existsSync(join(s.home, ".kiro", "agents", "wraith-spike-q3b.json"))).toBe(false);
    });
  });

  it("is pending when kiro-cli is not found", async () => {
    const s = setup(BLOCK);
    s.ctx.env = () => ({ PATH: "/nonexistent-wraith-dir" });
    const out = await run(s.ctx, baseIo(s));
    expect(out.result).toBe("pending");
    expect(out.reason).toContain("kiro-cli");
  });

  it("is pending when the receiver port is busy", async () => {
    const s = setup(BLOCK);
    const blocker = createServer();
    await new Promise<void>((resolve, reject) => {
      blocker.once("error", reject);
      blocker.listen(HOOK_PORT, "127.0.0.1", () => resolve());
    });
    try {
      const out = await run(s.ctx, baseIo(s));
      expect(out.result).toBe("pending");
      expect(out.reason).toContain("busy");
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  });
});

describe("Q3b helpers", () => {
  it("quotes only paths a shell would split", () => {
    expect(shellQuote("/a/b-c_d.ts")).toBe("/a/b-c_d.ts");
    expect(shellQuote("/a b/it's")).toBe(`'/a b/it'\\''s'`);
    expect(hookCommand("/tmp/root", "/repo/hook-client.ts")).toBe(
      "node --experimental-strip-types /repo/hook-client.ts /tmp/root",
    );
  });

  it("decides the joint branch with Q3", () => {
    expect(decideBranch("FAIL", "FAIL")).toMatchObject({ stop: true, branch: STOP_BRANCH });
    expect(decideBranch("PASS", "FAIL")).toMatchObject({ stop: false, branch: ONE_SHOT_BRANCH });
    expect(decideBranch("PASS", "PASS").branch).toBeUndefined();
    expect(decideBranch("FAIL", "PASS").stop).toBe(false);
    expect(decideBranch("FAIL", null).stop).toBe(false);
  });

  it("reads the newest Q3 result", () => {
    const repo = temp("wraith-q3b-q3-");
    expect(readQ3Result(repo)).toBeNull();
    for (const [stamp, result] of [
      ["20260101T000000Z", "PASS"],
      ["20260102T000000Z", "FAIL"],
    ] as const) {
      const d = join(repo, "spike/kiro/q3/evidence", stamp);
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, "index.json"), JSON.stringify({ result }));
    }
    expect(readQ3Result(repo)).toBe("FAIL");
  });
});
