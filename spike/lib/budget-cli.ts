import type { BudgetLedger } from "./budget.js";
import {
  dayUse,
  effectiveCeilings,
  enterActual,
  enterAuthoring,
  readLedger,
  writeLedger,
} from "./budget.js";

export interface BudgetIo {
  ledgerPath: string;
  /** Local calendar date, YYYY-MM-DD. */
  today: string;
  out: (line: string) => void;
  err: (line: string) => void;
}

export const CREDIT_NOTICE =
  "Credits cannot be measured by the loop. Read the Kiro dashboard before and after each batch and enter the actual with: pnpm spike budget actual <batch> <n|skip>.";

const USAGE =
  "usage: budget show | authoring <hi> | authoring-actual <n> | actual <batchId> <n|skip> | ceiling <n>";

function parseCount(s: string | undefined): number | null {
  if (s === undefined || !/^\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

function show(l: BudgetLedger, io: BudgetIo): void {
  const c = effectiveCeilings(l);
  const u = dayUse(l, io.today);
  const d = l.days[io.today];
  io.out(`day ${io.today}`);
  io.out(
    `kiro ceiling ${c.kiroCredits} (day limit ${c.hardDayLimit}); Claude prompts ${c.claudePrompts}`,
  );
  io.out(
    `run use ${u.runKiro} (Estimate); authoring ${u.authoringKiro} (Estimate); Claude prompts ${u.claudePrompts}`,
  );
  io.out(`stopped: ${d?.stopped ? d.stopped.reason : "no"}`);
  for (const b of d?.batches ?? []) {
    const act = b.skipped ? "skipped" : b.actualDelta === null ? "missing" : String(b.actualDelta);
    io.out(`batch ${b.id}: estimate ${b.estimateHi}, actual ${act}`);
  }
  io.out(CREDIT_NOTICE);
}

export function budgetCommand(argv: string[], io: BudgetIo): number {
  const [sub, a1, a2] = argv;
  const fail = (m: string): number => {
    io.err(m);
    return 2;
  };
  let ledger: BudgetLedger;
  try {
    ledger = readLedger(io.ledgerPath);
  } catch (e) {
    return fail(`cannot read the budget ledger: ${(e as Error).message}`);
  }
  switch (sub) {
    case "show":
      show(ledger, io);
      return 0;
    case "authoring": {
      const n = parseCount(a1);
      if (n === null) return fail(USAGE);
      writeLedger(io.ledgerPath, enterAuthoring(ledger, io.today, { estimateHi: n }));
      io.out(`authoring Estimate for ${io.today}: ${n}`);
      return 0;
    }
    case "authoring-actual": {
      const n = parseCount(a1);
      if (n === null) return fail(USAGE);
      writeLedger(io.ledgerPath, enterAuthoring(ledger, io.today, { actual: n }));
      io.out(`authoring actual for ${io.today}: ${n}`);
      return 0;
    }
    case "actual": {
      const n = a2 === "skip" ? "skip" : parseCount(a2);
      if (a1 === undefined || n === null) return fail(USAGE);
      const day = Object.keys(ledger.days).find((k) =>
        ledger.days[k]?.batches.some((b) => b.id === a1),
      );
      if (day === undefined) return fail(`unknown batch ${a1}`);
      writeLedger(io.ledgerPath, enterActual(ledger, day, a1, n));
      io.out(`batch ${a1}: actual ${n}`);
      return 0;
    }
    case "ceiling": {
      const n = parseCount(a1);
      if (n === null) return fail(USAGE);
      const next = { ...ledger, kiroCeiling: n };
      writeLedger(io.ledgerPath, next);
      io.out(`ceiling stored ${n}; effective ${effectiveCeilings(next).kiroCredits}`);
      return 0;
    }
    default:
      return fail(USAGE);
  }
}
