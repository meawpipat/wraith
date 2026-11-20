import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatMetaBlock, type SpikeMeta } from "../../tools/lib/spike-meta.ts";
import { locate } from "../lib/ids.ts";
import { readSpikeMeta } from "../lib/meta.ts";

const META: SpikeMeta = {
  id: "q1",
  group: "A",
  cost: "none",
  runBy: "loop",
  agents: [],
  maxPrompts: 0,
  maxWallSeconds: 60,
  estimateCredits: null,
  claudePrompts: 0,
  human: [],
  depends: [],
  shares: null,
  allowAlways: "never",
  assumption: "",
};

let root: string;

function writeScript(text: string): void {
  const file = join(root, locate("q1").script);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "spike-meta-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("readSpikeMeta", () => {
  it("returns the meta of a valid block", () => {
    writeScript(`${formatMetaBlock(META)}\nexport {};\n`);
    expect(readSpikeMeta("q1", root)).toEqual({ ok: true, meta: META });
  });

  it("refuses a script without a block", () => {
    writeScript("export {};\n");
    const r = readSpikeMeta("q1", root);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("no metadata block");
  });

  it("refuses a missing file with the reason", () => {
    const r = readSpikeMeta("q1", root);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("script not found");
  });

  it("finds the block only in the first 40 lines", () => {
    const block = formatMetaBlock(META);
    writeScript(`${"// pad\n".repeat(10)}${block}`);
    expect(readSpikeMeta("q1", root).ok).toBe(true);
    writeScript(`${"// pad\n".repeat(40)}${block}`);
    expect(readSpikeMeta("q1", root).ok).toBe(false);
  });
});
