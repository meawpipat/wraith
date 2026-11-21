import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FAIL_BRANCH, run } from "../../kiro/q43/q43.ts";
import { readSpikeMeta } from "../../lib/meta.ts";
import type { SpikeContext } from "../../lib/outcome.ts";
import { newNonce, readMarker, writeMarker } from "../../lib/own-marker.ts";
import { withBinDir } from "../support/bin-dir.ts";
import { type FakeKiroOptions, fakeKiroSource } from "../support/fake-kiro.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

interface Setup {
  ctx: SpikeContext;
  root: string;
  home: string;
  logFile: string;
  files: Map<string, string>;
  steps: string[];
}

function setup(env: Record<string, string>, allowHomeProfile = false): Setup {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "wraith-q43-")));
  const home = realpathSync(mkdtempSync(join(tmpdir(), "wraith-q43-home-")));
  dirs.push(root, home);
  const scratch = join(root, "scratch");
  mkdirSync(scratch);
  writeMarker({
    v: 1,
    session: "wsp",
    qs: ["q43"],
    root,
    runnerPid: process.pid,
    startedAt: new Date().toISOString(),
    nonce: newNonce(),
    pids: [],
    agentFiles: [],
  });
  const meta = readSpikeMeta("q43");
  if (!meta.ok) throw new Error(meta.reason);
  const files = new Map<string, string>();
  const steps: string[] = [];
  const ctx = {
    q: "q43",
    meta: meta.meta,
    root,
    scratch,
    env: () => env,
    evidence: {
      async addText(name: string, text: string) {
        files.set(name, text);
      },
      async addJsonl(name: string, src: AsyncIterable<string>) {
        const out: string[] = [];
        for await (const l of src) out.push(l);
        files.set(name, out.join("\n"));
      },
    },
    humanStep: (id: string) => {
      steps.push(id);
    },
    allowHomeProfile,
  } as unknown as SpikeContext;
  return { ctx, root, home, logFile: join(root, "fake.log"), files, steps };
}

function records(logFile: string): Record<string, unknown>[] {
  if (!existsSync(logFile)) return [];
  return readFileSync(logFile, "utf8")
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

/** `onlyWhenHomeFile` makes the fake refuse to start unless the home profile exists. */
async function withFake<T>(
  opts: Partial<FakeKiroOptions>,
  onlyWhenHomeFile: boolean,
  fn: (s: Setup) => Promise<T>,
  allowHomeProfile = onlyWhenHomeFile,
): Promise<T> {
  const holder: { s: Setup | null } = { s: null };
  const probe = (): Setup => {
    if (holder.s === null) throw new Error("setup not ready");
    return holder.s;
  };
  // The fake needs its log path and the home folder before the bin dir exists, so build them first.
  const early = setup({}, allowHomeProfile);
  holder.s = early;
  const gate = onlyWhenHomeFile
    ? `if (!require("node:fs").existsSync(${JSON.stringify(
        join(early.home, ".kiro", "agents", "wraith-spike-q43.json"),
      )})) process.exit(1);\n`
    : "";
  const body = `${gate}${fakeKiroSource({
    version: "2.0.1",
    listSessionsHelp: "",
    logFile: early.logFile,
    ...opts,
  })}`;
  return withBinDir({ "kiro-cli": body }, async (env) => {
    const ready = probe();
    ready.ctx.env = () => env;
    return fn(ready);
  });
}

const io = (s: Setup) => ({ home: s.home });

describe("Q43 script (fake kiro-cli)", () => {
  it("has a valid metadata block", () => {
    const m = readSpikeMeta("q43");
    expect(m.ok && m.meta.maxPrompts).toBe(1);
    expect(m.ok && m.meta.runBy).toBe("loop");
    expect(m.ok && m.meta.agents).toEqual(["kiro"]);
  });

  it("passes with the scratch placement, one prompt, and only reject answers", async () => {
    await withFake({}, false, async (s) => {
      const out = await run(s.ctx, io(s));
      expect(out.result).toBe("PASS");
      expect(JSON.parse(s.files.get("placement.json") ?? "{}").placement).toBe("scratch");
      expect(out.promptsSent).toBe(1);
      expect(existsSync(join(s.home, ".kiro"))).toBe(false);
      expect(existsSync(join(s.ctx.scratch, ".kiro", "agents", "wraith-spike-q43.json"))).toBe(
        true,
      );
      const log = records(s.logFile);
      const argvs = log.filter((r) => r.kind === "argv").map((r) => r.argv);
      expect(argvs).toEqual([["acp", "--agent-engine", "v3", "--agent", "wraith-spike-q43"]]);
      const answers = log.filter((r) => r.kind === "permission").map((r) => r.answer);
      expect(answers).toEqual([{ outcome: "selected", optionId: "reject-once" }]);
      expect(log.filter((r) => r.kind === "tool").every((r) => r.ran === false)).toBe(true);
      expect(log.filter((r) => r.kind === "prompt").length).toBeLessThanOrEqual(1);
    });
  });

  it("falls back to one new home file, retries once, and deletes it", async () => {
    await withFake({}, true, async (s) => {
      const out = await run(s.ctx, io(s));
      const homeFile = join(s.home, ".kiro", "agents", "wraith-spike-q43.json");
      expect(out.result).toBe("PASS");
      expect(JSON.parse(s.files.get("placement.json") ?? "{}").placement).toBe("home");
      expect(s.steps).toEqual(["HS-S6"]);
      expect(existsSync(homeFile)).toBe(false);
      const marked = readMarker(s.root)?.agentFiles.map((f) => f.path) ?? [];
      expect(marked).toContain(homeFile);
      expect(marked).toHaveLength(2);
      expect(out.promptsSent).toBe(1);
    });
  });

  it("fails with the branch text when the agent is rejected everywhere", async () => {
    await withFake(
      { acceptedAgents: [] },
      false,
      async (s) => {
        const out = await run(s.ctx, io(s));
        expect(out.result).toBe("FAIL");
        expect(out.branch).toBe(FAIL_BRANCH);
        expect(FAIL_BRANCH).toContain("§4.4/§5 argv");
        expect(FAIL_BRANCH).toContain("session/set_mode");
        expect(out.promptsSent).toBe(0);
        expect(JSON.parse(s.files.get("placement.json") ?? "{}").placement).toBeNull();
        expect(existsSync(join(s.home, ".kiro", "agents", "wraith-spike-q43.json"))).toBe(false);
      },
      true,
    );
  });

  it("without the flag writes nothing to home, stays pending and launches once", async () => {
    await withFake({ acceptedAgents: [] }, false, async (s) => {
      const out = await run(s.ctx, io(s));
      expect(out.result).toBe("pending");
      expect(out.reason).toBe("scratch profile not found; HS-S6 open");
      expect(out.openHumanSteps).toEqual(["HS-S6"]);
      expect(out.notes.join("\n")).toContain("pnpm spike q43 --allow-home-profile");
      expect(JSON.parse(s.files.get("placement.json") ?? "{}").placement).toBeNull();
      expect(existsSync(join(s.home, ".kiro"))).toBe(false);
      expect(records(s.logFile).filter((r) => r.kind === "argv")).toHaveLength(1);
      expect(s.steps).toEqual([]);
    });
  });

  it("fails after one prompt when the tool never asks", async () => {
    await withFake({ askPermission: false }, false, async (s) => {
      const out = await run(s.ctx, io(s));
      expect(out.result).toBe("FAIL");
      expect(out.branch).toBe(FAIL_BRANCH);
      expect(out.promptsSent).toBe(1);
      expect(records(s.logFile).filter((r) => r.kind === "permission")).toEqual([]);
    });
  });

  it("stays pending when kiro-cli is not found", async () => {
    const s = setup({ PATH: "/nonexistent-wraith-dir" });
    const out = await run(s.ctx, io(s));
    expect(out.result).toBe("pending");
    expect(out.reason).toContain("kiro-cli");
  });
});
