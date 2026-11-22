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
import { run } from "../../kiro/q3/q3.ts";
import type { PermissionAnswer, PermissionRequest } from "../../lib/approval.ts";
import { readQ43Placement } from "../../lib/kiro-spike.ts";
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
  shared: SharedSession;
}

function setup(answer: PermissionAnswer, allowHomeProfile = false): Setup {
  const root = temp("wraith-q3-");
  const repo = temp("wraith-q3-repo-");
  const home = temp("wraith-q3-home-");
  const scratch = join(root, "scratch");
  const evDir = join(root, "evidence-out");
  mkdirSync(scratch);
  mkdirSync(evDir);
  writeMarker({
    v: 1,
    session: "wsp",
    qs: ["q3"],
    root,
    runnerPid: process.pid,
    startedAt: new Date().toISOString(),
    nonce: newNonce(),
    pids: [],
    agentFiles: [],
  });
  const meta = readSpikeMeta("q3");
  if (!meta.ok) throw new Error(meta.reason);
  const files = new Map<string, string>();
  const asked: PermissionRequest[] = [];
  const shared: SharedSession = { owner: "q3", data: {} };
  const ctx: SpikeContext = {
    q: "q3",
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
    shared,
    humanStep: () => {},
    now: () => new Date(),
    interactive: true,
    allowHomeProfile,
  };
  return { ctx, root, repo, home, logFile: join(root, "fake.log"), files, asked, shared };
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
): Promise<T> {
  const body = fakeKiroSource({
    version: "2.0.1",
    listSessionsHelp: "",
    logFile: s.logFile,
    ...opts,
  });
  return withBinDir({ "kiro-cli": body }, async (env) => {
    s.ctx.env = () => env;
    return fn();
  });
}

describe("Q3 script (fake kiro-cli, stubbed owner)", () => {
  it("has a valid metadata block", () => {
    const m = readSpikeMeta("q3");
    expect(m.ok && m.meta.runBy).toBe("owner");
    expect(m.ok && m.meta.maxPrompts).toBe(4);
    expect(m.ok && m.meta.depends).toEqual(["q43"]);
    expect(m.ok && m.meta.human).toEqual(["HS-S2", "HS-S3"]);
  });

  it("passes on a selected allow_once, writes session.json and the named copy", async () => {
    const s = setup(ALLOW);
    await withFake(s, {}, async () => {
      const out = await run(s.ctx, { home: s.home, repoRoot: s.repo, placement: "scratch" });
      expect(out.result).toBe("PASS");
      expect(out.promptsSent).toBe(1);
      expect(s.asked).toHaveLength(1);
      expect(s.asked[0]?.options.map((o) => o.kind)).toContain("allow_once");
      const session = JSON.parse(s.files.get("session.json") ?? "{}");
      expect(session.sessionId).toBe("sess-1");
      expect(session.cwd).toBe(s.ctx.scratch);
      expect(s.shared.data).toEqual({ sessionId: "sess-1", cwd: s.ctx.scratch });
      expect(existsSync(join(s.repo, "spike/kiro/q3.jsonl"))).toBe(true);
      const log = records(s.logFile);
      expect(log.filter((r) => r.kind === "argv").map((r) => r.argv)).toEqual([
        ["acp", "--agent-engine", "v3", "--agent", "wraith-spike-q3"],
      ]);
      expect(log.filter((r) => r.kind === "tool").map((r) => r.ran)).toEqual([true]);
      expect(existsSync(join(s.ctx.scratch, ".kiro", "agents", "wraith-spike-q3.json"))).toBe(true);
    });
  });

  it("is PARTIAL 'approval tap missing' on a timeout and still publishes the copy", async () => {
    const s = setup(TIMEOUT);
    await withFake(s, {}, async () => {
      const out = await run(s.ctx, { home: s.home, repoRoot: s.repo, placement: "scratch" });
      expect(out.result).toBe("PARTIAL");
      expect(out.reason).toBe("approval tap missing");
      expect(
        records(s.logFile)
          .filter((r) => r.kind === "tool")
          .map((r) => r.ran),
      ).toEqual([false]);
      expect(existsSync(join(s.repo, "spike/kiro/q3.jsonl"))).toBe(true);
    });
  });

  it("fails without a copy when no request_permission arrives", async () => {
    const s = setup(ALLOW);
    await withFake(s, { askPermission: false }, async () => {
      const out = await run(s.ctx, { home: s.home, repoRoot: s.repo, placement: "scratch" });
      expect(out.result).toBe("FAIL");
      expect(out.branch).toContain("Q3b");
      expect(s.asked).toEqual([]);
      expect(s.files.has("session.json")).toBe(true);
      expect(existsSync(join(s.repo, "spike/kiro/q3.jsonl"))).toBe(false);
    });
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
    expect(existsSync(join(s.home, ".kiro"))).toBe(false);
  });

  it("writes one home file with the flag and deletes it afterwards", async () => {
    const s = setup(ALLOW, true);
    await withFake(s, {}, async () => {
      const out = await run(s.ctx, { home: s.home, repoRoot: s.repo, placement: "home" });
      expect(out.result).toBe("PASS");
      expect(existsSync(join(s.home, ".kiro", "agents", "wraith-spike-q3.json"))).toBe(false);
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

describe("readQ43Placement", () => {
  function evidence(repo: string, stamp: string, files: Record<string, unknown>): void {
    const d = join(repo, "spike/kiro/q43/evidence", stamp);
    mkdirSync(d, { recursive: true });
    for (const [n, v] of Object.entries(files)) writeFileSync(join(d, n), JSON.stringify(v));
  }

  it("reads the newest placement and tells a FAIL from a pending run", () => {
    const repo = temp("wraith-q3-p-");
    expect(readQ43Placement(repo)).toBe("unknown");
    evidence(repo, "20260101T000000Z", { "placement.json": { placement: "home" } });
    expect(readQ43Placement(repo)).toBe("home");
    evidence(repo, "20260102T000000Z", {
      "placement.json": { placement: null },
      "summary.json": { result: "FAIL" },
    });
    expect(readQ43Placement(repo)).toBe("none");
    evidence(repo, "20260103T000000Z", { "placement.json": { placement: null } });
    expect(readQ43Placement(repo)).toBe("unknown");
    evidence(repo, "20260104T000000Z", { "placement.json": { placement: "scratch" } });
    expect(readQ43Placement(repo)).toBe("scratch");
  });
});
