import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const script = resolve(dirname(fileURLToPath(import.meta.url)), "..", "check-suites-ran.ts");
const FILES = [
  "jcs-vectors",
  "sign-verify",
  "mutate-value",
  "mutate-bytes",
  "mutate-signature",
].map((n) => `test/${n}.test.ts`);

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function put(root: string, rel: string, data: unknown): void {
  const full = join(root, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, typeof data === "string" ? data : JSON.stringify(data));
}

function makeTree(opts: { report?: unknown | null; workspace?: string } = {}): string {
  const root = mkdtempSync(join(tmpdir(), "suites-cli-"));
  roots.push(root);
  put(root, "pnpm-workspace.yaml", opts.workspace ?? 'packages:\n  - "packages/*"\n');
  put(root, "packages/crypto/package.json", { name: "c", scripts: { test: "vitest run" } });
  put(root, "packages/lib/package.json", { name: "l" });
  put(root, "tools/required-suites.json", {
    version: 1,
    suites: FILES.map((file) => ({
      package: "packages/crypto",
      file,
      projects: ["node", "workers"],
      minTests: 2,
    })),
  });
  const runs = FILES.flatMap((file) =>
    ["node", "workers"].map((project) => ({
      project,
      file,
      passed: 3,
      failed: 0,
      skipped: 0,
      pending: 0,
    })),
  );
  const report = opts.report === undefined ? { version: 1, reason: "passed", runs } : opts.report;
  if (report !== null) put(root, "packages/crypto/.reports/suites.json", report);
  return root;
}

function run(root: string): { status: number | null; out: string } {
  const r = spawnSync(process.execPath, ["--experimental-strip-types", script, "--root", root], {
    encoding: "utf8",
  });
  return { status: r.status, out: r.stdout + r.stderr };
}

describe("check-suites-ran CLI", () => {
  it("exits 0 and prints one count line per listed run for a conforming tree", () => {
    const r = run(makeTree());
    expect(r.status).toBe(0);
    expect(r.out).toContain("packages/crypto/test/jcs-vectors.test.ts node 3 passed");
    expect(r.out).toContain("packages/crypto/test/mutate-signature.test.ts workers 3 passed");
    expect(r.out.match(/ passed$/gm)).toHaveLength(10);
  });

  it("exits 1 with report-missing when the report file is absent", () => {
    const r = run(makeTree({ report: null }));
    expect(r.status).toBe(1);
    expect(r.out).toContain("packages/crypto/.reports/suites.json:1 suites/report-missing");
  });

  it("exits 1 with report-empty for an empty report", () => {
    const r = run(makeTree({ report: { version: 1, reason: "passed", runs: [] } }));
    expect(r.status).toBe(1);
    expect(r.out).toContain("suites/report-empty");
  });

  it("exits 1 with not-all-passed when a listed test was skipped", () => {
    const runs = FILES.flatMap((file) =>
      ["node", "workers"].map((project) => ({
        project,
        file,
        passed: 3,
        failed: 0,
        skipped: file.includes("jcs") && project === "node" ? 1 : 0,
        pending: 0,
      })),
    );
    const r = run(makeTree({ report: { version: 1, reason: "passed", runs } }));
    expect(r.status).toBe(1);
    expect(r.out).toContain("packages/crypto/test/jcs-vectors.test.ts:1 suites/not-all-passed");
  });

  it("exits 2 for an unsupported workspace glob", () => {
    const r = run(makeTree({ workspace: 'packages:\n  - "packages/**"\n' }));
    expect(r.status).toBe(2);
    expect(r.out).toContain("unsupported workspace pattern");
  });
});
