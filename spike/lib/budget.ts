import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface BudgetBatch {
  id: string;
  spikes: string[];
  estimateHi: number;
  promptsSent: number;
  actualBefore: number | null;
  actualAfter: number | null;
  actualDelta: number | null;
  skipped: boolean;
  enteredAt: string | null;
}

export interface BudgetDay {
  authoring: { estimateHi: number | null; actual: number | null } | null;
  stopped: { reason: string; at: string } | null;
  claudePrompts: { reserved: number; sent: number; actual: number | null };
  batches: BudgetBatch[];
}

export interface BudgetLedger {
  v: 1;
  kiroCeiling?: number;
  claudePromptCeiling?: number;
  days: Record<string, BudgetDay>;
}

export interface BatchReservation {
  id: string;
  spikes: string[];
  estimateHi: number;
  claudePrompts?: number;
}

export interface Ceilings {
  kiroCredits: number;
  claudePrompts: number;
  hardDayLimit: 200;
}

export type Gate =
  | { ok: true }
  | {
      ok: false;
      code: "CEILING" | "DAY-LIMIT" | "CLAUDE" | "STOPPED" | "NEEDS-ACTUAL" | "NO-AUTHORING";
      message: string;
    };

const HARD_DAY_LIMIT = 200;
const DEFAULT_KIRO_CEILING = 100;
const DEFAULT_CLAUDE_CEILING = 40;
const STOP_FACTOR = 1.5;

export function effectiveCeilings(l: BudgetLedger): Ceilings {
  const kiro = Math.min(l.kiroCeiling ?? DEFAULT_KIRO_CEILING, HARD_DAY_LIMIT);
  return {
    kiroCredits: kiro,
    claudePrompts: l.claudePromptCeiling ?? DEFAULT_CLAUDE_CEILING,
    hardDayLimit: HARD_DAY_LIMIT,
  };
}

function emptyDay(): BudgetDay {
  return {
    authoring: null,
    stopped: null,
    claudePrompts: { reserved: 0, sent: 0, actual: null },
    batches: [],
  };
}

export function dayUse(
  l: BudgetLedger,
  day: string,
): { runKiro: number; authoringKiro: number; claudePrompts: number } {
  const d = l.days[day];
  if (!d) return { runKiro: 0, authoringKiro: 0, claudePrompts: 0 };
  let est = 0;
  let act = 0;
  for (const b of d.batches) {
    est += b.estimateHi;
    act += b.actualDelta ?? 0;
  }
  const a = d.authoring;
  const c = d.claudePrompts;
  return {
    runKiro: Math.max(est, act),
    authoringKiro: Math.max(a?.estimateHi ?? 0, a?.actual ?? 0),
    claudePrompts: Math.max(c.reserved, c.sent, c.actual ?? 0),
  };
}

export function canStart(
  l: BudgetLedger,
  day: string,
  s: { kiroHi: number; claudePrompts: number },
  now: { interactive: boolean },
): Gate {
  const d = l.days[day];
  if (d?.stopped) {
    return { ok: false, code: "STOPPED", message: `day ${day} is stopped: ${d.stopped.reason}` };
  }
  if (!now.interactive) {
    const prev = d?.batches[d.batches.length - 1];
    if (prev && prev.actualDelta === null && !prev.skipped) {
      return {
        ok: false,
        code: "NEEDS-ACTUAL",
        message: `batch ${prev.id} has no actual credit figure; enter one or skip`,
      };
    }
    if (!d?.authoring) {
      return {
        ok: false,
        code: "NO-AUTHORING",
        message: `no authoring record for ${day}; record one with the budget command`,
      };
    }
  }
  const use = dayUse(l, day);
  const c = effectiveCeilings(l);
  if (use.runKiro + s.kiroHi > c.kiroCredits) {
    return {
      ok: false,
      code: "CEILING",
      message: `run credits ${use.runKiro} + ${s.kiroHi} exceed the ceiling ${c.kiroCredits}`,
    };
  }
  if (use.runKiro + use.authoringKiro + s.kiroHi > c.hardDayLimit) {
    return {
      ok: false,
      code: "DAY-LIMIT",
      message: `authoring ${use.authoringKiro} + runs ${use.runKiro} + ${s.kiroHi} exceed ${c.hardDayLimit}`,
    };
  }
  if (use.claudePrompts + s.claudePrompts > c.claudePrompts) {
    return {
      ok: false,
      code: "CLAUDE",
      message: `Claude prompts ${use.claudePrompts} + ${s.claudePrompts} exceed ${c.claudePrompts}`,
    };
  }
  return { ok: true };
}

function withDay(l: BudgetLedger, day: string, f: (d: BudgetDay) => BudgetDay): BudgetLedger {
  const cur = l.days[day] ?? emptyDay();
  return { ...l, days: { ...l.days, [day]: f(cur) } };
}

export function reserve(l: BudgetLedger, day: string, batch: BatchReservation): BudgetLedger {
  return withDay(l, day, (d) => ({
    ...d,
    claudePrompts: {
      ...d.claudePrompts,
      reserved: d.claudePrompts.reserved + (batch.claudePrompts ?? 0),
    },
    batches: [
      ...d.batches,
      {
        id: batch.id,
        spikes: [...batch.spikes],
        estimateHi: batch.estimateHi,
        promptsSent: 0,
        actualBefore: null,
        actualAfter: null,
        actualDelta: null,
        skipped: false,
        enteredAt: null,
      },
    ],
  }));
}

export function settle(
  l: BudgetLedger,
  day: string,
  batchId: string,
  promptsSent: number,
): BudgetLedger {
  return withDay(l, day, (d) => {
    const old = d.batches.find((b) => b.id === batchId);
    if (!old) return d;
    return {
      ...d,
      claudePrompts: {
        ...d.claudePrompts,
        sent: d.claudePrompts.sent - old.promptsSent + promptsSent,
      },
      batches: d.batches.map((b) => (b.id === batchId ? { ...b, promptsSent } : b)),
    };
  });
}

export function enterActual(
  l: BudgetLedger,
  day: string,
  batchId: string,
  actualDelta: number | "skip",
  at: string = new Date().toISOString(),
): BudgetLedger {
  return withDay(l, day, (d) => {
    const old = d.batches.find((b) => b.id === batchId);
    if (!old) return d;
    const next: BudgetBatch =
      actualDelta === "skip"
        ? { ...old, skipped: true, enteredAt: at }
        : { ...old, actualDelta, skipped: false, enteredAt: at };
    const over = actualDelta !== "skip" && actualDelta > STOP_FACTOR * old.estimateHi;
    return {
      ...d,
      stopped:
        over && !d.stopped
          ? { reason: `batch ${batchId} actual ${actualDelta} exceeds 1.5 x estimate`, at }
          : d.stopped,
      batches: d.batches.map((b) => (b.id === batchId ? next : b)),
    };
  });
}

export function enterAuthoring(
  l: BudgetLedger,
  day: string,
  v: { estimateHi?: number; actual?: number },
): BudgetLedger {
  return withDay(l, day, (d) => ({
    ...d,
    authoring: {
      estimateHi: v.estimateHi ?? d.authoring?.estimateHi ?? null,
      actual: v.actual ?? d.authoring?.actual ?? null,
    },
  }));
}

export function readLedger(path: string): BudgetLedger {
  const raw = JSON.parse(readFileSync(path, "utf8")) as BudgetLedger;
  if (raw === null || typeof raw !== "object" || raw.v !== 1 || typeof raw.days !== "object") {
    throw new Error("budget ledger: unsupported format");
  }
  return raw;
}

export function writeLedger(path: string, l: BudgetLedger): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(l, null, 2)}\n`, { mode: 0o644 });
  renameSync(tmp, path);
}
