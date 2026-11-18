import { describe, expect, it } from "vitest";
import {
  checkResults,
  evaluateGate,
  parseResults,
  type ResultsEntry,
  renderEntry,
  upsertEntry,
} from "../lib/spike-results.ts";
import { RESULTS_SAMPLE } from "./support/results-sample.ts";

const entry: ResultsEntry = {
  id: "Q3",
  question: "Does Kiro ACP send permission requests?",
  experiment: "acp-echo run",
  result: "PASS",
  evidence: ["spike/kiro/q3/evidence/20261119T093000Z/index.json"],
  branch: "approval via ACP",
  affects: ["S-approval", "S-sprite-acp"],
  notify: "n/a",
  openHumanSteps: [],
  notes: ["one line"],
};

const opts = { repoRoot: "/r", exists: () => true, gate: false };

describe("spike-results", () => {
  it("checks the fixture clean and parses its three table layouts", () => {
    expect(checkResults(RESULTS_SAMPLE, opts)).toEqual([]);
    const { entries, tables, errors } = parseResults(RESULTS_SAMPLE);
    expect(entries).toEqual([]);
    expect(errors).toEqual([]);
    expect(tables.map((t) => t.id)).toEqual(["Q1", "Q3", "Q3b", "Q8", "Q29", "Q35", "Q43"]);
  });

  it("renders an entry and parses it back", () => {
    expect(parseResults(renderEntry(entry)).entries).toEqual([entry]);
  });

  it("adds the Entries section on first use and fills the row", () => {
    const md = upsertEntry(RESULTS_SAMPLE, entry, "2026-11-19");
    expect(md).toContain("\n## Entries\n");
    expect(md).toContain("| Q3 | B | see §19 | PASS (entry) |");
    expect(parseResults(md).entries).toEqual([entry]);
    expect(checkResults(md, opts)).toEqual([]);
    expect(upsertEntry(md, entry, "2026-11-19")).toBe(md);
  });

  it("moves a pre-check text to the notes", () => {
    const e: ResultsEntry = {
      ...entry,
      id: "Q1",
      result: "pending",
      reason: "not run",
      evidence: [],
      notes: [],
    };
    const md = upsertEntry(RESULTS_SAMPLE, e, "2026-11-19");
    const got = parseResults(md).entries[0];
    expect(got?.notes[0]).toMatch(/^pre-check note, context only: pre-check 2026-11-05/);
  });

  it("reports the defects", () => {
    const rules = (e: ResultsEntry, exists = () => true): string[] =>
      checkResults(upsertEntry(RESULTS_SAMPLE, e, "2026-11-19"), { ...opts, exists }).map(
        (f) => f.rule,
      );
    expect(rules(entry, () => false)).toContain("results/evidence-missing");
    expect(rules({ ...entry, evidence: ["spike/../x.json"] })).toContain("results/evidence-path");
    expect(rules({ ...entry, result: "pending" })).toContain("results/pending-reason");
    expect(rules({ ...entry, result: "PARTIAL" })).toEqual(
      expect.arrayContaining(["results/partial-parts", "results/partial-steps"]),
    );
  });

  it("keeps the gate closed until every gate id has evidence", () => {
    expect(evaluateGate([entry], () => true).open).toBe(false);
    expect(evaluateGate([], () => true).counts.PASS).toBe(0);
  });
});
