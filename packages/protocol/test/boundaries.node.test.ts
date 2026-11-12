import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  checkPackageJson,
  checkSources,
  checkTree,
  type Violation,
} from "../scripts/check-boundaries.ts";

// Runtime-independence check (R22.3, R24.9): the real tree is clean, and sample
// offending sources are caught with the right file and line.

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const check = (text: string): Violation[] => checkSources([{ path: "sample.ts", text }]);

describe("boundaries: real tree", () => {
  it("has no violations in src/** and package.json", () => {
    expect(checkTree(PACKAGE_ROOT)).toEqual([]);
  });
});

describe("boundaries: sources that must be caught", () => {
  const importCases: readonly [string, string][] = [
    ["node: from", 'import { readFileSync } from "node:fs";'],
    ["cloudflare: from", 'import { env } from "cloudflare:workers";'],
    ["bun: from", "import { Database } from 'bun:sqlite';"],
    ["node: bare import", 'import "node:crypto";'],
    ["cloudflare: bare import", "import 'cloudflare:test';"],
    ["bun: dynamic import", 'const m = await import("bun:test");'],
    ["node: dynamic import", "const m = import('node:path');"],
    ["node: export from", 'export * from "node:os";'],
  ];

  for (const [name, line] of importCases) {
    it(`flags ${name} on the right line`, () => {
      const v = check(`const a = 1;\n\n${line}\n`);
      expect(v).toHaveLength(1);
      expect(v[0]?.file).toBe("sample.ts");
      expect(v[0]?.line).toBe(3);
      expect(v[0]?.message).toContain("forbidden import");
    });
  }

  it("flags require(", () => {
    const v = check('const a = 1;\nconst fs = require("fs");\n');
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ file: "sample.ts", line: 2 });
    expect(v[0]?.message).toContain("require(");
  });

  for (const id of ["Buffer", "window", "document", "localStorage"]) {
    it(`flags identifier ${id}`, () => {
      const v = check(`const a = 1;\nconst b = 2;\nconst x = ${id};\n`);
      expect(v).toHaveLength(1);
      expect(v[0]).toMatchObject({ file: "sample.ts", line: 3 });
      expect(v[0]?.message).toContain(id);
    });
  }

  it("flags an identifier used inside a template substitution", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the sample source under test contains a template substitution
    const v = check("const s = `a ${window.name} b`;\n");
    expect(v).toHaveLength(1);
    expect(v[0]?.line).toBe(1);
  });

  it("reports every offence in a multi-violation source", () => {
    const v = check('import "node:fs";\nconst a = Buffer.from("x");\nconst b = document;\n');
    expect(v.map((x) => x.line)).toEqual([1, 2, 3]);
  });

  it("flags a package.json with an extra dependency", () => {
    const v = checkPackageJson({ dependencies: { zod: "3.0.0", lodash: "4.0.0" } });
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ file: "package.json", line: 1 });
    expect(v[0]?.message).toContain("lodash");
  });

  it("flags a malformed dependencies field", () => {
    expect(checkPackageJson({ dependencies: ["zod"] })).toHaveLength(1);
  });
});

describe("boundaries: sources that must not be flagged", () => {
  const clean: readonly [string, string][] = [
    [
      "line comment",
      '// import x from "node:fs"; Buffer window document localStorage require("x")\n',
    ],
    [
      "block comment",
      '/* import "node:fs";\n Buffer window document localStorage require("x") */\nconst a = 1;\n',
    ],
    ["double-quoted string", 'const s = "Buffer window document localStorage";\n'],
    ["string with module text", "const s = 'import x from \"node:fs\"';\n"],
    ["string with require", "const s = \"require('x')\";\n"],
    ["template text", "const s = `Buffer window document localStorage node:fs require(`;\n"],
    ["regex literal", "const r = /Buffer|window|document|localStorage/;\n"],
    ["regex with class and slash", "const r = /[/]document\\//g;\nconst a = 1;\n"],
    ["regex after return", "function f(s: string) { return /window/.test(s); }\n"],
    [
      "declared TextDecoder",
      "declare const TextDecoder: { new (): { decode(b: Uint8Array): string } };\n",
    ],
    ["property access", "const d = a.document;\nconst w = a.window;\nconst b = a.Buffer;\n"],
    ["longer identifier", "const windowSize = 1;\nconst Buffers = 2;\nconst documents = 3;\n"],
    ["allowed import", 'import { z } from "zod";\nimport { a } from "./a.ts";\n'],
  ];

  for (const [name, text] of clean) {
    it(`does not flag ${name}`, () => {
      expect(check(text)).toEqual([]);
    });
  }

  it("accepts package.json with only zod or no dependencies", () => {
    expect(checkPackageJson({ dependencies: { zod: "3.0.0" } })).toEqual([]);
    expect(checkPackageJson({ name: "x" })).toEqual([]);
  });
});
