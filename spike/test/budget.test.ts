import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type BudgetLedger,
  canStart,
  effectiveCeilings,
  enterActual,
  enterAuthoring,
  readLedger,
  reserve,
  settle,
  writeLedger,
} from "../lib/budget.ts";

const DAY = "2026-11-19";
const base: BudgetLedger = { v: 1, kiroCeiling: 100, claudePromptCeiling: 40, days: {} };
const loop = { interactive: false };

describe("budget", () => {
  it("caps an owner ceiling of 500 at 200", () => {
    expect(effectiveCeilings({ ...base, kiroCeiling: 500 }).kiroCredits).toBe(200);
    expect(effectiveCeilings({ v: 1, days: {} }).kiroCredits).toBe(100);
  });

  it("refuses a loop run with no authoring record", () => {
    const g = canStart(base, DAY, { kiroHi: 1, claudePrompts: 0 }, loop);
    expect(g).toMatchObject({ ok: false, code: "NO-AUTHORING" });
    expect(canStart(base, DAY, { kiroHi: 1, claudePrompts: 0 }, { interactive: true }).ok).toBe(
      true,
    );
  });

  it("skip clears the actual requirement", () => {
    let l = enterAuthoring(base, DAY, { estimateHi: 10 });
    l = reserve(l, DAY, { id: "b1", spikes: ["q43"], estimateHi: 3 });
    expect(canStart(l, DAY, { kiroHi: 1, claudePrompts: 0 }, loop)).toMatchObject({
      code: "NEEDS-ACTUAL",
    });
    l = enterActual(l, DAY, "b1", "skip");
    expect(canStart(l, DAY, { kiroHi: 1, claudePrompts: 0 }, loop).ok).toBe(true);
  });

  it("gate B refuses when authoring plus run exceeds 200 although gate A passes", () => {
    const l = enterAuthoring({ ...base, kiroCeiling: 200 }, DAY, { estimateHi: 150 });
    const g = canStart(l, DAY, { kiroHi: 60, claudePrompts: 0 }, loop);
    expect(g).toMatchObject({ ok: false, code: "DAY-LIMIT" });
    expect(canStart(l, DAY, { kiroHi: 50, claudePrompts: 0 }, loop).ok).toBe(true);
  });

  it("gate A refuses above the spike ceiling and gate C above the prompt ceiling", () => {
    const l = enterAuthoring(base, DAY, { estimateHi: 1 });
    expect(canStart(l, DAY, { kiroHi: 101, claudePrompts: 0 }, loop)).toMatchObject({
      code: "CEILING",
    });
    expect(canStart(l, DAY, { kiroHi: 0, claudePrompts: 41 }, loop)).toMatchObject({
      code: "CLAUDE",
    });
  });

  it("an actual above 1.5 times the estimate stops the day", () => {
    let l = enterAuthoring(base, DAY, { estimateHi: 1 });
    l = reserve(l, DAY, { id: "b1", spikes: ["q43"], estimateHi: 10 });
    l = settle(l, DAY, "b1", 2);
    l = enterActual(l, DAY, "b1", 16);
    expect(canStart(l, DAY, { kiroHi: 0, claudePrompts: 0 }, loop)).toMatchObject({
      code: "STOPPED",
    });
  });

  it("round-trips the ledger through a file", () => {
    const dir = mkdtempSync(join(tmpdir(), "budget-"));
    try {
      const p = join(dir, "l.json");
      const l = reserve(enterAuthoring(base, DAY, { estimateHi: 5 }), DAY, {
        id: "b1",
        spikes: ["q1"],
        estimateHi: 2,
        claudePrompts: 1,
      });
      writeLedger(p, l);
      expect(readLedger(p)).toEqual(l);
      expect(readFileSync(p, "utf8").endsWith("\n")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
