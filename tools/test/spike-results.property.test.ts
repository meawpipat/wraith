import * as fc from "fast-check";
import { describe, it } from "vitest";
import { GATE_LIST } from "../lib/spike-ids.ts";
import {
  checkResults,
  evaluateGate,
  parseResults,
  type ResultsEntry,
  type ResultValue,
  renderEntry,
  upsertEntry,
} from "../lib/spike-results.ts";
import { pbt } from "./config.ts";
import { RESULTS_SAMPLE, SAMPLE_IDS } from "./support/results-sample.ts";

// Feature: s-spikes, Property 14: RESULTS entries round trip and the checker rejects bad entries
// Validates: Requirements 6.1, 6.2, 6.5, 6.6, 6.9, 6.10

const TODAY = "2026-11-19";
const word = fc.stringMatching(/^[a-z0-9]{1,8}$/);
const text = fc
  .array(word, { minLength: 1, maxLength: 5 })
  .map((w) => w.join(" "))
  .filter((s) => s !== "none");
const item = word.filter((s) => s !== "none");
const pathArb = fc
  .tuple(
    fc.constantFrom("spike/", "docs/spikes/"),
    fc.array(word, { minLength: 1, maxLength: 3 }),
    fc.constantFrom(".json", ".jsonl", ".md"),
  )
  .map(([root, segs, ext]) => `${root}${segs.join("/")}${ext}`);

const entryArb: fc.Arbitrary<ResultsEntry> = fc
  .record({
    id: fc.constantFrom(...SAMPLE_IDS),
    question: text,
    experiment: text,
    result: fc.constantFrom<ResultValue>("PASS", "FAIL", "PARTIAL", "pending"),
    reason: text,
    withReason: fc.boolean(),
    evidence: fc.uniqueArray(pathArb, { minLength: 1, maxLength: 3 }),
    branch: text,
    affects: fc.uniqueArray(item, { minLength: 1, maxLength: 3 }),
    notify: fc.constantFrom<"yes" | "no" | "n/a">("yes", "no", "n/a"),
    steps: fc.array(text, { minLength: 1, maxLength: 2 }),
    notes: fc.array(text, { maxLength: 2 }),
  })
  .map((r): ResultsEntry => {
    const e: ResultsEntry = {
      id: r.id,
      question: r.question,
      experiment: r.experiment,
      result: r.result,
      evidence: r.result === "pending" ? [] : r.evidence,
      branch: r.branch,
      affects: r.affects,
      notify: r.notify,
      openHumanSteps: r.result === "PARTIAL" ? r.steps : [],
      notes: r.notes,
    };
    if (r.withReason || r.result === "pending" || r.result === "PARTIAL") e.reason = r.reason;
    return e;
  });

const allExist = { repoRoot: "/r", exists: () => true, gate: false };

function outside(md: string, id: string): string[] {
  const lines = md.split("\n");
  const cut = lines.indexOf("## Entries");
  return (cut < 0 ? lines : lines.slice(0, cut)).filter((l) => !l.startsWith(`| ${id} `));
}

const nonPending = entryArb.filter((e) => e.result !== "pending");

describe("Property 14", () => {
  it("round trips an entry through render and parse", () => {
    pbt(
      fc.property(entryArb, (e) => {
        const got = parseResults(renderEntry(e));
        return got.errors.length === 0 && JSON.stringify(got.entries) === JSON.stringify([e]);
      }),
    );
  });

  it("upserts idempotently and only touches Entries and the id's row", () => {
    pbt(
      fc.property(entryArb, entryArb, (a, b) => {
        const once = upsertEntry(RESULTS_SAMPLE, a, TODAY);
        if (upsertEntry(once, a, TODAY) !== once) return false;
        if (outside(once, a.id).join("\n") !== outside(RESULTS_SAMPLE, a.id).join("\n"))
          return false;
        const both = upsertEntry(once, b, TODAY);
        if (upsertEntry(both, b, TODAY) !== both) return false;
        if (outside(both, b.id).join("\n") !== outside(once, b.id).join("\n")) return false;
        const ids = parseResults(both).entries.map((x) => x.id);
        return ids.includes(a.id) && ids.includes(b.id);
      }),
    );
  });

  it("reports nothing for a valid document", () => {
    pbt(
      fc.property(
        entryArb,
        (e) => checkResults(upsertEntry(RESULTS_SAMPLE, e, TODAY), allExist).length === 0,
      ),
    );
  });

  it("reports each defect", () => {
    const rules = (e: ResultsEntry, exists: (p: string) => boolean = () => true): string[] =>
      checkResults(upsertEntry(RESULTS_SAMPLE, e, TODAY), { ...allExist, exists }).map(
        (f) => f.rule,
      );
    pbt(fc.property(nonPending, (e) => rules(e, () => false).includes("results/evidence-missing")));
    pbt(
      fc.property(
        nonPending,
        fc.constantFrom("spike/../x.json", "other/x.json", "/spike/x.json", "spike\\x.json"),
        (e, bad) =>
          rules({ ...e, evidence: [...e.evidence, bad] }).includes("results/evidence-path"),
      ),
    );
    pbt(
      fc.property(entryArb, fc.constantFrom<string | undefined>(undefined, ""), (e, reason) => {
        const p: ResultsEntry = { ...e, result: "pending", evidence: [] };
        if (reason === undefined) delete p.reason;
        else p.reason = reason;
        return rules(p).includes("results/pending-reason");
      }),
    );
    pbt(
      fc.property(entryArb, fc.constantFrom<string | undefined>(undefined, ""), (e, reason) => {
        const p: ResultsEntry = {
          ...e,
          result: "PARTIAL",
          evidence: e.evidence.length > 0 ? e.evidence : ["spike/a.json"],
        };
        if (reason === undefined) delete p.reason;
        else p.reason = reason;
        return rules(p).includes("results/partial-parts");
      }),
    );
    pbt(
      fc.property(
        nonPending,
        fc.constantFrom<ResultValue>("PASS", "FAIL", "PARTIAL", "pending"),
        (e, other) => {
          if (other === e.result) return true;
          const md = upsertEntry(RESULTS_SAMPLE, e, TODAY);
          const lines = md.split("\n").map((l) => {
            if (!l.startsWith(`| ${e.id} `)) return l;
            return l.replace(
              `${e.result} (entry)`,
              other === "pending" ? "pending" : `${other} (entry)`,
            );
          });
          return checkResults(lines.join("\n"), allExist).some(
            (f) => f.rule === "results/table-mismatch",
          );
        },
      ),
    );
  });
});

// Feature: s-spikes, Property 20: The P0-D4 gate opens exactly on answers with evidence
// Validates: Requirements 17.1, 17.2, 17.3, 17.4

const GATE_IDS: readonly string[] = [...GATE_LIST, "q14"];

const gateEntryArb = (id: string): fc.Arbitrary<ResultsEntry | null> =>
  fc.option(
    fc
      .record({
        result: fc.constantFrom<ResultValue>("PASS", "FAIL", "PARTIAL", "pending"),
        evidence: fc.uniqueArray(pathArb, { maxLength: 3 }),
      })
      .map(
        ({ result, evidence }): ResultsEntry => ({
          id,
          question: "q",
          experiment: "e",
          result,
          evidence: result === "pending" ? [] : evidence,
          branch: "b",
          affects: ["a"],
          notify: "no",
          openHumanSteps: [],
          notes: [],
        }),
      ),
    { nil: null },
  );

describe("Property 20", () => {
  it("opens exactly when every gate id has an answer with existing evidence", () => {
    pbt(
      fc.property(
        fc.tuple(...GATE_IDS.map(gateEntryArb)),
        fc.integer({ min: 0, max: 0xffff }),
        (slots, seed) => {
          const entries = slots.filter((e): e is ResultsEntry => e !== null);
          const exists = (p: string): boolean => {
            let h = seed;
            for (const c of p) h = (h * 31 + c.charCodeAt(0)) >>> 0;
            return h % 4 !== 0;
          };
          const got = evaluateGate(entries, exists);
          const answered = (id: string): boolean => {
            const e = entries.find((x) => x.id === id);
            return (
              e !== undefined &&
              e.result !== "pending" &&
              e.evidence.length > 0 &&
              e.evidence.every(exists)
            );
          };
          const expectOpen = GATE_LIST.every(answered);
          const counts = { PASS: 0, FAIL: 0, PARTIAL: 0, pending: 0 };
          for (const e of entries) counts[e.result] += 1;
          const pendingGate = GATE_LIST.some(
            (id) => entries.find((x) => x.id === id)?.result === "pending",
          );
          if (pendingGate && got.open) return false;
          return got.open === expectOpen && JSON.stringify(got.counts) === JSON.stringify(counts);
        },
      ),
    );
  });

  it("is not affected by q14", () => {
    pbt(
      fc.property(gateEntryArb("q14"), (q14) => {
        const base: ResultsEntry[] = GATE_LIST.map((id) => ({
          id,
          question: "q",
          experiment: "e",
          result: "PASS",
          evidence: ["spike/x.json"],
          branch: "b",
          affects: ["a"],
          notify: "no",
          openHumanSteps: [],
          notes: [],
        }));
        return evaluateGate(q14 ? [...base, q14] : base, () => true).open;
      }),
    );
  });
});
