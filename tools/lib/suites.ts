import type { Finding } from "./finding.ts";

export interface RequiredSuite {
  package: string;
  file: string;
  projects: readonly string[];
  minTests: number;
}

export interface SuiteRun {
  project: string;
  file: string;
  passed: number;
  failed: number;
  skipped: number;
  pending: number;
}

export interface SuiteReport {
  reason: string;
  runs: readonly SuiteRun[];
}

const CRYPTO = "packages/crypto";
const PROJECTS: readonly string[] = ["node", "workers"];

/** The P0_D2_Suite and the P0_D3_Suites. A hand-edit of the required file cannot go below this (R11.7). */
export const MINIMUM_SUITES: readonly RequiredSuite[] = [
  { package: CRYPTO, file: "test/jcs-vectors.test.ts", projects: PROJECTS, minTests: 1 },
  { package: CRYPTO, file: "test/sign-verify.test.ts", projects: PROJECTS, minTests: 1 },
  { package: CRYPTO, file: "test/mutate-value.test.ts", projects: PROJECTS, minTests: 1 },
  { package: CRYPTO, file: "test/mutate-bytes.test.ts", projects: PROJECTS, minTests: 1 },
  { package: CRYPTO, file: "test/mutate-signature.test.ts", projects: PROJECTS, minTests: 1 },
];

const REQUIRED_FILE = "tools/required-suites.json";
const REPORT_NAME = ".reports/suites.json";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isCount(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function parseRun(v: unknown): SuiteRun | null {
  if (!isRecord(v)) return null;
  const { project, file, passed, failed, skipped, pending } = v;
  if (!isNonEmptyString(project) || !isNonEmptyString(file)) return null;
  if (!isCount(passed) || !isCount(failed) || !isCount(skipped) || !isCount(pending)) return null;
  return { project, file, passed, failed, skipped, pending };
}

/** Hand-written guard for the version 1 Suite_Report. Returns null on any shape error. */
export function parseSuiteReport(json: unknown): SuiteReport | null {
  if (!isRecord(json) || json.version !== 1) return null;
  if (typeof json.reason !== "string" || !Array.isArray(json.runs)) return null;
  const runs: SuiteRun[] = [];
  for (const item of json.runs as unknown[]) {
    const run = parseRun(item);
    if (run === null) return null;
    runs.push(run);
  }
  return { reason: json.reason, runs };
}

/** Hand-written guard for the version 1 Required_Suites_File. Returns null on any shape error. */
export function parseRequired(json: unknown): RequiredSuite[] | null {
  if (!isRecord(json) || json.version !== 1 || !Array.isArray(json.suites)) return null;
  const out: RequiredSuite[] = [];
  for (const item of json.suites as unknown[]) {
    if (!isRecord(item)) return null;
    const { package: pkg, file, projects, minTests } = item;
    if (!isNonEmptyString(pkg) || !isNonEmptyString(file)) return null;
    if (!Array.isArray(projects) || projects.length === 0) return null;
    if (!(projects as unknown[]).every(isNonEmptyString)) return null;
    if (!isCount(minTests)) return null;
    out.push({ package: pkg, file, projects: projects as string[], minTests });
  }
  return out;
}

function checkFloor(required: readonly RequiredSuite[]): Finding[] {
  const findings: Finding[] = [];
  for (const floor of MINIMUM_SUITES) {
    const same = required.filter((r) => r.package === floor.package && r.file === floor.file);
    const missing = floor.projects.some((p) => !same.some((r) => r.projects.includes(p)));
    if (missing) {
      findings.push({ file: REQUIRED_FILE, line: 1, rule: "suites/floor-missing" });
    }
    const lowered = same.some(
      (r) => r.minTests < floor.minTests && r.projects.some((p) => floor.projects.includes(p)),
    );
    if (lowered) {
      findings.push({ file: REQUIRED_FILE, line: 1, rule: "suites/floor-lowered" });
    }
  }
  return findings;
}

function totalTests(report: SuiteReport): number {
  let n = 0;
  for (const r of report.runs) n += r.passed + r.failed + r.skipped + r.pending;
  return n;
}

export function checkSuites(input: {
  required: unknown;
  packagesWithTests: readonly string[];
  reports: ReadonlyMap<string, unknown | null>;
}): Finding[] {
  const findings: Finding[] = [];
  const required = parseRequired(input.required);

  if (required === null) {
    findings.push({ file: REQUIRED_FILE, line: 1, rule: "suites/required-invalid" });
  } else {
    findings.push(...checkFloor(required));
    for (const r of required) {
      if (r.file.endsWith(".node.test.ts") && r.projects.includes("workers")) {
        findings.push({
          file: `${r.package}/${r.file}`,
          line: 1,
          rule: "suites/node-only-listed-for-workers",
        });
      }
    }
  }

  const dirs = new Set<string>(input.packagesWithTests);
  for (const r of required ?? []) dirs.add(r.package);

  for (const dir of [...dirs].sort()) {
    const reportFile = `${dir}/${REPORT_NAME}`;
    const raw = input.reports.get(dir);
    if (raw === undefined || raw === null) {
      findings.push({ file: reportFile, line: 1, rule: "suites/report-missing" });
      continue;
    }
    const report = parseSuiteReport(raw);
    if (report === null) {
      findings.push({ file: reportFile, line: 1, rule: "suites/report-invalid" });
      continue;
    }
    if (report.runs.length === 0 || totalTests(report) === 0) {
      findings.push({ file: reportFile, line: 1, rule: "suites/report-empty" });
      continue;
    }
    for (const r of required ?? []) {
      if (r.package !== dir) continue;
      for (const project of r.projects) {
        const where = `${dir}/${r.file}`;
        const runs = report.runs.filter((x) => x.file === r.file && x.project === project);
        if (runs.length === 0) {
          findings.push({ file: where, line: 1, rule: "suites/run-missing" });
          continue;
        }
        let passed = 0;
        let notPassed = 0;
        for (const x of runs) {
          passed += x.passed;
          notPassed += x.failed + x.skipped + x.pending;
        }
        if (passed < r.minTests) {
          findings.push({ file: where, line: 1, rule: "suites/too-few-tests" });
        }
        if (notPassed > 0) {
          findings.push({ file: where, line: 1, rule: "suites/not-all-passed" });
        }
      }
    }
  }
  return findings;
}
