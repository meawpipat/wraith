import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addressWins,
  comparePaneToLogin,
  judgeQ2,
  paneHcNames,
  parseStubOutput,
  parseTerminalAddress,
  run,
  UNOBSERVED_APP_PATH,
  UNOBSERVED_VISIBILITY,
} from "../../hc/q2/q2.ts";
import { createEvidenceWriter } from "../../lib/evidence.ts";
import type { Hc, HcResult } from "../../lib/hc.ts";
import { readSpikeMeta } from "../../lib/meta.ts";
import type { SpikeContext } from "../../lib/outcome.ts";

const REPO = join(import.meta.dirname, "../../..");
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "q2-test-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

interface FakeOptions {
  applyCwd?: boolean;
  applyEnv?: boolean;
  applyLabels?: boolean;
  setTerminalId?: boolean;
  addressWins?: boolean;
  env0?: boolean;
  schema?: string;
}

/** A scripted `Hc` that answers the Q2 commands the way a core would. No process is started. */
function scriptedHc(o: FakeOptions, calls: string[][]): Hc {
  let cwd = "";
  const ok = (stdout: string): HcResult => ({ code: 0, stdout, stderr: "", ms: 1 });
  return {
    session: "wsp-q2",
    mode: "normal",
    spawnLong() {
      throw new Error("not used");
    },
    async run(args) {
      calls.push([...args]);
      const verb = args[0];
      if (verb === "server") return ok("ok\n");
      if (verb === "schema") return ok(o.schema ?? '{"methods":["terminal.run"]}');
      if (verb === "run") {
        if (args.includes("q2=primary")) {
          cwd = args[args.indexOf("--cwd") + 1] ?? "";
          return ok('{"id":"t7"}');
        }
        return ok('{"id":"t8"}');
      }
      if (verb === "read") {
        return ok(
          [
            `PWD=${o.applyCwd === false ? "/elsewhere" : realpathSync(cwd)}`,
            `WRAITH_X=${o.applyEnv === false ? "" : "q2-env-ok"}`,
            `HC_TERMINAL_ID=${o.setTerminalId === false ? "" : "t7"}`,
            `ENV0=${o.env0 === false ? "no" : "yes"}`,
            "PATHENTRY=/usr/bin",
            "PATHENTRY=/bin",
            "NAME=PATH",
            "NAME=HC_SESSION",
            "NAME=HC_TERMINAL_ID",
            "NAME=HOME",
            "Q2-END",
          ].join("\n"),
        );
      }
      if (verb === "ls")
        return ok(o.applyLabels === false ? '[{"id":"t7"},{"id":"t8"}]' : '[{"id":"t7"}]');
      if (verb === "get") {
        return ok(
          o.addressWins === false
            ? '{"id":"t8","labels":["q2=decoy"]}'
            : '{"id":"t7","labels":["q2=primary"]}',
        );
      }
      return { code: 1, stdout: "", stderr: "unknown", ms: 1 };
    },
  };
}

function makeCtx(hc: Hc, humanSteps: string[]): SpikeContext {
  const meta = readSpikeMeta("q2", REPO);
  if (!meta.ok) throw new Error(meta.reason);
  const scratch = join(dir, "scratch");
  mkdirSync(scratch, { recursive: true });
  return {
    q: "q2",
    meta: meta.meta,
    root: dir,
    session: "wsp-q2",
    scratch,
    hc,
    env: () => ({ PATH: "/usr/bin" }),
    evidence: createEvidenceWriter({
      evidenceRoot: join(dir, "evidence"),
      q: "q2",
      home: "/home/tester",
      realHome: "/home/tester",
      env: {},
    }),
    approval: async () => {
      throw new Error("not used");
    },
    shared: null,
    humanStep: (id) => {
      humanSteps.push(id);
    },
    now: () => new Date("2026-11-20T00:00:00Z"),
    interactive: false,
  };
}

async function runQ2(o: FakeOptions) {
  const calls: string[][] = [];
  const steps: string[] = [];
  const repoRoot = join(dir, "repo");
  const ctx = makeCtx(scriptedHc(o, calls), steps);
  const outcome = await run(ctx, {
    sleep: async () => {},
    repoRoot,
    loginEnv: async () => ({
      pathEntries: ["/usr/bin", "/opt/x"],
      names: ["PATH", "HOME", "LANG"],
    }),
  });
  return { outcome, calls, steps, repoRoot, ctx };
}

describe("q2 metadata", () => {
  it("parses with the Register values", () => {
    const r = readSpikeMeta("q2", REPO);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.meta).toMatchObject({
        group: "A",
        cost: "none",
        runBy: "loop",
        agents: [],
        maxPrompts: 0,
        maxWallSeconds: 1800,
        estimateCredits: null,
        human: ["HS-S5"],
        depends: [],
        shares: null,
        allowAlways: "never",
      });
    }
  });
});

describe("q2 pure helpers", () => {
  it("judges PASS, PARTIAL and FAIL", () => {
    const all = {
      schema: true,
      cwd: true,
      env: true,
      labels: true,
      terminalId: true,
      addressWins: true,
      env0: true,
    };
    expect(judgeQ2(all).result).toBe("PASS");
    expect(judgeQ2({ ...all, addressWins: false }).result).toBe("PARTIAL");
    const fail = judgeQ2({ ...all, terminalId: false });
    expect(fail.result).toBe("FAIL");
    expect(fail.branch).toBeTruthy();
  });

  it("the address wins only when the labelled primary comes back", () => {
    expect(addressWins('{"id":"t7","labels":["q2=primary"]}')).toBe(true);
    expect(addressWins('{"id":"t8","labels":["q2=decoy"]}')).toBe(false);
  });

  it("parses stub output and addresses", () => {
    const s = parseStubOutput(
      "PWD=/a\nWRAITH_X=1\nHC_TERMINAL_ID=t3\nENV0=yes\nPATHENTRY=/x\nNAME=HC_A\nQ2-END\n",
    );
    expect(s).toMatchObject({
      pwd: "/a",
      terminalId: "t3",
      env0: true,
      complete: true,
      names: ["HC_A"],
    });
    expect(parseTerminalAddress('{"id":"t12"}')).toBe("t12");
    expect(parseTerminalAddress("nothing")).toBeNull();
    expect(paneHcNames(["HOME", "HC_B", "HERDR_A", "HC_B"])).toEqual(["HC_B", "HERDR_A"]);
  });

  it("compares PATH entries and names only", () => {
    const c = comparePaneToLogin(
      { pathEntries: ["/a", "/b"], names: ["PATH", "HC_X", "ANTHROPIC_K"] },
      { pathEntries: ["/a", "/c"], names: ["PATH", "LANG"] },
    );
    expect(c.samePath).toBe(false);
    expect(c.onlyInPane).toEqual(["/b"]);
    expect(c.onlyInLogin).toEqual(["/c"]);
    expect(c.namesOnlyInPane).toEqual(["ANTHROPIC_K", "HC_X"]);
    expect(c.agentNamesPane).toEqual(["ANTHROPIC_K"]);
  });
});

describe("q2 run with a scripted hc", () => {
  it("passes, writes the five evidence files and the named copy, and records HS-S5 as unobserved", async () => {
    const { outcome, calls, steps, repoRoot, ctx } = await runQ2({});
    expect(outcome.result).toBe("PASS");
    expect(outcome.promptsSent).toBe(0);
    expect(outcome.openHumanSteps).toEqual(["HS-S5"]);
    expect(steps).toEqual(["HS-S5"]);
    expect(outcome.notes).toEqual(
      expect.arrayContaining([UNOBSERVED_VISIBILITY, UNOBSERVED_APP_PATH]),
    );
    expect(UNOBSERVED_VISIBILITY).toContain("unobserved");
    expect(calls[0]).toEqual(["server", "start"]);
    for (const name of [
      "schema.json",
      "run-output.txt",
      "ls.json",
      "get-address.json",
      "env-compare.txt",
    ]) {
      expect(readFileSync(join(ctx.evidence.dir, name), "utf8").length).toBeGreaterThan(0);
    }
    expect(readFileSync(join(repoRoot, "spike/hc/schema.json"), "utf8")).toContain("terminal.run");
    const compare = readFileSync(join(ctx.evidence.dir, "env-compare.txt"), "utf8");
    expect(compare).toContain("hc-exported-names: HC_SESSION, HC_TERMINAL_ID");
  });

  it("FAILs with the branch and no named copy when cwd is not applied", async () => {
    const { outcome, repoRoot } = await runQ2({ applyCwd: false });
    expect(outcome.result).toBe("FAIL");
    expect(outcome.branch).toBeTruthy();
    expect(() => readFileSync(join(repoRoot, "spike/hc/schema.json"), "utf8")).toThrow();
  });

  it("is PARTIAL, and still copies, when the address check is not proven", async () => {
    const { outcome, repoRoot } = await runQ2({ addressWins: false });
    expect(outcome.result).toBe("PARTIAL");
    expect(outcome.reason).toContain("addressWins");
    expect(readFileSync(join(repoRoot, "spike/hc/schema.json"), "utf8").length).toBeGreaterThan(0);
  });

  it("FAILs when the labels filter does not isolate the primary or HC_TERMINAL_ID is unset", async () => {
    expect((await runQ2({ applyLabels: false })).outcome.result).toBe("FAIL");
    expect((await runQ2({ setTerminalId: false })).outcome.result).toBe("FAIL");
    expect((await runQ2({ applyEnv: false })).outcome.result).toBe("FAIL");
  });
});
