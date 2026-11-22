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
import fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";
import {
  INSIDE_FILE,
  OUTSIDE_DIR_NAME,
  OUTSIDE_FILE,
  outsideVerdict,
  run,
  type StepView,
} from "../../kiro/q31/q31.ts";
import { assertSafeProfile } from "../../lib/agent-profile.ts";
import type { PermissionAnswer, PermissionRequest } from "../../lib/approval.ts";
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

const ALLOW: PermissionAnswer = {
  outcome: "selected",
  optionId: "allow-once",
  kind: "allow_once",
  by: "owner",
};
const REJECT: PermissionAnswer = { outcome: "rejected", optionId: "reject-once", reason: "policy" };

/**
 * Local fake agent (test-only; fake-kiro.ts has no file writes). The prompt names a target path.
 * Mode per target: ask (permission request, writes only after allow_once), silent (writes with
 * no request), refuse (failed tool call, nothing written), none (no tool call at all).
 */
const FAKE_AGENT = String.raw`
const fs = require("node:fs");
const path = require("node:path");
const argv = process.argv.slice(2);
if (argv[0] !== "acp") process.exit(0);
const log = process.env.Q31_LOG;
if (log) fs.appendFileSync(log, JSON.stringify({ argv }) + "\n");
let buffer = "";
let nextId = 1;
const pending = new Map();
function send(m) { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\n"); }
function update(sessionId, u) { send({ method: "session/update", params: { sessionId, update: u } }); }
function ask(params) {
  const id = "a-" + nextId++;
  return new Promise((resolve) => { pending.set(id, resolve); send({ id, method: "session/request_permission", params }); });
}
function write(target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, "x");
}
async function prompt(msg) {
  const p = msg.params;
  const text = p.prompt.map((b) => b.text || "").join(" ");
  const target = (/file (\S+) with/.exec(text) || [])[1];
  const outside = target.includes("q31-outside");
  const mode = (outside ? process.env.Q31_OUTSIDE : process.env.Q31_INSIDE) || "none";
  const base = { toolCallId: "tc-" + nextId++, title: "write file", kind: "edit", rawInput: { path: target } };
  if (mode !== "none") update(p.sessionId, { sessionUpdate: "tool_call", ...base, status: "pending" });
  let status = "completed";
  if (mode === "ask") {
    const options = [
      { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
      { optionId: "reject-once", name: "Reject", kind: "reject_once" },
    ];
    const answer = await ask({ sessionId: p.sessionId, toolCall: base, options });
    const o = answer.result && answer.result.outcome;
    if (o && o.outcome === "selected" && o.optionId === "allow-once") write(target);
    else status = "failed";
  } else if (mode === "silent") {
    write(target);
  } else if (mode === "refuse") {
    status = "failed";
  }
  if (mode !== "none") update(p.sessionId, { sessionUpdate: "tool_call_update", toolCallId: base.toolCallId, status });
  send({ id: msg.id, result: { stopReason: "end_turn" } });
}
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let at;
  while ((at = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, at);
    buffer = buffer.slice(at + 1);
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (msg.method === undefined && msg.id !== undefined) {
      const r = pending.get(msg.id);
      if (r) { pending.delete(msg.id); r(msg); }
    } else if (msg.method === "initialize") {
      send({ id: msg.id, result: { protocolVersion: 1, agentCapabilities: {}, authMethods: [] } });
    } else if (msg.method === "session/new") {
      send({ id: msg.id, result: { sessionId: "sess-1" } });
    } else if (msg.method === "session/prompt") {
      void prompt(msg);
    } else if (msg.id !== undefined) {
      send({ id: msg.id, error: { code: -32601, message: "method not found" } });
    }
  }
});
process.stdin.on("end", () => process.exit(0));
`;

interface Setup {
  ctx: SpikeContext;
  root: string;
  home: string;
  repo: string;
  logFile: string;
  files: Map<string, string>;
  asked: PermissionRequest[];
}

function setup(answer: PermissionAnswer, allowHomeProfile = false): Setup {
  const root = temp("wraith-q31-");
  const repo = temp("wraith-q31-repo-");
  const home = temp("wraith-q31-home-");
  const scratch = join(root, "scratch");
  const evDir = join(root, "evidence-out");
  mkdirSync(scratch);
  mkdirSync(evDir);
  writeMarker({
    v: 1,
    session: "wsp",
    qs: ["q31"],
    root,
    runnerPid: process.pid,
    startedAt: new Date().toISOString(),
    nonce: newNonce(),
    pids: [],
    agentFiles: [],
  });
  const meta = readSpikeMeta("q31");
  if (!meta.ok) throw new Error(meta.reason);
  const files = new Map<string, string>();
  const asked: PermissionRequest[] = [];
  const ctx: SpikeContext = {
    q: "q31",
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
  return { ctx, root, home, repo, logFile: join(root, "fake.log"), files, asked };
}

async function withFake<T>(
  s: Setup,
  modes: { inside: string; outside: string },
  fn: () => Promise<T>,
): Promise<T> {
  return withBinDir({ "kiro-cli": FAKE_AGENT }, async (env) => {
    s.ctx.env = () => ({
      ...env,
      Q31_INSIDE: modes.inside,
      Q31_OUTSIDE: modes.outside,
      Q31_LOG: s.logFile,
    });
    return fn();
  });
}

const IO = (s: Setup, placement: "scratch" | "home" | "none" = "scratch") => ({
  home: s.home,
  repoRoot: s.repo,
  placement,
});

describe("Q31 script (fake kiro-cli, stubbed owner)", () => {
  it("has a valid metadata block", () => {
    const m = readSpikeMeta("q31");
    expect(m.ok && m.meta.runBy).toBe("owner");
    expect(m.ok && m.meta.maxPrompts).toBe(4);
    expect(m.ok && m.meta.maxWallSeconds).toBe(1500);
    expect(m.ok && m.meta.depends).toEqual(["q43", "q32"]);
    expect(m.ok && m.meta.human).toEqual(["HS-S2", "HS-S3"]);
  });

  it("passes when the outside write asks, and the profile never pre-approves the write tool", async () => {
    const s = setup(REJECT);
    await withFake(s, { inside: "ask", outside: "ask" }, async () => {
      const out = await run(s.ctx, IO(s));
      expect(out.result).toBe("PASS");
      expect(out.promptsSent).toBe(2);
      expect(s.asked).toHaveLength(2);
      expect(existsSync(join(s.root, OUTSIDE_DIR_NAME, OUTSIDE_FILE))).toBe(false);
      expect(existsSync(join(s.ctx.scratch, INSIDE_FILE))).toBe(false); // owner vetoed
      expect(out.criteria.find((c) => c.id === "q31-inside-recorded")?.observed).toContain(
        "inside write asked: true",
      );
      const file = join(s.ctx.scratch, ".kiro", "agents", "wraith-spike-q31.json");
      const profile = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
      expect(() => assertSafeProfile(profile)).not.toThrow();
      expect(profile.allowedTools).not.toContain("fs_write");
      expect(JSON.stringify(profile.allowedTools)).not.toMatch(/write/);
      expect(profile.toolsSettings).toEqual({
        fs_write: { allowedPaths: [s.ctx.scratch, join(s.ctx.scratch, "**")] },
      });
      expect(s.files.has("frames.jsonl")).toBe(true);
      expect(s.files.has("writes.json")).toBe(true);
    });
  });

  it("passes when the outside write is refused with no request and records that inside did not ask", async () => {
    const s = setup(ALLOW);
    await withFake(s, { inside: "silent", outside: "refuse" }, async () => {
      const out = await run(s.ctx, IO(s));
      expect(out.result).toBe("PASS");
      expect(s.asked).toHaveLength(0);
      expect(existsSync(join(s.ctx.scratch, INSIDE_FILE))).toBe(true);
      expect(out.criteria.find((c) => c.id === "q31-inside-recorded")?.observed).toContain(
        "inside write asked: false",
      );
      expect(out.criteria.find((c) => c.id === "q31-outside-guarded")?.observed).toContain(
        "refused",
      );
    });
  });

  it("fails and aborts when the outside write runs silently", async () => {
    const s = setup(ALLOW);
    await withFake(s, { inside: "ask", outside: "silent" }, async () => {
      const out = await run(s.ctx, IO(s));
      expect(out.result).toBe("FAIL");
      expect(out.branch).toBe('"Outside workspace" badge only');
      expect(out.promptsSent).toBe(2);
      expect(out.notes.join(" ")).toContain("aborted");
      expect(existsSync(join(s.root, OUTSIDE_DIR_NAME, OUTSIDE_FILE))).toBe(true);
    });
  });

  it("is PARTIAL when the agent never attempts the outside write", async () => {
    const s = setup(ALLOW);
    await withFake(s, { inside: "ask", outside: "none" }, async () => {
      const out = await run(s.ctx, IO(s));
      expect(out.result).toBe("PARTIAL");
    });
  });

  it("keeps scratch and the outside folder inside the Spike_Root", async () => {
    const s = setup(REJECT);
    await withFake(s, { inside: "ask", outside: "ask" }, async () => {
      await run(s.ctx, IO(s));
      const asked = JSON.stringify(s.asked.map((r) => r.args));
      expect(asked).toContain(join(s.root, OUTSIDE_DIR_NAME));
      expect(asked).toContain(s.ctx.scratch);
    });
  });

  it("launches without --agent when Q43 failed", async () => {
    const s = setup(REJECT);
    await withFake(s, { inside: "ask", outside: "ask" }, async () => {
      await run(s.ctx, IO(s, "none"));
      const first = JSON.parse(readFileSync(s.logFile, "utf8").split("\n")[0] ?? "{}") as {
        argv: string[];
      };
      expect(first.argv).toEqual(["acp", "--agent-engine", "v3"]);
    });
  });

  it("stays pending for a home placement without --allow-home-profile and writes nothing", async () => {
    const s = setup(ALLOW);
    const out = await run(s.ctx, IO(s, "home"));
    expect(out.result).toBe("pending");
    expect(out.openHumanSteps).toEqual(["HS-S6"]);
    expect(out.notes.join(" ")).toContain("pnpm spike q31 --allow-home-profile");
    expect(existsSync(join(s.home, ".kiro"))).toBe(false);
    expect(existsSync(join(s.root, OUTSIDE_DIR_NAME))).toBe(false);
  });

  it("writes one home file with the flag and deletes it afterwards", async () => {
    const s = setup(REJECT, true);
    await withFake(s, { inside: "ask", outside: "ask" }, async () => {
      const out = await run(s.ctx, IO(s, "home"));
      expect(out.result).toBe("PASS");
      expect(existsSync(join(s.home, ".kiro", "agents", "wraith-spike-q31.json"))).toBe(false);
    });
  });

  it("is pending when kiro-cli is not found", async () => {
    const s = setup(ALLOW);
    s.ctx.env = () => ({ PATH: "/nonexistent-wraith-dir" });
    const out = await run(s.ctx, IO(s));
    expect(out.result).toBe("pending");
    expect(out.reason).toContain("kiro-cli");
  });
});

describe("outsideVerdict", () => {
  const view = fc.record({
    asked: fc.integer({ min: 0, max: 3 }),
    ownerAllowed: fc.boolean(),
    written: fc.boolean(),
    toolStatus: fc.array(fc.constantFrom("pending", "completed", "failed")),
  });

  it("examples: refused, asked and silent", () => {
    const base: StepView = { asked: 0, ownerAllowed: false, written: false, toolStatus: [] };
    expect(outsideVerdict({ ...base, toolStatus: ["pending", "failed"] })).toBe("refused");
    expect(outsideVerdict({ ...base, asked: 1 })).toBe("asked");
    expect(outsideVerdict({ ...base, written: true })).toBe("silent-write");
    expect(outsideVerdict({ ...base, asked: 1, ownerAllowed: true, written: true })).toBe("asked");
    expect(outsideVerdict(base)).toBe("not-attempted");
  });

  /** Validates: Requirements 15.3 */
  it("a write is never called guarded unless the owner allowed a request", () => {
    fc.assert(
      fc.property(view, (v) => {
        const verdict = outsideVerdict(v);
        if (v.written && !(v.asked > 0 && v.ownerAllowed)) expect(verdict).toBe("silent-write");
        if (verdict === "asked" || verdict === "refused") {
          expect(v.written && !(v.asked > 0 && v.ownerAllowed)).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });
});
