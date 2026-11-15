import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkSources } from "../../protocol/scripts/check-boundaries.ts";
import { checkPackageJson, checkTree } from "../scripts/check-boundaries.ts";

// **Validates: Requirements 2.4, 2.7, 1.4**

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const forbidden: ReadonlyArray<readonly [string, string]> = [
  ["node:*", 'import { readFileSync } from "node:fs";\nexport const a = readFileSync;\n'],
  ["cloudflare:*", 'import { env } from "cloudflare:workers";\nexport const a = env;\n'],
  ["bun:*", 'import { Database } from "bun:sqlite";\nexport const a = Database;\n'],
  ["require", 'export const a = require("x");\n'],
  ["Buffer", 'export const a = Buffer.from("x");\n'],
  ["window", "export const a = window.location;\n"],
  ["document", "export const a = document.body;\n"],
  ["localStorage", 'export const a = localStorage.getItem("k");\n'],
];

describe("crypto Boundary_Check wrapper", () => {
  for (const [name, text] of forbidden) {
    it(`reports ${name}`, () => {
      const violations = checkSources([{ path: "src/sample.ts", text }]);
      expect(violations.length).toBeGreaterThan(0);
    });
  }

  it("passes on the real src tree", () => {
    expect(checkTree(packageRoot)).toEqual([]);
  });

  it("reports a dependency other than @wraith/protocol", () => {
    const violations = checkPackageJson({
      dependencies: { "@wraith/protocol": "workspace:*", zod: "3.0.0" },
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("zod");
    expect(checkPackageJson({ dependencies: { "@wraith/protocol": "workspace:*" } })).toEqual([]);
  });
});
