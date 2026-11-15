import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// **Validates: Requirements 12.9, 12.10, 13.17**

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const testDir = join(packageRoot, "test");

const read = (path: string): string => readFileSync(path, "utf8");

const configText = read(join(packageRoot, "vitest.config.ts"));

// Matches `from "node:x"`, `import "node:x"`, `import("node:x")` and `require("node:x")`.
const nodeImport = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']node:/;

const portableFiles = (): string[] => {
  const files: string[] = [];
  for (const name of readdirSync(testDir)) {
    const full = join(testDir, name);
    if (statSync(full).isFile() && name.endsWith(".ts") && !name.endsWith(".node.test.ts")) {
      files.push(full);
    }
  }
  const supportDir = join(testDir, "support");
  for (const name of readdirSync(supportDir)) {
    if (name.endsWith(".ts")) {
      files.push(join(supportDir, name));
    }
  }
  return files;
};

describe("vitest project config", () => {
  it("defines the node and workers projects", () => {
    expect(configText).toContain('name: "node"');
    expect(configText).toContain('name: "workers"');
    expect(configText).toContain("cloudflareTest(");
  });

  it("excludes *.node.test.ts from the workers project only", () => {
    const workers = configText.slice(configText.indexOf('name: "workers"'));
    const node = configText.slice(
      configText.indexOf('name: "node"'),
      configText.indexOf('name: "workers"'),
    );
    expect(workers).toContain('exclude: ["test/**/*.node.test.ts"]');
    expect(node).not.toContain("exclude:");
  });

  it("sets testTimeout in both projects", () => {
    const workersAt = configText.indexOf('name: "workers"');
    const node = configText.slice(configText.indexOf('name: "node"'), workersAt);
    const workers = configText.slice(workersAt);
    expect(node).toMatch(/testTimeout:\s*[\d_]+/);
    expect(workers).toMatch(/testTimeout:\s*[\d_]+/);
  });
});

describe("package.json scripts", () => {
  it("has test and build scripts", () => {
    const pkg = JSON.parse(read(join(packageRoot, "package.json"))) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.test).toBeTruthy();
    expect(pkg.scripts?.build).toBeTruthy();
  });
});

describe("P0-D2 suite file", () => {
  it("jcs-vectors.test.ts is portable and non-empty", () => {
    const name = "jcs-vectors.test.ts";
    expect(name.endsWith(".node.test.ts")).toBe(false);
    const text = read(join(testDir, name));
    expect(text.trim().length).toBeGreaterThan(0);
    expect(text).toMatch(/\b(?:it|test)\s*(?:\.\w+)?\s*\(/);
  });
});

describe("portable test and support files", () => {
  it("scans a non-empty set of files", () => {
    const files = portableFiles();
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((f) => f.endsWith("jcs-vectors.test.ts"))).toBe(true);
  });

  it("imports nothing from node:*", () => {
    const offenders = portableFiles().filter((file) => nodeImport.test(read(file)));
    expect(offenders).toEqual([]);
  });

  it("the scan pattern detects each import form", () => {
    for (const sample of [
      'import { a } from "node:fs";',
      "import x from 'node:path'",
      'import "node:fs";',
      'const m = await import("node:fs");',
      'const r = require("node:fs");',
    ]) {
      expect(nodeImport.test(sample)).toBe(true);
    }
    expect(nodeImport.test("// Portable: no `node:` import")).toBe(false);
  });
});
