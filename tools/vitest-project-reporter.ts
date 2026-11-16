import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

interface TestCaseLike {
  result(): { state: string };
}
interface TestModuleLike {
  moduleId: string;
  project: { name: string };
  children: { allTests(): Iterable<TestCaseLike> };
}
interface SuiteRunRecord {
  project: string;
  file: string;
  passed: number;
  failed: number;
  skipped: number;
  pending: number;
}
type CountKey = "passed" | "failed" | "skipped" | "pending";

const COUNT_KEYS: readonly string[] = ["passed", "failed", "skipped", "pending"];

/**
 * Writes `<cwd>/.reports/suites.json` (version 1): one entry per project and test file with the
 * count of tests per `result().state`. Never throws and never changes the exit code.
 */
export default class VitestProjectReporter {
  onTestRunEnd(
    testModules: ReadonlyArray<TestModuleLike>,
    _errors: ReadonlyArray<unknown>,
    reason: string,
  ): void {
    try {
      const cwd = process.cwd();
      const runs: SuiteRunRecord[] = [];
      for (const module of testModules) {
        const run: SuiteRunRecord = {
          project: module.project.name,
          file: relative(cwd, module.moduleId).split(sep).join("/"),
          passed: 0,
          failed: 0,
          skipped: 0,
          pending: 0,
        };
        for (const test of module.children.allTests()) {
          const state = test.result().state;
          if (COUNT_KEYS.includes(state)) run[state as CountKey] += 1;
        }
        runs.push(run);
      }
      const dir = join(cwd, ".reports");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "suites.json"), `${JSON.stringify({ version: 1, reason, runs })}\n`);
    } catch {
      // A reporter must not change a test result; a missing report is a Suites_Check finding.
    }
  }
}
