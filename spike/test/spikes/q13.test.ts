import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  detectReplacements,
  firstTemplateName,
  judgeQ13,
  NO_REPLACEMENT_BRANCH,
  readQ2Schema,
  run,
} from "../../hc/q13/q13.ts";
import type { Hc, HcResult } from "../../lib/hc.ts";
import { readSpikeMeta } from "../../lib/meta.ts";
import type { SpikeContext } from "../../lib/outcome.ts";
import { pbt } from "../config.ts";

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "q13-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

type Reply = (args: readonly string[]) => Partial<HcResult>;

function makeCtx(reply: Reply): {
  ctx: SpikeContext;
  calls: string[][];
  files: Map<string, string>;
} {
  const calls: string[][] = [];
  const files = new Map<string, string>();
  const hc: Hc = {
    session: "wsp-t",
    mode: "normal",
    async run(args) {
      calls.push([...args]);
      return { code: 0, stdout: "", stderr: "", ms: 1, ...reply(args) };
    },
    spawnLong() {
      throw new Error("not used");
    },
  };
  const ctx = {
    q: "q13",
    hc,
    evidence: {
      async addText(name: string, text: string) {
        files.set(name, text);
      },
    },
  } as unknown as SpikeContext;
  return { ctx, calls, files };
}

const plainReply: Reply = (args) => {
  if (args[0] === "templates") return { stdout: '["basic"]\n' };
  if (args[0] === "run") return { stdout: "t7\n" };
  return { stdout: "done\n" };
};

describe("q13 metadata", () => {
  it("has a valid block with the registered values", () => {
    const r = readSpikeMeta("q13");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.meta).toMatchObject({
      id: "q13",
      group: "A",
      cost: "none",
      runBy: "loop",
      maxPrompts: 0,
      maxWallSeconds: 900,
      human: [],
      depends: ["q2"],
    });
  });
});

describe("judgeQ13", () => {
  it("replaces nothing gives FAIL with the branch text", () => {
    expect(judgeQ13({ template: false, firstMessage: false, wait: false })).toEqual({
      result: "FAIL",
      branch: NO_REPLACEMENT_BRANCH,
    });
    expect(NO_REPLACEMENT_BRANCH).toBe("use the sprite as designed");
  });

  it("wait replacing queue work gives PASS", () => {
    expect(judgeQ13({ template: false, firstMessage: false, wait: true })).toEqual({
      result: "PASS",
    });
  });

  it("is PASS exactly when some feature replaces work", () => {
    pbt(
      fc.property(fc.boolean(), fc.boolean(), fc.boolean(), (template, firstMessage, wait) => {
        const v = judgeQ13({ template, firstMessage, wait });
        expect(v.result === "PASS").toBe(template || firstMessage || wait);
        expect(v.branch === undefined).toBe(v.result === "PASS");
      }),
    );
  });
});

describe("helpers", () => {
  it("detects a wait that claims queue semantics", () => {
    const r = detectReplacements({
      schemaText: '{"terminal.wait":"waits for the prompt queue to drain"}',
      templatesText: "",
      templateRunText: "",
      waitText: "",
    });
    expect(r).toEqual({ template: false, firstMessage: false, wait: true });
  });

  it("finds the first template name in JSON and in plain text", () => {
    expect(firstTemplateName('[{"name":"dev"},{"name":"x"}]')).toBe("dev");
    expect(firstTemplateName("basic  one pane\n")).toBe("basic");
    expect(firstTemplateName("[]")).toBeNull();
  });

  it("reads the named schema copy, else the newest stamp folder, else null", () => {
    expect(readQ2Schema(dir)).toBeNull();
    const ev = join(dir, "q2", "evidence");
    mkdirSync(join(ev, "20260101T000000Z"), { recursive: true });
    mkdirSync(join(ev, "20260102T000000Z"), { recursive: true });
    writeFileSync(join(ev, "20260101T000000Z", "schema.json"), "old");
    writeFileSync(join(ev, "20260102T000000Z", "schema.json"), "new");
    expect(readQ2Schema(dir)).toBe("new");
    writeFileSync(join(dir, "schema.json"), "named");
    expect(readQ2Schema(dir)).toBe("named");
  });
});

describe("run with a fake hc", () => {
  it("records FAIL with the branch when nothing replaces sprite work", async () => {
    const { ctx, calls, files } = makeCtx(plainReply);
    const out = await run(ctx, dir);
    expect(out.result).toBe("FAIL");
    expect(out.branch).toBe("use the sprite as designed");
    expect(out.promptsSent).toBe(0);
    expect(calls.map((c) => c[0])).toEqual(["templates", "run", "run", "wait"]);
    expect(calls[2]).toEqual(["run", "--bg", "--template", "basic"]);
    expect(calls[3]?.[1]).toBe("t7");
    expect([...files.keys()].sort()).toEqual([
      "stub-run.txt",
      "summary.json",
      "template-run.txt",
      "templates.txt",
      "wait.txt",
    ]);
  });

  it("records PASS when wait output claims queue work", async () => {
    const { ctx } = makeCtx((a) =>
      a[0] === "wait" ? { stdout: "waits until the prompt queue is empty\n" } : plainReply(a),
    );
    const out = await run(ctx, dir);
    expect(out.result).toBe("PASS");
    expect(out.branch).toBeUndefined();
  });

  it("keeps going when a step is refused or fails", async () => {
    const { ctx } = makeCtx((a) => {
      if (a[0] === "templates") throw new Error("hc refused: x");
      return plainReply(a);
    });
    const out = await run(ctx, dir);
    expect(out.result).toBe("FAIL");
    expect(out.criteria.find((c) => c.id === "q13-templates-observed")).toMatchObject({
      ok: false,
      observed: "not run",
    });
  });
});
