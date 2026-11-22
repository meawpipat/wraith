import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";
import { compareReplays } from "../../kiro/q23/compare.ts";
import { run } from "../../kiro/q23/q23.ts";
import { readSpikeMeta } from "../../lib/meta.ts";
import type { SharedSession, SpikeContext } from "../../lib/outcome.ts";
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

interface Setup {
  ctx: SpikeContext;
  repo: string;
  home: string;
  files: Map<string, string>;
}

function setup(shared: SharedSession | null, allowHomeProfile = false): Setup {
  const root = temp("wraith-q23-");
  const repo = temp("wraith-q23-repo-");
  const home = temp("wraith-q23-home-");
  const scratch = join(root, "scratch");
  const evDir = join(root, "evidence-out");
  mkdirSync(scratch);
  mkdirSync(evDir);
  writeMarker({
    v: 1,
    session: "wsp",
    qs: ["q23"],
    root,
    runnerPid: process.pid,
    startedAt: new Date().toISOString(),
    nonce: newNonce(),
    pids: [],
    agentFiles: [],
  });
  const meta = readSpikeMeta("q23");
  if (!meta.ok) throw new Error(meta.reason);
  const files = new Map<string, string>();
  const ctx: SpikeContext = {
    q: "q23",
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
    approval: async () => {
      throw new Error("Q23 sends no prompt; no approval expected");
    },
    shared,
    humanStep: () => {},
    now: () => new Date(),
    interactive: true,
    allowHomeProfile,
  };
  return { ctx, repo, home, files };
}

function q3Shared(): SharedSession {
  return { owner: "q3", data: { sessionId: "sess-1", cwd: "" } };
}

async function withFake<T>(
  s: Setup,
  opts: Partial<FakeKiroOptions>,
  fn: () => Promise<T>,
): Promise<T> {
  const body = fakeKiroSource({ version: "2.0.1", listSessionsHelp: "", ...opts });
  return withBinDir({ "kiro-cli": body }, async (env) => {
    s.ctx.env = () => env;
    return fn();
  });
}

describe("compareReplays", () => {
  const chunk = (id: string) => ({ sessionUpdate: "agent_message_chunk", messageId: id });
  const call = (id: string) => ({ sessionUpdate: "tool_call", toolCallId: id });

  it("is equal for the same ids and ignores other update kinds", () => {
    const a = [chunk("m1"), { sessionUpdate: "user_message_chunk" }, call("t1")];
    const b = [chunk("m1"), call("t1")];
    const r = compareReplays(a, b);
    expect(r.equal && r.comparable).toBe(true);
  });

  it("reports ids that differ", () => {
    const r = compareReplays([chunk("m1"), call("t1")], [chunk("m1-r2"), call("t1")]);
    expect(r.equal).toBe(false);
    expect(r.onlyInA).toEqual(["agent_message_chunk:m1"]);
    expect(r.onlyInB).toEqual(["agent_message_chunk:m1-r2"]);
  });

  it("reads recorded frames and counts updates without an id", () => {
    const frame = (u: unknown) => ({
      dir: "a2c",
      msg: { method: "session/update", params: { update: u } },
    });
    const r = compareReplays([frame(chunk("m1")), frame({ sessionUpdate: "tool_call" })], []);
    expect(r.a.ids).toEqual(["agent_message_chunk:m1"]);
    expect(r.a.withoutId).toBe(1);
    expect(r.comparable).toBe(false);
  });

  it("property: a replay equals itself and differs once an id changes", () => {
    fc.assert(
      fc.property(
        fc.array(fc.stringMatching(/^[a-z0-9]{1,6}$/), { minLength: 1, maxLength: 8 }),
        (ids) => {
          const a = ids.map(chunk);
          const b = ids.map((id, i) => (i === 0 ? chunk(`${id}-x`) : chunk(id)));
          return compareReplays(a, a).equal && !compareReplays(a, b).equal;
        },
      ),
      { numRuns: 50 },
    );
  });
});

describe("Q23 script (fake kiro-cli)", () => {
  it("has a valid metadata block", () => {
    const m = readSpikeMeta("q23");
    expect(m.ok && m.meta.maxPrompts).toBe(0);
    expect(m.ok && m.meta.depends).toEqual(["q3"]);
    expect(m.ok && m.meta.shares).toBe("q3");
    expect(m.ok && m.meta.human).toEqual(["HS-S2"]);
  });

  it("passes when both loads replay equal ids", async () => {
    const s = setup(q3Shared());
    await withFake(s, {}, async () => {
      const out = await run(s.ctx, {
        home: s.home,
        repoRoot: s.repo,
        placement: "scratch",
        seedSession: true,
      });
      expect(out.result).toBe("PASS");
      expect(out.promptsSent).toBe(0);
      expect(s.files.has("comparison.json")).toBe(true);
      expect(s.files.get("replay-1.jsonl")).toContain("agent_message_chunk");
    });
  });

  it("fails with the dedupe branch when the replayed ids change", async () => {
    const s = setup(q3Shared());
    await withFake(s, { changeReplayIds: true }, async () => {
      const out = await run(s.ctx, {
        home: s.home,
        repoRoot: s.repo,
        placement: "scratch",
        seedSession: true,
      });
      expect(out.result).toBe("FAIL");
      expect(out.branch).toContain("hash(turnIndex, text)");
    });
  });

  it("is partial when the session is unknown to the agent", async () => {
    const s = setup(q3Shared());
    await withFake(s, {}, async () => {
      const out = await run(s.ctx, { home: s.home, repoRoot: s.repo, placement: "scratch" });
      expect(out.result).toBe("PARTIAL");
    });
  });

  it("ends pending alone, without a q3 session in the run", async () => {
    for (const shared of [null, { owner: "q3", data: {} } as SharedSession]) {
      const s = setup(shared);
      const out = await run(s.ctx, { home: s.home, repoRoot: s.repo, placement: "scratch" });
      expect(out.result).toBe("pending");
      expect(out.reason).toBe("needs q3 session in the same run");
    }
  });

  it("stays pending for a home placement without the flag and writes nothing", async () => {
    const s = setup(q3Shared());
    const out = await run(s.ctx, { home: s.home, repoRoot: s.repo, placement: "home" });
    expect(out.result).toBe("pending");
    expect(out.openHumanSteps).toEqual(["HS-S6"]);
    expect(existsSync(join(s.home, ".kiro"))).toBe(false);
  });
});
