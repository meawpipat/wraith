import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NodeStub, parseSlots, parseStatusPids } from "../../hc/q6/node-stub.ts";
import { run } from "../../hc/q6/q6.ts";
import {
  CORE_STOP_REASONS,
  LOST_REASONS,
  MAX_SPAWN_WAITS,
  respawnDecision,
  withinLimit,
} from "../../hc/q6/respawn.ts";
import { EXIT_LOST, parseStubArgs, startStub } from "../../hc/q6/stub-sprite.ts";
import type { Hc, HcResult } from "../../lib/hc.ts";
import { readSpikeMeta } from "../../lib/meta.ts";
import type { SpikeContext } from "../../lib/outcome.ts";
import { pbt } from "../config.ts";

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "q6-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

interface Pane {
  addr: string;
  token: string;
  pid: number;
  finished: boolean;
  reason: string | null;
  code: number | null;
  exitAt: number | null;
}

/** A scripted stand-in for one Test_Core: pids, finish reasons and a virtual clock. */
class FakeCore {
  up = true;
  corePid = 100;
  holderPid = 200;
  clock = 0;
  panes: Pane[] = [];
  alive = new Set<number>();
  calls: string[][] = [];
  private n = 0;
  private nextPid = 1000;

  constructor(private readonly opts: { noHolder?: boolean; startFails?: boolean } = {}) {}

  latestPid(token: string): number | null {
    return [...this.panes].reverse().find((p) => p.token === token)?.pid ?? null;
  }

  finish(p: Pane, reason: string, code: number | null): void {
    p.finished = true;
    p.reason = reason;
    p.code = code;
    this.alive.delete(p.pid);
  }

  kill(pid: number, signal: "SIGTERM" | "SIGKILL"): void {
    if (pid === this.holderPid && signal === "SIGKILL") {
      for (const p of this.panes) if (!p.finished) this.finish(p, "holder_lost", null);
      return;
    }
    const p = this.panes.find((x) => x.pid === pid && !x.finished);
    if (p !== undefined) this.finish(p, "exited", 75);
  }

  handle(args: readonly string[]): Partial<HcResult> {
    this.calls.push([...args]);
    const [a, b] = args;
    if (a === "server" && b === "start") {
      if (this.opts.startFails === true) return { code: 1 };
      this.up = true;
      return {};
    }
    if (a === "server" && b === "stop") {
      this.up = false;
      for (const p of this.panes) if (!p.finished) this.finish(p, "server_stop", null);
      return {};
    }
    if (a === "server" && b === "restart") {
      this.corePid += 1;
      return {};
    }
    if (a === "server" && b === "status") {
      if (!this.up) return { code: 1 };
      const holder = this.opts.noHolder === true ? "" : `, "holder_pid": ${this.holderPid}`;
      return { stdout: `{"pid": ${this.corePid}${holder}}` };
    }
    if (!this.up) return { code: 1 };
    if (a === "run") {
      const labels = args.filter((_, i) => args[i - 1] === "--label");
      const token = labels.find((l) => l.startsWith("wraith.spawn="))?.slice(13) ?? "";
      const i = args.indexOf("--exit-after-ms");
      const p: Pane = {
        addr: `t${++this.n}`,
        token,
        pid: this.nextPid++,
        finished: false,
        reason: null,
        code: null,
        exitAt: i >= 0 ? this.clock + Number(args[i + 1]) : null,
      };
      this.panes.push(p);
      this.alive.add(p.pid);
      return { stdout: JSON.stringify({ address: p.addr }) };
    }
    if (a === "ls") {
      for (const p of this.panes) {
        if (!p.finished && p.exitAt !== null && this.clock >= p.exitAt) this.finish(p, "exited", 0);
      }
      return {
        stdout: JSON.stringify(
          this.panes.map((p) => ({
            address: p.addr,
            status: p.finished ? "finished" : "running",
            reason: p.reason,
            code: p.code,
          })),
        ),
      };
    }
    if (a === "kill") {
      const p = this.panes.find((x) => x.addr === b);
      if (p !== undefined && !p.finished) this.finish(p, "killed", 75);
      return {};
    }
    if (a === "rm") {
      this.panes = this.panes.filter((x) => x.addr !== b);
      return {};
    }
    return { code: 2 };
  }
}

function makeCtx(core: FakeCore): {
  ctx: SpikeContext;
  files: Map<string, string>;
  steps: string[];
} {
  const files = new Map<string, string>();
  const steps: string[] = [];
  const hc: Hc = {
    session: "wsp-q6",
    mode: "normal",
    async run(args) {
      return { code: 0, stdout: "", stderr: "", ms: 1, ...core.handle(args) };
    },
    spawnLong() {
      return { pid: 4242, stop: async () => {} };
    },
  };
  const ctx = {
    q: "q6",
    root: dir,
    scratch: join(dir, "scratch"),
    hc,
    evidence: {
      async addText(name: string, text: string) {
        files.set(name, text);
      },
    },
    humanStep(id: string) {
      steps.push(id);
    },
  } as unknown as SpikeContext;
  return { ctx, files, steps };
}

const depsFor = (core: FakeCore) => ({
  now: () => core.clock,
  sleep: async (ms: number) => {
    core.clock += ms;
  },
  pollMs: 5000,
  limitMs: 10_000,
  pidOf: async (token: string) => core.latestPid(token),
  killPid: (pid: number, signal: "SIGTERM" | "SIGKILL") => core.kill(pid, signal),
  pidAlive: (pid: number) => core.alive.has(pid),
  cmdlineOf: async (pid: number) => (pid === core.holderPid ? `holder ${dir}/state` : ""),
  nodePath: "/usr/bin/node",
  stubPath: "/repo/spike/hc/q6/stub-sprite.ts",
});

describe("respawnDecision", () => {
  it("respawns for every lost reason of 7.6", () => {
    for (const r of LOST_REASONS.filter((x) => x !== "exited")) {
      expect(respawnDecision(r, null)).toBe("respawn");
    }
    for (const r of CORE_STOP_REASONS) expect(respawnDecision(r, null)).toBe("respawn");
  });
  it("respawns exited with any non-zero code, and an unknown reason", () => {
    for (const code of [1, 75, 76, 255, null]) {
      expect(respawnDecision("exited", code)).toBe("respawn");
    }
    expect(respawnDecision("something-new", null)).toBe("respawn");
  });
  it("never respawns killed or exited 0, and waits on spawn_pending", () => {
    expect(respawnDecision("killed", 75)).toBe("none");
    expect(respawnDecision("killed", null)).toBe("none");
    expect(respawnDecision("exited", 0)).toBe("none");
    expect(respawnDecision("spawn_pending", null)).toBe("wait");
  });
  it("property: respawn unless killed, exited 0 or spawn_pending", () => {
    const reasons = fc.oneof(
      fc.constantFrom("killed", "exited", "spawn_pending", ...LOST_REASONS),
      fc.string(),
    );
    pbt(
      fc.property(reasons, fc.option(fc.integer({ min: 0, max: 255 }), { nil: null }), (r, c) => {
        const want =
          r === "killed" || (r === "exited" && c === 0)
            ? "none"
            : r === "spawn_pending"
              ? "wait"
              : "respawn";
        expect(respawnDecision(r, c)).toBe(want);
      }),
    );
  });
  it("the node stub waits on spawn_pending, then treats the slot as lost", async () => {
    const starts: string[] = [];
    const stub = new NodeStub({
      list: async () => [{ addr: "t1", finished: true, reason: "spawn_pending", code: null }],
      start: async (spec) => {
        starts.push(spec.token);
        return "t2";
      },
      remove: async () => {},
      now: () => 0,
    });
    stub.track({ token: "k", labels: {}, argv: [], cwd: "/" }, "t1");
    for (let i = 0; i < MAX_SPAWN_WAITS; i++) await stub.pollOnce();
    expect(stub.events).toEqual([]);
    expect(starts).toEqual([]);
    await stub.pollOnce();
    expect(starts).toEqual(["k"]);
    expect(stub.events[0]).toMatchObject({ reason: "spawn_pending", decision: "respawn" });
  });
  it("withinLimit uses the inclusive 10 s default", () => {
    expect(withinLimit(0, 10_000)).toBe(true);
    expect(withinLimit(0, 10_001)).toBe(false);
    expect(withinLimit(5, 4)).toBe(false);
  });
});

describe("stub sprite", () => {
  it("parses its arguments and exits 75 on SIGHUP and SIGTERM", () => {
    const args = parseStubArgs([
      "--bot",
      "b1",
      "--pid-file",
      join(dir, "p.pid"),
      "--exit-after-ms",
      "500",
      "--exit-code",
      "0",
    ]);
    expect(args).toMatchObject({ bot: "b1", exitAfterMs: 500, exitCode: 0 });
    const handlers = new Map<string, () => void>();
    const exits: number[] = [];
    const timers: (() => void)[] = [];
    startStub(args, {
      exit: (c) => exits.push(c),
      on: (s, fn) => handlers.set(s, fn),
      pid: 777,
      write: () => {},
      setTimer: (fn) => {
        timers.push(fn);
      },
    });
    expect(readFileSync(join(dir, "p.pid"), "utf8").trim()).toBe("777");
    handlers.get("SIGHUP")?.();
    handlers.get("SIGTERM")?.();
    for (const t of timers) t();
    expect(exits).toEqual([EXIT_LOST, EXIT_LOST, 0]);
  });
});

describe("hc output parsers", () => {
  it("reads slots and status pids", () => {
    expect(
      parseSlots('[{"address":"t1","status":"finished","reason":"killed","code":75}]'),
    ).toEqual([{ addr: "t1", finished: true, reason: "killed", code: 75 }]);
    expect(parseSlots("not json")).toBeNull();
    expect(parseStatusPids('{"pid": 10, "holder_pid": 20}')).toEqual({ core: 10, all: [10, 20] });
  });
});

describe("Q6 script (fake core)", () => {
  it("has a valid metadata block", () => {
    const m = readSpikeMeta("q6");
    expect(m.ok && m.meta.depends).toEqual(["q2"]);
    expect(m.ok && m.meta.maxWallSeconds).toBe(2700);
  });

  it("passes when steps a to d behave as expected, within 10 s", async () => {
    const core = new FakeCore();
    const { ctx, files, steps } = makeCtx(core);
    const out = await run(ctx, depsFor(core));
    expect(out.criteria.map((c) => [c.id, c.ok])).toEqual([
      ["a-same-pid-keeps-running", true],
      ["b-holder-lost-respawn", true],
      ["c-stop-start-respawn", true],
      ["d-killed-no-respawn", true],
      ["d-term-exited-75-respawn", true],
      ["d-exit0-no-respawn", true],
    ]);
    expect(out.result).toBe("PASS");
    expect(out.openHumanSteps).toEqual(["HS-S5"]);
    expect(steps).toEqual(["HS-S5"]);
    expect(out.notes.join("\n")).toContain("unobserved");
    expect([...files.keys()].sort()).toEqual(["summary.json", "timeline.txt"]);
    const summary = JSON.parse(files.get("summary.json") ?? "{}") as { events: unknown[] };
    expect(summary.events.length).toBeGreaterThanOrEqual(5);
    // Only Test_Session verbs are used; never machine, exec, file or update.
    const verbs = new Set(core.calls.map((c) => c[0]));
    expect([...verbs].sort()).toEqual(["kill", "ls", "rm", "run", "server"]);
  });

  it("records FAIL when no holder pid is found", async () => {
    const core = new FakeCore({ noHolder: true });
    const { ctx } = makeCtx(core);
    const out = await run(ctx, depsFor(core));
    expect(out.result).toBe("FAIL");
    expect(out.criteria.find((c) => c.id === "b-holder-lost-respawn")?.ok).toBe(false);
  });

  it("fails step b when the respawn comes after the 10 s limit (injected clock)", async () => {
    const core = new FakeCore();
    const { ctx } = makeCtx(core);
    const d = depsFor(core);
    const out = await run(ctx, {
      ...d,
      // The holder kill is noticed 11 s late: the clock moves before the poll sees it.
      killPid: (pid, signal) => {
        core.kill(pid, signal);
        if (signal === "SIGKILL") core.clock += 11_000;
      },
      now: () => core.clock,
    });
    expect(out.criteria.find((c) => c.id === "b-holder-lost-respawn")?.ok).toBe(false);
    expect(out.result).toBe("FAIL");
  });

  it("stays pending when the core cannot start", async () => {
    const core = new FakeCore({ startFails: true });
    const { ctx } = makeCtx(core);
    const out = await run(ctx, depsFor(core));
    expect(out.result).toBe("pending");
    expect(out.reason).toContain("server start");
  });
});
