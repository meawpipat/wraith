import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  checkSuites,
  MINIMUM_SUITES,
  parseSuiteReport,
  type RequiredSuite,
  type SuiteRun,
} from "../lib/suites.ts";
import { pbt } from "./config.ts";

// Property 7: The Suites_Check passes conforming runs and fails each single defect.
// Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9, 11.10, 11.12

const CRYPTO = "packages/crypto";
const PROTOCOL = "packages/protocol";
const PROJECT_SETS: readonly (readonly string[])[] = [["node"], ["workers"], ["node", "workers"]];

interface Model {
  required: RequiredSuite[];
  packagesWithTests: string[];
  reports: Map<string, unknown>;
}

const extraArb = fc.record({
  package: fc.constantFrom(CRYPTO, PROTOCOL),
  projects: fc.constantFrom(...PROJECT_SETS),
  minTests: fc.integer({ min: 1, max: 5 }),
});

const baseArb = fc
  .record({
    extras: fc.array(extraArb, { maxLength: 4 }),
    floorBoost: fc.array(fc.integer({ min: 0, max: 3 }), {
      minLength: MINIMUM_SUITES.length,
      maxLength: MINIMUM_SUITES.length,
    }),
    surplus: fc.integer({ min: 0, max: 3 }),
    listProtocol: fc.boolean(),
  })
  .map(({ extras, floorBoost, surplus, listProtocol }): Model => {
    const required: RequiredSuite[] = MINIMUM_SUITES.map((s, i) => ({
      ...s,
      projects: [...s.projects],
      minTests: s.minTests + (floorBoost[i] ?? 0),
    }));
    extras.forEach((e, i) => {
      required.push({ ...e, projects: [...e.projects], file: `test/extra-${i}.test.ts` });
    });
    const runsByDir = new Map<string, SuiteRun[]>();
    for (const r of required) {
      const runs = runsByDir.get(r.package) ?? [];
      for (const project of r.projects) {
        runs.push({
          project,
          file: r.file,
          passed: r.minTests + surplus,
          failed: 0,
          skipped: 0,
          pending: 0,
        });
      }
      runsByDir.set(r.package, runs);
    }
    const packagesWithTests = [CRYPTO];
    if (listProtocol && !runsByDir.has(PROTOCOL)) {
      packagesWithTests.push(PROTOCOL);
      runsByDir.set(PROTOCOL, [
        { project: "node", file: "test/a.test.ts", passed: 1, failed: 0, skipped: 0, pending: 0 },
      ]);
    }
    const reports = new Map<string, unknown>();
    for (const [dir, runs] of runsByDir) reports.set(dir, { version: 1, reason: "run", runs });
    return {
      required,
      packagesWithTests,
      reports,
    };
  });

function runsOf(model: Model, dir: string): SuiteRun[] {
  const report = model.reports.get(dir) as { runs: SuiteRun[] };
  return report.runs;
}

function setRuns(model: Model, dir: string, runs: SuiteRun[]): void {
  model.reports.set(dir, { version: 1, reason: "run", runs });
}

function run(model: Model, required: unknown = model.required): string[] {
  return checkSuites({
    required: required === model.required ? { version: 1, suites: model.required } : required,
    packagesWithTests: model.packagesWithTests,
    reports: model.reports,
  }).map((f) => f.rule);
}

type Defect = { rule: string; apply: (m: Model, pick: number) => unknown };

const floorIndex = (pick: number) => pick % MINIMUM_SUITES.length;

const DEFECTS: readonly Defect[] = [
  {
    rule: "suites/report-missing",
    apply: (m) => {
      m.reports.delete(CRYPTO);
    },
  },
  {
    rule: "suites/report-empty",
    apply: (m) => setRuns(m, CRYPTO, []),
  },
  {
    rule: "suites/report-empty",
    apply: (m) =>
      setRuns(
        m,
        CRYPTO,
        runsOf(m, CRYPTO).map((r) => ({ ...r, passed: 0 })),
      ),
  },
  {
    rule: "suites/run-missing",
    apply: (m, pick) => {
      const file = MINIMUM_SUITES[floorIndex(pick)]?.file;
      setRuns(
        m,
        CRYPTO,
        runsOf(m, CRYPTO).filter((r) => r.file !== file),
      );
    },
  },
  {
    rule: "suites/run-missing",
    apply: (m, pick) => {
      const file = MINIMUM_SUITES[floorIndex(pick)]?.file;
      setRuns(
        m,
        CRYPTO,
        runsOf(m, CRYPTO).filter((r) => !(r.file === file && r.project === "workers")),
      );
    },
  },
  {
    rule: "suites/too-few-tests",
    apply: (m, pick) => {
      const i = floorIndex(pick);
      const file = MINIMUM_SUITES[i]?.file;
      const min = m.required[i]?.minTests ?? 1;
      setRuns(
        m,
        CRYPTO,
        runsOf(m, CRYPTO).map((r) =>
          r.file === file && r.project === "node" ? { ...r, passed: min - 1 } : r,
        ),
      );
    },
  },
  ...(["failed", "skipped", "pending"] as const).map(
    (kind): Defect => ({
      rule: "suites/not-all-passed",
      apply: (m, pick) => {
        const file = MINIMUM_SUITES[floorIndex(pick)]?.file;
        setRuns(
          m,
          CRYPTO,
          runsOf(m, CRYPTO).map((r) =>
            r.file === file && r.project === "node" ? { ...r, [kind]: 1 } : r,
          ),
        );
      },
    }),
  ),
  {
    rule: "suites/floor-missing",
    apply: (m, pick) => {
      m.required.splice(floorIndex(pick), 1);
    },
  },
  {
    rule: "suites/floor-lowered",
    apply: (m, pick) => {
      const r = m.required[floorIndex(pick)];
      if (r) r.minTests = 0;
    },
  },
  {
    rule: "suites/node-only-listed-for-workers",
    apply: (m) => {
      m.required.push({
        package: CRYPTO,
        file: "test/only.node.test.ts",
        projects: ["node", "workers"],
        minTests: 1,
      });
      const extra = (project: string): SuiteRun => ({
        project,
        file: "test/only.node.test.ts",
        passed: 1,
        failed: 0,
        skipped: 0,
        pending: 0,
      });
      setRuns(m, CRYPTO, [...runsOf(m, CRYPTO), extra("node"), extra("workers")]);
    },
  },
  {
    rule: "suites/report-invalid",
    apply: (m) => {
      m.reports.set(CRYPTO, { version: 2, reason: "run", runs: runsOf(m, CRYPTO) });
    },
  },
  {
    rule: "suites/report-invalid",
    apply: (m) => {
      m.reports.set(CRYPTO, "not a report");
    },
  },
  {
    rule: "suites/required-invalid",
    apply: () => ({ version: 2, suites: [] }),
  },
  {
    rule: "suites/required-invalid",
    apply: () => "garbage",
  },
];

describe("Suites_Check property (Property 7)", () => {
  it("returns no finding for conforming input", () => {
    pbt(
      fc.property(baseArb, (model) => {
        expect(run(model)).toEqual([]);
      }),
    );
  });

  it("returns exactly the defect's rule for each single injected defect", () => {
    pbt(
      fc.property(
        baseArb,
        fc.integer({ min: 0, max: DEFECTS.length - 1 }),
        fc.nat({ max: 100 }),
        (model, which, pick) => {
          const defect = DEFECTS[which] as Defect;
          const replaced = defect.apply(model, pick);
          const rules = replaced === undefined ? run(model) : run(model, replaced);
          expect(rules.length).toBeGreaterThan(0);
          expect(rules).toContain(defect.rule);
          expect(new Set(rules)).toEqual(new Set([defect.rule]));
        },
      ),
    );
  });

  it("round-trips a report model through JSON and parseSuiteReport", () => {
    const runArb = fc.record({
      project: fc.constantFrom("node", "workers"),
      file: fc.stringMatching(/^test\/[a-z]{1,8}\.test\.ts$/),
      passed: fc.nat({ max: 1000 }),
      failed: fc.nat({ max: 1000 }),
      skipped: fc.nat({ max: 1000 }),
      pending: fc.nat({ max: 1000 }),
    });
    pbt(
      fc.property(
        fc.record({
          reason: fc.string({ maxLength: 20 }),
          runs: fc.array(runArb, { maxLength: 8 }),
        }),
        (model) => {
          const parsed = parseSuiteReport(JSON.parse(JSON.stringify({ version: 1, ...model })));
          expect(parsed).toEqual(model);
        },
      ),
    );
  });
});
