import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("check-platform on the real tree", () => {
  it("exits 0 for the repository root (R5.8)", () => {
    const result = spawnSync(
      process.execPath,
      ["--experimental-strip-types", "tools/check-platform.ts"],
      { cwd: repoRoot, encoding: "utf8" },
    );
    expect(result.stdout + result.stderr).toContain("check-platform");
    expect(result.status).toBe(0);
  });
});
