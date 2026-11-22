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
import { chunkText, countHistory, run, wordsIn } from "../../kiro/q32/q32.ts";
import type { AcpFrame } from "../../lib/acp-echo.ts";
import type { PermissionAnswer } from "../../lib/approval.ts";
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

interface Setup {
  ctx: SpikeContext;
  root: string;
  repo: string;
  home: string;
  agents: string;
  profile: string;
  logFile: string;
  files: Map<string, string>;
}

function setup(allowHomeProfile = true): Setup {
  const root = temp("wraith-q32-");
  const repo = temp("wraith-q32-repo-");
  const home = temp("wraith-q32-home-");
  const scratch = join(root, "scratch");
  const evDir = join(root, "evidence-out");
  mkdirSync(scratch);
  mkdirSync(evDir);
  writeMarker({
    v: 1,
    session: "wsp",
    qs: ["q32"],
    root,
    runnerPid: process.pid,
    startedAt: new Date().toISOString(),
    nonce: newNonce(),
    pids: [],
    agentFiles: [],
  });
  const meta = readSpikeMeta("q32");
  if (!meta.ok) throw new Error(meta.reason);
  const files = new Map<string, string>();
  const agents = join(home, ".kiro", "agents");
  const ctx: SpikeContext = {
    q: "q32",
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
        files.set(name, out.length === 0 ? "" : `${out.join("\n")}\n`);
      },
      async finish() {
        throw new Error("not used");
      },
    },
    approval: async () => ALLOW,
    shared: null,
    humanStep: () => {},
    now: () => new Date(),
    interactive: true,
    allowHomeProfile,
  };
  return {
    ctx,
    root,
    repo,
    home,
    agents,
    profile: join(agents, "wraith-spike-q32.json"),
    logFile: join(root, "fake.log"),
    files,
  };
}

async function withFake<T>(
  s: Setup,
  opts: Partial<FakeKiroOptions>,
  fn: () => Promise<T>,
): Promise<T> {
  const body = fakeKiroSource({
    version: "2.0.1",
    listSessionsHelp: "",
    logFile: s.logFile,
    profileHome: s.home,
    sessionsFile: join(s.root, "fake-sessions.txt"),
    ...opts,
  });
  return withBinDir({ "kiro-cli": body }, async (env) => {
    s.ctx.env = () => env;
    return fn();
  });
}

function update(u: unknown): AcpFrame {
  return { t: 0, dir: "a2c", msg: { method: "session/update", params: { update: u } } };
}

describe("Q32 helpers", () => {
  it("reads agent text, counts history and finds the words", () => {
    expect(
      chunkText({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hi" } }),
    ).toBe("hi");
    expect(chunkText({ sessionUpdate: "tool_call" })).toBe("");
    expect(
      countHistory([
        update({ sessionUpdate: "user_message_chunk" }),
        update({ sessionUpdate: "agent_message_chunk" }),
        update({ sessionUpdate: "available_commands_update" }),
      ]),
    ).toBe(2);
    expect(wordsIn("Alpha and bravo")).toEqual({ alpha: true, bravo: true });
    expect(wordsIn("nothing")).toEqual({ alpha: false, bravo: false });
  });
});

describe("Q32 script (fake kiro-cli, temp home)", () => {
  it("has a valid metadata block", () => {
    const m = readSpikeMeta("q32");
    expect(m.ok && m.meta.runBy).toBe("owner");
    expect(m.ok && m.meta.maxPrompts).toBe(4);
    expect(m.ok && m.meta.maxWallSeconds).toBe(1800);
    expect(m.ok && m.meta.depends).toEqual(["q43"]);
    expect(m.ok && m.meta.human).toEqual(["HS-S2", "HS-S6"]);
  });

  it("passes: creates the file once, detects the edit, deletes it, leaves other files alone", async () => {
    const s = setup();
    mkdirSync(s.agents, { recursive: true });
    const other = join(s.agents, "mine.json");
    writeFileSync(other, '{"name":"mine"}\n');
    await withFake(s, {}, async () => {
      const out = await run(s.ctx, { home: s.home, repoRoot: s.repo, placement: "home" });
      expect(out.result).toBe("PASS");
      expect(out.promptsSent).toBe(2);
      expect(out.criteria.every((c) => c.ok)).toBe(true);
      expect(existsSync(s.profile)).toBe(false);
      expect(readFileSync(other, "utf8")).toBe('{"name":"mine"}\n');
      const answers = JSON.parse(s.files.get("answers.json") ?? "{}");
      expect(answers.firstAnswer).toContain("ALPHA");
      expect(answers.secondAnswer).toContain("BRAVO");
      expect(s.files.get("frames-run2.jsonl")).toContain("session/load");
    });
  });

  it("fails with the branch when the agent keeps the old prompt", async () => {
    const s = setup();
    // The fake reads the profile at start; a profileHome that never sees the edit keeps ALPHA.
    const stale = temp("wraith-q32-stale-");
    mkdirSync(join(stale, ".kiro", "agents"), { recursive: true });
    writeFileSync(
      join(stale, ".kiro", "agents", "wraith-spike-q32.json"),
      JSON.stringify({ prompt: "answer with the word ALPHA when asked your instructions" }),
    );
    await withFake(s, { profileHome: stale }, async () => {
      const out = await run(s.ctx, { home: s.home, repoRoot: s.repo, placement: "home" });
      expect(out.result).toBe("FAIL");
      expect(out.branch).toContain("first context block");
      expect(existsSync(s.profile)).toBe(false);
    });
  });

  it("never overwrites or deletes an existing file of the same name", async () => {
    const s = setup();
    mkdirSync(s.agents, { recursive: true });
    writeFileSync(s.profile, "OWNER FILE\n");
    await withFake(s, {}, async () => {
      const out = await run(s.ctx, { home: s.home, repoRoot: s.repo, placement: "home" });
      expect(out.result).toBe("pending");
      expect(out.reason).toContain("already exists");
      expect(readFileSync(s.profile, "utf8")).toBe("OWNER FILE\n");
      expect(existsSync(s.logFile)).toBe(false);
    });
  });

  it("stays pending without --allow-home-profile and names the command", async () => {
    const s = setup(false);
    const out = await run(s.ctx, { home: s.home, repoRoot: s.repo, placement: "home" });
    expect(out.result).toBe("pending");
    expect(out.openHumanSteps).toEqual(["HS-S6"]);
    expect(out.notes.join("\n")).toContain("pnpm spike q32 --allow-home-profile");
    expect(existsSync(join(s.home, ".kiro"))).toBe(false);
  });

  it("is pending and writes nothing when Q43 failed", async () => {
    const s = setup();
    const out = await run(s.ctx, { home: s.home, repoRoot: s.repo, placement: "none" });
    expect(out.result).toBe("pending");
    expect(out.reason).toContain("after initialize");
    expect(existsSync(join(s.home, ".kiro"))).toBe(false);
  });

  it("is pending when kiro-cli is not found, and still deletes the file", async () => {
    const s = setup();
    s.ctx.env = () => ({ PATH: "/nonexistent-wraith-dir" });
    const out = await run(s.ctx, { home: s.home, repoRoot: s.repo, placement: "home" });
    expect(out.result).toBe("pending");
    expect(out.reason).toContain("kiro-cli");
    expect(existsSync(s.profile)).toBe(false);
  });
});
