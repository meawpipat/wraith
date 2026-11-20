import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type BudgetBatch,
  type BudgetDay,
  type BudgetLedger,
  canStart,
  effectiveCeilings,
  enterActual,
  readLedger,
  reserve,
  writeLedger,
} from "../lib/budget.ts";
import { pbt } from "./config.ts";

const DAY = "2026-11-19";

const batch = (i: number): fc.Arbitrary<BudgetBatch> =>
  fc
    .record({
      estimateHi: fc.integer({ min: 0, max: 120 }),
      promptsSent: fc.integer({ min: 0, max: 20 }),
      actualDelta: fc.option(fc.integer({ min: 0, max: 200 }), { nil: null }),
      skipped: fc.boolean(),
    })
    .map((b) => ({
      id: `b${i}`,
      spikes: ["q1"],
      estimateHi: b.estimateHi,
      promptsSent: b.promptsSent,
      actualBefore: null,
      actualAfter: null,
      actualDelta: b.actualDelta,
      skipped: b.skipped,
      enteredAt: null,
    }));

const day: fc.Arbitrary<BudgetDay> = fc
  .record({
    authoring: fc.option(
      fc.record({
        estimateHi: fc.option(fc.integer({ min: 0, max: 150 }), { nil: null }),
        actual: fc.option(fc.integer({ min: 0, max: 150 }), { nil: null }),
      }),
      { nil: null },
    ),
    stopped: fc.option(fc.constant({ reason: "over", at: "2026-11-19T10:00:00.000Z" }), {
      nil: null,
    }),
    claudePrompts: fc.record({
      reserved: fc.integer({ min: 0, max: 50 }),
      sent: fc.integer({ min: 0, max: 50 }),
      actual: fc.option(fc.integer({ min: 0, max: 50 }), { nil: null }),
    }),
    batches: fc
      .integer({ min: 0, max: 4 })
      .chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => batch(i)))),
  })
  .map((d) => d as BudgetDay);

const ledger: fc.Arbitrary<BudgetLedger> = fc
  .record(
    {
      v: fc.constant(1 as const),
      kiroCeiling: fc.integer({ min: 0, max: 600 }),
      claudePromptCeiling: fc.integer({ min: 0, max: 80 }),
      days: day.map((d) => ({ [DAY]: d })),
    },
    { requiredKeys: ["v", "days"] },
  )
  .map((l) => l as BudgetLedger);

const spend = fc.record({
  kiroHi: fc.integer({ min: 0, max: 150 }),
  claudePrompts: fc.integer({ min: 0, max: 50 }),
});

function model(
  l: BudgetLedger,
  s: { kiroHi: number; claudePrompts: number },
  interactive: boolean,
) {
  const d = l.days[DAY] as BudgetDay;
  const kiro = Math.min(l.kiroCeiling ?? 100, 200);
  const claude = l.claudePromptCeiling ?? 40;
  const est = d.batches.reduce((a, b) => a + b.estimateHi, 0);
  const act = d.batches.reduce((a, b) => a + (b.actualDelta ?? 0), 0);
  const run = Math.max(est, act);
  const auth = Math.max(d.authoring?.estimateHi ?? 0, d.authoring?.actual ?? 0);
  const cl = Math.max(d.claudePrompts.reserved, d.claudePrompts.sent, d.claudePrompts.actual ?? 0);
  const last = d.batches[d.batches.length - 1];
  const missingActual =
    !interactive && last !== undefined && last.actualDelta === null && !last.skipped;
  const noAuthoring = !interactive && d.authoring === null;
  return (
    d.stopped === null &&
    !missingActual &&
    !noAuthoring &&
    run + s.kiroHi <= kiro &&
    run + auth + s.kiroHi <= 200 &&
    cl + s.claudePrompts <= claude
  );
}

describe("Feature: s-spikes, Property 15: Budget gates are exact and monotonic", () => {
  it("canStart allows iff gates A, B, C hold, the day is not stopped and no actual is missing", () => {
    pbt(
      fc.property(ledger, spend, fc.boolean(), (l, s, interactive) => {
        const g = canStart(l, DAY, s, { interactive });
        expect(g.ok).toBe(model(l, s, interactive));
      }),
    );
  });

  it("effectiveCeilings never exceeds 200 for Kiro credits", () => {
    pbt(
      fc.property(ledger, (l) => {
        const c = effectiveCeilings(l);
        expect(c.kiroCredits).toBeLessThanOrEqual(200);
        expect(c.hardDayLimit).toBe(200);
      }),
    );
  });

  it("added use never turns a refusal into an allow", () => {
    pbt(
      fc.property(
        ledger,
        spend,
        fc.boolean(),
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 30 }),
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 30 }),
        (l, s, interactive, extraKiro, extraPrompts, moreKiro, morePrompts) => {
          const now = { interactive };
          if (canStart(l, DAY, s, now).ok) return;
          const bigger = {
            kiroHi: s.kiroHi + moreKiro,
            claudePrompts: s.claudePrompts + morePrompts,
          };
          expect(canStart(l, DAY, bigger, now).ok).toBe(false);
          const used = reserve(l, DAY, {
            id: "extra",
            spikes: ["q1"],
            estimateHi: extraKiro,
            claudePrompts: extraPrompts,
          });
          expect(canStart(used, DAY, s, now).ok).toBe(false);
        },
      ),
    );
  });

  it("an actual above 1.5 times the estimate stops the day, and stopped days refuse", () => {
    pbt(
      fc.property(
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 300 }),
        spend,
        fc.boolean(),
        (estimateHi, actual, s, interactive) => {
          const l0 = reserve({ v: 1, days: {} }, DAY, { id: "x", spikes: ["q1"], estimateHi });
          const l1 = enterActual(l0, DAY, "x", actual);
          const stopped = l1.days[DAY]?.stopped != null;
          expect(stopped).toBe(actual > 1.5 * estimateHi);
          if (stopped) {
            const g = canStart(l1, DAY, s, { interactive });
            expect(g.ok).toBe(false);
            if (!g.ok) expect(g.code).toBe("STOPPED");
          }
          const skipped = enterActual(l0, DAY, "x", "skip");
          expect(skipped.days[DAY]?.stopped).toBeNull();
        },
      ),
    );
  });

  it("the ledger serialises and parses to an equal value", () => {
    const dir = mkdtempSync(join(tmpdir(), "budget-prop-"));
    try {
      const path = join(dir, "ledger.json");
      pbt(
        fc.property(ledger, (l) => {
          expect(JSON.parse(JSON.stringify(l))).toEqual(l);
          writeLedger(path, l);
          expect(readLedger(path)).toEqual(l);
        }),
        { numRuns: 500 },
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
