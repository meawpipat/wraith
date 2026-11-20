import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseMetaBlock } from "../../../tools/lib/spike-meta.ts";
import { cpuSeconds, increasePoints } from "../../hc/q1/metrics.ts";
import {
  chooseProgram,
  DEFAULT_OPTIONS,
  pidsFromStatus,
  type Q1Options,
  q1Verdict,
  runQ1,
} from "../../hc/q1/q1.ts";
import type { Hc, HcResult } from "../../lib/hc.ts";
import type { SpikeContext } from "../../lib/outcome.ts";

const ROOT = "/tmp/hcw/q1";

interface Rig {
  ctx: SpikeContext;
  calls: string[][];
  files: Map<string, string>;
  steps: string[];
  opts: Q1Options;
}

function rig(o: {
  htop: boolean;
  /** Extra core cpu seconds per second of wall time while reading. */
  duringRate: number;
  readBytes: number;
  statusPids?: number[];
}): Rig {
  let clock = 0;
  let reading = false;
  const calls: string[][] = [];
  const files = new Map<string, string>();
  const steps: string[] = [];
  const res = (stdout: string, code = 0): HcResult => ({ code, stdout, stderr: "", ms: 1 });
  const hc: Hc = {
    session: "wsp-q1",
    mode: "normal",
    async run(args) {
      calls.push([...args]);
      if (args[0] === "server") {
        return res(JSON.stringify({ pids: o.statusPids ?? [4242, 99] }));
      }
      if (args[0] === "run") return res("terminal t7 started\n");
      if (args[0] === "read") {
        reading = true;
        return res("x".repeat(o.readBytes));
      }
      return res("");
    },
    spawnLong() {
      throw new Error("not used");
    },
  };
  const opts: Q1Options = {
    baselineMs: 4_000,
    readEveryMs: 250,
    durationMs: 5_000,
    settleMs: 100,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    isOnPath: () => o.htop,
    cpuOf: async (pids) => {
      const m = new Map<number, number>();
      const base = clock / 1000 / 100; // baseline: 1 point of one core
      const extra = reading ? (clock / 1000) * o.duringRate : 0;
      for (const p of pids) m.set(p, base + extra);
      return m;
    },
    // Only pid 4242 runs from the Spike_Root.
    cmdlineOf: async (pid) => (pid === 4242 ? `herdr-core ${ROOT}/s` : "other"),
    schemaExists: () => false,
  };
  const ctx = {
    q: "q1",
    root: ROOT,
    hc,
    humanStep: (id: string) => {
      steps.push(id);
    },
    evidence: {
      addText: async (name: string, text: string) => {
        files.set(name, text);
      },
    },
  } as unknown as SpikeContext;
  return { ctx, calls, files, steps, opts };
}

describe("q1 metrics", () => {
  it("parses ps cputime values", () => {
    expect(cpuSeconds("0:01.50")).toBeCloseTo(1.5);
    expect(cpuSeconds("12:34.56")).toBeCloseTo(754.56);
    expect(cpuSeconds("1:02:03")).toBe(3723);
    expect(cpuSeconds("2-00:00:01")).toBe(172_801);
    expect(Number.isNaN(cpuSeconds("abc"))).toBe(true);
  });

  it("computes points over the baseline and never goes negative", () => {
    const base = { cpuStart: 1, cpuEnd: 2, wallSeconds: 100 };
    const during = { cpuStart: 10, cpuEnd: 16, wallSeconds: 100 };
    expect(increasePoints(base, during)).toBeCloseTo(5);
    expect(increasePoints(during, base)).toBe(0);
    expect(increasePoints(base, { cpuStart: 0, cpuEnd: 1, wallSeconds: 0 })).toBe(0);
  });
});

describe("q1 verdict", () => {
  it("passes below 5 points and below 64 KB", () => {
    expect(q1Verdict(4.99, 65_535).result).toBe("PASS");
  });
  it("fails at the thresholds with the matching branch", () => {
    expect(q1Verdict(5, 100)).toMatchObject({ result: "FAIL", branch: "poll 1 s" });
    expect(q1Verdict(1, 65_536)).toMatchObject({
      result: "FAIL",
      branch: "send only line diffs (Q20)",
    });
    expect(q1Verdict(9, 70_000).branch).toBe("poll 1 s; send only line diffs (Q20)");
  });
  it("chooses top -s 1 and records the substitute without htop", () => {
    expect(chooseProgram(true)).toMatchObject({ argv: ["htop"], substitute: false });
    expect(chooseProgram(false)).toMatchObject({ argv: ["top", "-s", "1"], substitute: true });
  });
  it("reads pids from JSON and from text", () => {
    expect(pidsFromStatus('{"core":{"pid":5},"holders":[{"pid":6}]}').sort()).toEqual([5, 6]);
    expect(pidsFromStatus("core pid 12\nholder pid: 13").sort()).toEqual([12, 13]);
  });
});

describe("q1 run with a fake hc and a short schedule", () => {
  it("passes when CPU and payload stay low, using only own pids", async () => {
    const r = rig({ htop: true, duringRate: 0.01, readBytes: 2000 });
    const out = await runQ1(r.ctx, r.opts);
    expect(out.result).toBe("PASS");
    expect(out.promptsSent).toBe(0);
    expect(out.openHumanSteps).toEqual(["HS-S5"]);
    expect(r.calls.some((c) => c[0] === "run" && c.includes("htop"))).toBe(true);
    expect(r.calls.filter((c) => c[0] === "read").length).toBeGreaterThanOrEqual(19);
    expect(r.calls.at(-1)).toEqual(["kill", "t7"]);
    const summary = JSON.parse(r.files.get("summary.json") ?? "{}");
    expect(summary.ownPids).toBe(1);
    expect(summary.increasePoints).toBeLessThan(5);
    expect(r.files.get("samples.csv")?.startsWith("t_ms,bytes,ms,code\n")).toBe(true);
    expect(out.notes.join("\n")).toContain("one hc process per read");
  });

  it("fails with 'poll 1 s' when CPU rises 5 points or more", async () => {
    const r = rig({ htop: true, duringRate: 0.08, readBytes: 100 });
    const out = await runQ1(r.ctx, r.opts);
    expect(out.result).toBe("FAIL");
    expect(out.branch).toBe("poll 1 s");
  });

  it("fails with line diffs when one payload reaches 64 KB", async () => {
    const r = rig({ htop: true, duringRate: 0, readBytes: 65_536 });
    const out = await runQ1(r.ctx, r.opts);
    expect(out.result).toBe("FAIL");
    expect(out.branch).toBe("send only line diffs (Q20)");
  });

  it("records the top substitute and HS-S1 when htop is absent", async () => {
    const r = rig({ htop: false, duringRate: 0, readBytes: 10 });
    const out = await runQ1(r.ctx, r.opts);
    expect(r.calls.some((c) => c.join(" ") === "run -- top -s 1")).toBe(true);
    expect(out.notes.join("\n")).toContain("substitute");
    expect(out.openHumanSteps).toContain("HS-S1");
    expect(r.steps).toEqual(["HS-S1"]);
  });

  it("ends PARTIAL and starts no pane when no pid passes the own-pid check", async () => {
    const r = rig({ htop: true, duringRate: 0, readBytes: 10, statusPids: [99] });
    const out = await runQ1(r.ctx, r.opts);
    expect(out.result).toBe("PARTIAL");
    expect(r.calls.some((c) => c[0] === "run")).toBe(false);
  });
});

describe("q1 script file", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const text = readFileSync(join(here, "../../hc/q1/q1.ts"), "utf8");
  it("has a valid metadata block", () => {
    const m = parseMetaBlock(text);
    expect(m.ok).toBe(true);
    if (m.ok) {
      expect(m.meta).toMatchObject({
        id: "q1",
        group: "A",
        cost: "none",
        runBy: "loop",
        maxPrompts: 0,
        maxWallSeconds: 2400,
        human: ["HS-S1", "HS-S5"],
        depends: ["q2"],
      });
    }
  });
  it("uses the 250 ms, 5 minute and 60 s schedule by default", () => {
    expect(DEFAULT_OPTIONS).toMatchObject({
      readEveryMs: 250,
      durationMs: 300_000,
      baselineMs: 60_000,
    });
  });
});
