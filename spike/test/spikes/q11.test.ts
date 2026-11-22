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
import { readMcpCapabilities, run, withoutToken } from "../../kiro/q11/q11.ts";
import { readQ43Placement } from "../../lib/kiro-spike.ts";
import { MCP_TOKEN_HEADER, startMcpEcho } from "../../lib/mcp-echo.ts";
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

interface Setup {
  ctx: SpikeContext;
  repo: string;
  home: string;
  logFile: string;
  files: Map<string, string>;
}

function setup(allowHomeProfile = false): Setup {
  const root = temp("wraith-q11-");
  const repo = temp("wraith-q11-repo-");
  const home = temp("wraith-q11-home-");
  const scratch = join(root, "scratch");
  const evDir = join(root, "evidence-out");
  mkdirSync(scratch);
  mkdirSync(evDir);
  writeMarker({
    v: 1,
    session: "wsp",
    qs: ["q11"],
    root,
    runnerPid: process.pid,
    startedAt: new Date().toISOString(),
    nonce: newNonce(),
    pids: [],
    agentFiles: [],
  });
  const meta = readSpikeMeta("q11");
  if (!meta.ok) throw new Error(meta.reason);
  const files = new Map<string, string>();
  const ctx: SpikeContext = {
    q: "q11",
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
    approval: async () => ({
      outcome: "selected",
      optionId: "allow-once",
      kind: "allow_once",
      by: "owner",
    }),
    shared: null,
    humanStep: () => {},
    now: () => new Date(),
    interactive: true,
    allowHomeProfile,
  };
  return { ctx, repo, home, logFile: join(root, "fake.log"), files };
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

describe("Q11 script (fake kiro-cli calling the echo server)", () => {
  it("has a valid metadata block", () => {
    const m = readSpikeMeta("q11");
    expect(m.ok && m.meta.runBy).toBe("owner");
    expect(m.ok && m.meta.maxPrompts).toBe(3);
    expect(m.ok && m.meta.maxWallSeconds).toBe(1800);
    expect(m.ok && m.meta.depends).toEqual(["q43", "q3"]);
    expect(m.ok && m.meta.human).toEqual(["HS-S2", "HS-S3"]);
  });

  it("passes when the echo server sees an echo call with the token header", async () => {
    const s = setup();
    await withFake(s, {}, async () => {
      const out = await run(s.ctx, { home: s.home, repoRoot: s.repo, placement: "scratch" });
      expect(out.result).toBe("PASS");
      expect(out.promptsSent).toBe(1);
      expect(out.criteria.every((c) => c.ok)).toBe(true);
      const log = records(s.logFile);
      expect(log.filter((r) => r.kind === "mcp").map((r) => r.status)).toEqual([200]);
      expect(log.filter((r) => r.kind === "argv").map((r) => r.argv)).toEqual([
        ["acp", "--agent-engine", "v3", "--agent", "wraith-spike-q11"],
      ]);
      const calls = JSON.parse(s.files.get("mcp-calls.json") ?? "{}");
      expect(calls.calls).toEqual([{ tool: "echo", argsLength: 13, headerPresent: true }]);
      expect(calls.capabilities).toEqual({ http: true, sse: false });
    });
  });

  it("keeps the token out of the evidence", async () => {
    const s = setup();
    await withFake(s, {}, async () => {
      await run(s.ctx, { home: s.home, repoRoot: s.repo, placement: "scratch" });
      const frames = s.files.get("frames.jsonl") ?? "";
      expect(frames).toContain("[spike-token]");
      expect(frames).not.toMatch(/[0-9a-f]{48}/);
    });
  });

  it("fails with the stdio-shim branch and the echo-server note when no call arrives", async () => {
    const s = setup();
    await withFake(s, {}, async () => {
      const out = await run(s.ctx, {
        home: s.home,
        repoRoot: s.repo,
        placement: "scratch",
        headerName: "x-wrong-header",
      });
      expect(out.result).toBe("FAIL");
      expect(out.branch).toContain("wraith-mcp-stdio");
      expect(out.notes.join("\n")).toContain("echo server's fault");
      expect(
        records(s.logFile)
          .filter((r) => r.kind === "mcp")
          .map((r) => r.status),
      ).toEqual([401]);
    });
  });

  it("launches without --agent when Q43 failed", async () => {
    const s = setup();
    await withFake(s, {}, async () => {
      await run(s.ctx, { home: s.home, repoRoot: s.repo, placement: "none" });
      expect(records(s.logFile).find((r) => r.kind === "argv")?.argv).toEqual([
        "acp",
        "--agent-engine",
        "v3",
      ]);
    });
  });

  it("stays pending for a home placement without the flag and writes nothing", async () => {
    const s = setup();
    const out = await run(s.ctx, { home: s.home, repoRoot: s.repo, placement: "home" });
    expect(out.result).toBe("pending");
    expect(out.openHumanSteps).toEqual(["HS-S6"]);
    expect(out.notes.join("\n")).toContain("--allow-home-profile");
    expect(existsSync(join(s.home, ".kiro"))).toBe(false);
  });

  it("writes one home file with the flag and deletes it afterwards", async () => {
    const s = setup(true);
    await withFake(s, {}, async () => {
      const out = await run(s.ctx, { home: s.home, repoRoot: s.repo, placement: "home" });
      expect(out.result).toBe("PASS");
      expect(existsSync(join(s.home, ".kiro", "agents", "wraith-spike-q11.json"))).toBe(false);
    });
  });

  it("is pending when kiro-cli is not found", async () => {
    const s = setup();
    s.ctx.env = () => ({ PATH: "/nonexistent-wraith-dir" });
    const out = await run(s.ctx, { home: s.home, repoRoot: s.repo, placement: "scratch" });
    expect(out.result).toBe("pending");
    expect(out.reason).toContain("kiro-cli");
  });
});

describe("Q11 helpers and the echo server token", () => {
  it("requires the token header on the echo server", async () => {
    const echo = await startMcpEcho({ token: "t0ken" });
    try {
      const body = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "echo", arguments: { text: "hi" } },
      });
      const bare = await fetch(echo.url, { method: "POST", body });
      expect(bare.status).toBe(401);
      const wrong = await fetch(echo.url, {
        method: "POST",
        body,
        headers: { [MCP_TOKEN_HEADER]: "other" },
      });
      expect(wrong.status).toBe(401);
      expect(echo.calls()).toEqual([]);
      const ok = await fetch(echo.url, {
        method: "POST",
        body,
        headers: { [MCP_TOKEN_HEADER]: "t0ken" },
      });
      expect(ok.status).toBe(200);
      expect(echo.calls()).toHaveLength(1);
    } finally {
      await echo.close();
    }
  });

  it("reads mcpCapabilities from an initialize result", () => {
    expect(readMcpCapabilities({ agentCapabilities: { mcpCapabilities: { http: true } } })).toEqual(
      {
        http: true,
      },
    );
    expect(readMcpCapabilities({ mcpCapabilities: { sse: true } })).toEqual({ sse: true });
    expect(readMcpCapabilities({})).toBeNull();
    expect(readMcpCapabilities(null)).toBeNull();
  });

  it("replaces the token in log lines", async () => {
    async function* src(): AsyncGenerator<string> {
      yield 'a "tok" b';
      yield "none";
    }
    const out: string[] = [];
    for await (const l of withoutToken(src(), "tok")) out.push(l);
    expect(out).toEqual(['a "[spike-token]" b', "none"]);
  });

  it("still reads the Q43 placement helper it depends on", () => {
    expect(readQ43Placement(temp("wraith-q11-p-"))).toBe("unknown");
  });
});
