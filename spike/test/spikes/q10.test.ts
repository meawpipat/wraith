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
import { compareFrames, methodSequence } from "../../kiro/q10/compare.ts";
import { findSdkRoot, readSdkFieldNames, run } from "../../kiro/q10/q10.ts";
import type { AcpFrame } from "../../lib/acp-echo.ts";
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

interface Setup {
  ctx: SpikeContext;
  root: string;
  repo: string;
  home: string;
  logFile: string;
  files: Map<string, string>;
  asked: PermissionRequest[];
}

function setup(allowHomeProfile = false): Setup {
  const root = temp("wraith-q10-");
  const repo = temp("wraith-q10-repo-");
  const home = temp("wraith-q10-home-");
  const scratch = join(root, "scratch");
  const evDir = join(root, "evidence-out");
  mkdirSync(scratch);
  mkdirSync(evDir);
  writeMarker({
    v: 1,
    session: "wsp",
    qs: ["q10"],
    root,
    runnerPid: process.pid,
    startedAt: new Date().toISOString(),
    nonce: newNonce(),
    pids: [],
    agentFiles: [],
  });
  const meta = readSpikeMeta("q10");
  if (!meta.ok) throw new Error(meta.reason);
  const files = new Map<string, string>();
  const asked: PermissionRequest[] = [];
  const ctx: SpikeContext = {
    q: "q10",
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
      return ALLOW;
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

function frame(dir: AcpFrame["dir"], msg: unknown): AcpFrame {
  return { t: 0, dir, msg };
}

const SEQ: AcpFrame[] = [
  frame("c2a", { id: 1, method: "initialize" }),
  frame("a2c", { id: 1, result: {} }),
  frame("c2a", { id: 2, method: "session/new" }),
  frame("a2c", {
    method: "session/update",
    params: { update: { sessionUpdate: "agent_message_chunk" } },
  }),
  frame("a2c", {
    method: "session/update",
    params: { update: { sessionUpdate: "agent_message_chunk" } },
  }),
  frame("a2c", { id: "a", method: "session/request_permission" }),
];

describe("compareFrames", () => {
  it("is equal for the same sequence even when chunk counts differ", () => {
    const sdk = [...SEQ.slice(0, 4), ...SEQ.slice(5)];
    const r = compareFrames({ frames: SEQ, error: null }, { frames: sdk, error: null });
    expect(r.equal).toBe(true);
    expect(r.firstDivergence).toBeNull();
    expect(methodSequence(SEQ)).toEqual([
      "c2a:initialize",
      "c2a:session/new",
      "a2c:session/update:agent_message_chunk",
      "a2c:session/request_permission",
    ]);
  });

  it("reports the first divergence on a different sequence", () => {
    const sdk = [
      ...SEQ.slice(0, 2),
      frame("c2a", { id: 2, method: "session/load" }),
      ...SEQ.slice(3),
    ];
    const r = compareFrames({ frames: SEQ, error: null }, { frames: sdk, error: null });
    expect(r.equal).toBe(false);
    expect(r.firstDivergence).toBe(1);
  });

  it("is not equal when the SDK client threw, even with the same frames", () => {
    const r = compareFrames(
      { frames: SEQ, error: null },
      { frames: SEQ, error: "schema rejected" },
    );
    expect(r.equal).toBe(false);
    expect(r.sdkError).toBe("schema rejected");
  });
});

describe("Q10 script (fake kiro-cli, stubbed owner)", () => {
  it("has a valid metadata block", () => {
    const m = readSpikeMeta("q10");
    expect(m.ok && m.meta.runBy).toBe("owner");
    expect(m.ok && m.meta.maxPrompts).toBe(6);
    expect(m.ok && m.meta.maxWallSeconds).toBe(2400);
    expect(m.ok && m.meta.depends).toEqual(["q3"]);
    expect(m.ok && m.meta.human).toEqual(["HS-S2", "HS-S3"]);
  });

  it("passes when the scenario runs through the raw client and the SDK", async () => {
    const s = setup();
    await withFake(s, {}, async () => {
      const out = await run(s.ctx, { home: s.home, repoRoot: s.repo, placement: "scratch" });
      expect(out.result).toBe("PASS");
      expect(out.promptsSent).toBe(2);
      expect(s.asked).toHaveLength(2);
      expect(out.criteria.every((c) => c.ok)).toBe(true);
      const log = records(s.logFile);
      expect(log.filter((r) => r.kind === "argv")).toHaveLength(2);
      expect(log.filter((r) => r.kind === "tool").map((r) => r.ran)).toEqual([true, true]);
      expect(s.files.get("frames-raw.jsonl")).toContain("session/request_permission");
      expect(s.files.get("frames-sdk.jsonl")).toContain("session/request_permission");
      const names = JSON.parse(s.files.get("field-names.json") ?? "{}");
      expect(names.q11Confirmed).toBe(true);
      expect(names.sessionList.method).toBe("session/list");
    });
  });

  it("passes without a permission request on either client", async () => {
    const s = setup();
    await withFake(s, { askPermission: false }, async () => {
      const out = await run(s.ctx, { home: s.home, repoRoot: s.repo, placement: "scratch" });
      expect(out.result).toBe("PASS");
      expect(s.asked).toEqual([]);
    });
  });

  it("launches without --agent when Q43 failed", async () => {
    const s = setup();
    await withFake(s, {}, async () => {
      await run(s.ctx, { home: s.home, repoRoot: s.repo, placement: "none" });
      for (const r of records(s.logFile).filter((x) => x.kind === "argv")) {
        expect(r.argv).toEqual(["acp", "--agent-engine", "v3"]);
      }
    });
  });

  it("ends pending with the reason when the SDK was not added", async () => {
    const s = setup();
    const out = await run(s.ctx, { sdkMissing: "license not permissive", placement: "scratch" });
    expect(out.result).toBe("pending");
    expect(out.reason).toContain("license not permissive");
    expect(records(s.logFile)).toEqual([]);
  });

  it("stays pending for a home placement without --allow-home-profile and writes nothing", async () => {
    const s = setup();
    const out = await run(s.ctx, { home: s.home, repoRoot: s.repo, placement: "home" });
    expect(out.result).toBe("pending");
    expect(out.openHumanSteps).toEqual(["HS-S6"]);
    expect(existsSync(join(s.home, ".kiro"))).toBe(false);
  });

  it("is pending when kiro-cli is not found", async () => {
    const s = setup();
    s.ctx.env = () => ({ PATH: "/nonexistent-wraith-dir" });
    const out = await run(s.ctx, { home: s.home, repoRoot: s.repo, placement: "scratch" });
    expect(out.result).toBe("pending");
    expect(out.reason).toContain("kiro-cli");
  });
});

describe("readSdkFieldNames", () => {
  it("reads the installed SDK schema and confirms the Q11 entry", () => {
    const root = findSdkRoot();
    expect(root).not.toBeNull();
    const r = readSdkFieldNames(root as string);
    if ("error" in r) throw new Error(r.error);
    expect(r.license).toBe("Apache-2.0");
    expect(r.mcpHttp?.required).toEqual(expect.arrayContaining(["name", "url", "headers"]));
    expect(r.header?.required).toEqual(["name", "value"]);
    expect(r.sessionList.capability).toBe(true);
    expect(r.q11Confirmed).toBe(true);
  });

  it("reports an error for a folder that is not the SDK", () => {
    const r = readSdkFieldNames(temp("wraith-q10-nosdk-"));
    expect("error" in r).toBe(true);
  });
});
