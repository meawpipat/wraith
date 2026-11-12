import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PBT_MIN_RUNS } from "./config.js";

// Source scan (R24.2, P1-D6): every property test goes through `pbt(...)` from
// test/config.ts, and no test file passes a run count below PBT_MIN_RUNS.

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const HELPER_FILE = "config.ts";
const SELF_FILE = "pbt-helper-use.node.test.ts";

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1");
}

/** Returns a list of violations found in one test source. */
export function scanSource(source: string): string[] {
  const code = stripComments(source);
  const problems: string[] = [];
  if (/\bfc\s*\.\s*assert\s*\(/.test(code)) {
    problems.push("calls fc.assert directly");
  }
  if (/import\s*\{[^}]*\bassert\b[^}]*\}\s*from\s*["']fast-check["']/.test(code)) {
    problems.push("imports assert from fast-check");
  }
  for (const m of code.matchAll(/\bnumRuns\s*:\s*([0-9_]+)/g)) {
    const runs = Number((m[1] ?? "").replace(/_/g, ""));
    if (runs < PBT_MIN_RUNS) {
      problems.push(`run count ${runs} is below PBT_MIN_RUNS (${PBT_MIN_RUNS})`);
    }
  }
  return problems;
}

function testSources(): { name: string; source: string }[] {
  return readdirSync(TEST_DIR, { recursive: true, encoding: "utf8" })
    .map((p) => p.split("\\").join("/"))
    .filter((p) => /\.(ts|tsx|mts)$/.test(p))
    .filter((p) => p !== HELPER_FILE && p !== SELF_FILE)
    .map((name) => ({ name, source: readFileSync(join(TEST_DIR, name), "utf8") }));
}

describe("pbt helper use", () => {
  it("self-check: catches direct fc.assert, named assert import and low run counts", () => {
    const direct = `import * as fc from "fast-check";\nfc.assert(fc.property(fc.nat(), () => true));`;
    const spaced = `fc\n  .assert (fc.property(fc.nat(), () => true));`;
    const named = `import { assert, property } from "fast-check";`;
    const low = `pbt(fc.property(fc.nat(), () => true), { numRuns: ${PBT_MIN_RUNS - 1} });`;
    const ok = `pbt(fc.property(fc.nat(), () => true), { numRuns: ${PBT_MIN_RUNS} });`;
    const commented = `// fc.assert(x)\n/* numRuns: 1 */\npbt(p);`;

    expect(scanSource(direct)).not.toEqual([]);
    expect(scanSource(spaced)).not.toEqual([]);
    expect(scanSource(named)).not.toEqual([]);
    expect(scanSource(low)).not.toEqual([]);
    expect(scanSource(ok)).toEqual([]);
    expect(scanSource(commented)).toEqual([]);
  });

  it("no test file calls fc.assert directly or uses a run count below PBT_MIN_RUNS", () => {
    const offenders = testSources().flatMap(({ name, source }) =>
      scanSource(source).map((problem) => `${name}: ${problem}`),
    );
    expect(offenders).toEqual([]);
  });
});
