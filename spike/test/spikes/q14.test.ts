import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildObserveText, OPEN_ITEMS, run, stateDirFrom } from "../../hc/q14/q14.ts";
import type { Hc, HcResult } from "../../lib/hc.ts";
import { readSpikeMeta } from "../../lib/meta.ts";
import type { SpikeContext } from "../../lib/outcome.ts";

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "q14-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const HOME = process.env.HOME ?? "/home/x";
const NOISY_STATUS = `{"socket":"${HOME}/.config/herdr/hc.sock","terminals":[{"id":"t1","label":"wraith.node=n1","cwd":"${HOME}/Projects/secret-app"}]}\n`;

function makeCtx(
  reply: (args: readonly string[], n: number) => Partial<HcResult>,
  interactive = true,
): { ctx: SpikeContext; calls: string[][]; files: Map<string, string>; steps: string[] } {
  const calls: string[][] = [];
  const files = new Map<string, string>();
  const steps: string[] = [];
  const hc: Hc = {
    session: "",
    mode: "observe",
    async run(args) {
      calls.push([...args]);
      return { code: 0, stdout: "", stderr: "", ms: 1, ...reply(args, calls.length) };
    },
    spawnLong() {
      throw new Error("not used");
    },
  };
  const ctx = {
    q: "q14",
    hc,
    interactive,
    now: () => new Date("2026-01-01T00:00:00Z"),
    humanStep: (id: string) => {
      steps.push(id);
    },
    evidence: {
      async addText(name: string, text: string) {
        files.set(name, text);
      },
    },
  } as unknown as SpikeContext;
  return { ctx, calls, files, steps };
}

function clock(): { nowMs: () => number; sleep: (ms: number) => Promise<void> } {
  let t = 0;
  return {
    nowMs: () => t,
    sleep: async (ms) => {
      t += ms;
    },
  };
}

describe("q14 metadata", () => {
  it("has a valid owner block", () => {
    const r = readSpikeMeta("q14");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.meta).toMatchObject({
      id: "q14",
      group: "A",
      cost: "none",
      runBy: "owner",
      maxPrompts: 0,
      maxWallSeconds: 1800,
      human: ["HS-S4"],
      depends: [],
    });
  });
});

describe("q14 observer with a fake hc", () => {
  it("sends only `server status` and stops at the first success", async () => {
    const { ctx, calls, files, steps } = makeCtx((_a, n) =>
      n < 3 ? { code: 1 } : { stdout: NOISY_STATUS },
    );
    const lines: string[] = [];
    const out = await run(ctx, { ...clock(), print: (l) => lines.push(l) });
    expect(calls).toEqual([
      ["server", "status"],
      ["server", "status"],
      ["server", "status"],
    ]);
    expect(steps).toEqual(["HS-S4"]);
    expect(lines[0]).toBe("q14 start 2026-01-01T00:00:00.000Z");
    const text = files.get("observe.txt") ?? "";
    expect(text).toBe("t+0 fail\nt+1 fail\nt+2 ok\nmeasured: 2 s\nstate-dir: ~/.config/herdr\n");
    expect(out.result).toBe("PARTIAL");
    expect(out.openHumanSteps).toEqual(["HS-S4"]);
    expect(out.criteria[0]?.ok).toBe(true);
    expect(out.notes.length).toBe(OPEN_ITEMS.length);
  });

  it("keeps terminal lists, labels, cwd and project paths out of the evidence", async () => {
    const { ctx, files } = makeCtx(() => ({ stdout: NOISY_STATUS }));
    await run(ctx, { ...clock(), print: () => {} });
    const text = files.get("observe.txt") ?? "";
    for (const bad of ["terminals", "wraith.node", "cwd", "secret-app", "Projects", HOME]) {
      expect(text).not.toContain(bad);
    }
    expect(
      text.split("\n").every((l) => /^(t\+\d+ (ok|fail)|measured: .*|state-dir: .*|)$/.test(l)),
    ).toBe(true);
  });

  it("gives up after 60 s, records no success and fails the 10 s criterion", async () => {
    const { ctx, calls, files } = makeCtx(() => ({ code: 1 }));
    const out = await run(ctx, { ...clock(), print: () => {} });
    expect(calls.length).toBe(61);
    expect(files.get("observe.txt")).toContain("measured: none");
    expect(out.result).toBe("PARTIAL");
    expect(out.criteria[0]?.ok).toBe(false);
  });

  it("counts a late success (over 10 s) as not within the pass line", async () => {
    const { ctx } = makeCtx((_a, n) => (n < 13 ? { code: 1 } : {}));
    const out = await run(ctx, { ...clock(), print: () => {} });
    expect(out.criteria[0]).toMatchObject({ ok: false, observed: "first success at 12 s" });
  });

  it("treats a thrown hc call as a failed poll", async () => {
    const { ctx, files } = makeCtx((_a, n) => {
      if (n === 1) throw new Error("hc refused");
      return {};
    });
    await run(ctx, { ...clock(), print: () => {} });
    expect(files.get("observe.txt")).toContain("t+0 fail\nt+1 ok");
  });

  it("refuses a non-TTY run without calling hc", async () => {
    const { ctx, calls, files, steps } = makeCtx(() => ({}), false);
    const out = await run(ctx, { ...clock(), print: () => {} });
    expect(out.result).toBe("pending");
    expect(out.reason).toBe("needs interactive terminal");
    expect(calls).toEqual([]);
    expect(files.size).toBe(0);
    expect(steps).toEqual([]);
  });
});

describe("q14 helpers", () => {
  it("reduces a socket path to its folder and reports unknown otherwise", () => {
    expect(stateDirFrom('{"socket":"/run/user/1/herdr/hc.sock"}')).toBe("/run/user/1/herdr");
    expect(stateDirFrom("ok")).toBeNull();
    expect(buildObserveText({ lines: [], firstOkSeconds: null, okStdout: "" }, "/h")).toBe(
      "measured: none\nstate-dir: unknown\n",
    );
  });
});

describe("path-check.sh", () => {
  const script = fileURLToPath(new URL("../../hc/q14/path-check.sh", import.meta.url));

  it("says kiro-cli resolves when it is on PATH, without running it", () => {
    const bin = join(dir, "bin");
    execFileSync("/bin/mkdir", [bin]);
    const marker = join(dir, "ran");
    const fake = join(bin, "kiro-cli");
    writeFileSync(fake, `#!/bin/sh\ntouch ${marker}\n`);
    chmodSync(fake, 0o755);
    const out = execFileSync("/bin/sh", [script], { env: { PATH: bin }, encoding: "utf8" });
    expect(out).toBe(`kiro-cli resolves: ${fake}\n`);
    expect(() => execFileSync("/bin/test", ["-e", marker])).toThrow();
  });

  it("says it does not resolve otherwise", () => {
    let stdout = "";
    try {
      execFileSync("/bin/sh", [script], { env: { PATH: dir }, encoding: "utf8" });
    } catch (e) {
      stdout = String((e as { stdout?: string }).stdout);
    }
    expect(stdout).toContain("does NOT resolve");
  });
});
