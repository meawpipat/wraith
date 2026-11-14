import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Source scan (R13.3): every property test goes through `pbt(...)` from
// test/config.ts, and no run count is written as a numeric literal. The only
// accepted spelling of a run count is the identifier CRYPTO_PBT_RUNS.
//
// Known blind spot: the scan is textual. An aliased call such as
// `const a = fc.assert; a(...)` or `const { assert: a } = fc` is not detected
// (only the direct call and the named import from "fast-check" are).
// A computed run count (`numRuns: someVariable`) is also not evaluated.

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const HELPER_FILE = "config.ts";
const SELF_FILE = "pbt-helper-use.node.test.ts";

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1");
}

/** Returns the violations found in one test source. */
function scanSource(source: string): string[] {
  const code = stripComments(source);
  const problems: string[] = [];
  if (/\bfc\s*\.\s*assert\s*\(/.test(code)) {
    problems.push("calls fc.assert directly");
  }
  if (/import\s*(?:type\s*)?\{[^}]*\bassert\b[^}]*\}\s*from\s*["']fast-check["']/.test(code)) {
    problems.push("imports assert from fast-check");
  }
  if (/\bnumRuns\s*:\s*[-+]?\s*(?:\d|\.\d)/.test(code)) {
    problems.push("numRuns is a numeric literal (use CRYPTO_PBT_RUNS)");
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
  it("self-check: reports each offending form and passes clean or commented forms", () => {
    const direct = `import * as fc from "fast-check";\nfc.assert(fc.property(fc.nat(), () => true));`;
    const split = `fc\n  .assert\n  (fc.property(fc.nat(), () => true));`;
    const named = `import { assert, property } from "fast-check";`;
    const literal = "pbt(p, { numRuns: 1000 });";
    const literalSmall = "pbt(p, { numRuns:5 });";
    const literalSeparated = "pbt(p, { numRuns: 1_000 });";
    const literalNewline = "pbt(p, {\n  numRuns:\n    2000,\n});";
    const clean = `import { CRYPTO_PBT_RUNS, pbt } from "./config.js";\npbt(p, { numRuns: CRYPTO_PBT_RUNS });\npbt(p);`;
    const commented = `// fc.assert(x)\n/* numRuns: 1 */\n/* fc\n.assert(y) */\npbt(p);`;

    expect(scanSource(direct)).toEqual(["calls fc.assert directly"]);
    expect(scanSource(split)).toEqual(["calls fc.assert directly"]);
    expect(scanSource(named)).toEqual(["imports assert from fast-check"]);
    for (const src of [literal, literalSmall, literalSeparated, literalNewline]) {
      expect(scanSource(src)).toHaveLength(1);
    }
    expect(scanSource(clean)).toEqual([]);
    expect(scanSource(commented)).toEqual([]);
  });

  it("no test file calls fc.assert directly or writes a numRuns literal", () => {
    const offenders = testSources().flatMap(({ name, source }) =>
      scanSource(source).map((problem) => `${name}: ${problem}`),
    );
    expect(offenders).toEqual([]);
  });
});
