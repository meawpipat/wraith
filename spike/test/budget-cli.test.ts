import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BudgetLedger } from "../lib/budget.js";
import { effectiveCeilings, readLedger, reserve, writeLedger } from "../lib/budget.js";
import { budgetCommand, CREDIT_NOTICE } from "../lib/budget-cli.js";

const DAY = "2026-11-20";
let dir = "";
let path = "";
let out: string[] = [];
let err: string[] = [];

function run(argv: string[]): number {
  return budgetCommand(argv, {
    ledgerPath: path,
    today: DAY,
    out: (l) => out.push(l),
    err: (l) => err.push(l),
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "budget-cli-"));
  path = join(dir, "ledger.json");
  const base: BudgetLedger = { v: 1, kiroCeiling: 100, claudePromptCeiling: 40, days: {} };
  writeLedger(path, reserve(base, DAY, { id: "b1", spikes: ["q3"], estimateHi: 20 }));
  out = [];
  err = [];
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("budgetCommand", () => {
  it("authoring records only the estimate", () => {
    expect(run(["authoring", "60"])).toBe(0);
    const l = readLedger(path);
    expect(l.days[DAY]?.authoring).toEqual({ estimateHi: 60, actual: null });
    expect(l.kiroCeiling).toBe(100);
    expect(l.days[DAY]?.batches[0]?.actualDelta).toBeNull();
  });

  it("authoring-actual records only the actual", () => {
    run(["authoring", "60"]);
    expect(run(["authoring-actual", "55"])).toBe(0);
    expect(readLedger(path).days[DAY]?.authoring).toEqual({ estimateHi: 60, actual: 55 });
  });

  it("actual updates one batch and skip is accepted", () => {
    expect(run(["actual", "b1", "12"])).toBe(0);
    expect(readLedger(path).days[DAY]?.batches[0]?.actualDelta).toBe(12);
    expect(run(["actual", "b1", "skip"])).toBe(0);
    expect(readLedger(path).days[DAY]?.batches[0]?.skipped).toBe(true);
    expect(readLedger(path).days[DAY]?.authoring).toBeNull();
  });

  it("an actual above 1.5 times the estimate stops the day", () => {
    run(["actual", "b1", "31"]);
    expect(readLedger(path).days[DAY]?.stopped).not.toBeNull();
  });

  it("ceiling 300 is stored but the effective ceiling is 200", () => {
    expect(run(["ceiling", "300"])).toBe(0);
    const l = readLedger(path);
    expect(l.kiroCeiling).toBe(300);
    expect(effectiveCeilings(l).kiroCredits).toBe(200);
    expect(l.days[DAY]?.batches).toHaveLength(1);
  });

  it("show prints the credit notice exactly once and does not write", () => {
    expect(run(["show"])).toBe(0);
    expect(out.filter((l) => l === CREDIT_NOTICE)).toHaveLength(1);
    expect(out.join("\n")).toContain("cannot be measured");
  });

  it("rejects bad arguments and unknown batches", () => {
    expect(run(["authoring", "x"])).toBe(2);
    expect(run(["actual", "nope", "3"])).toBe(2);
    expect(run(["bogus"])).toBe(2);
    expect(err.length).toBe(3);
  });

  it("reports an unreadable ledger", () => {
    writeFileSync(path, "{}");
    expect(run(["show"])).toBe(2);
  });
});
