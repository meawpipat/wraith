import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const reporterPath = resolve(here, "..", "vitest-project-reporter.ts");
const vitestBin = join(
  dirname(createRequire(import.meta.url).resolve("vitest/package.json")),
  "vitest.mjs",
);

const created: string[] = [];
afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function runProject(testSource: string): { status: number | null; report: unknown } {
  const dir = mkdtempSync(join(tmpdir(), "wraith-reporter-"));
  created.push(dir);
  mkdirSync(join(dir, "test"));
  writeFileSync(join(dir, "test", "sample.test.ts"), testSource);
  writeFileSync(
    join(dir, "vitest.config.mjs"),
    'export default { test: { globals: true, projects: [{ test: { name: "node", globals: true, include: ["test/**/*.test.ts"] } }] } };\n',
  );
  const result = spawnSync(
    process.execPath,
    [vitestBin, "run", "--allowOnly", `--reporter=${reporterPath}`, "--reporter=dot"],
    { cwd: dir, encoding: "utf8", timeout: 60_000 },
  );
  const report = JSON.parse(readFileSync(join(dir, ".reports", "suites.json"), "utf8"));
  return { status: result.status, report };
}

describe("vitest-project-reporter", () => {
  test("counts passed, skipped and todo tests per project and file", () => {
    const { status, report } = runProject(
      'test("a", () => {});\ntest.skip("b", () => {});\ntest.todo("c");\n',
    );
    expect(status).toBe(0);
    expect(report).toEqual({
      version: 1,
      reason: "passed",
      runs: [
        {
          project: "node",
          file: "test/sample.test.ts",
          passed: 1,
          failed: 0,
          skipped: 2,
          pending: 0,
        },
      ],
    });
  });

  test("counts a failed test and keeps the failing exit code", () => {
    const { status, report } = runProject('test("a", () => { throw new Error("x"); });\n');
    expect(status).not.toBe(0);
    expect(report).toMatchObject({ reason: "failed", runs: [{ passed: 0, failed: 1 }] });
  });

  test("a focused test leaves the others skipped", () => {
    const { report } = runProject('test("a", () => {});\ntest.only("b", () => {});\n');
    expect(report).toMatchObject({ runs: [{ passed: 1, skipped: 1, failed: 0 }] });
  });
});
