import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { formatFinding, ToolError } from "../lib/finding.ts";
import { maskComments } from "../lib/mask.ts";
import { walkFiles } from "../lib/walk.ts";

describe("formatFinding", () => {
  it("omits the column when absent", () => {
    expect(formatFinding({ file: "a/b.ts", line: 3, rule: "x/y" })).toBe("a/b.ts:3 x/y");
  });
  it("includes the column when present", () => {
    expect(formatFinding({ file: "a/b.ts", line: 3, column: 7, rule: "x/y" })).toBe(
      "a/b.ts:3:7 x/y",
    );
  });
});

describe("ToolError", () => {
  it("carries only a path next to a fixed message", () => {
    const e = new ToolError("cannot read file", "a/b.ts");
    expect(e.message).toBe("cannot read file");
    expect(e.path).toBe("a/b.ts");
    expect(Object.keys(e).sort()).toEqual(["name", "path"]);
    expect(new ToolError("bad usage").path).toBeUndefined();
  });
});

describe("maskComments", () => {
  it("keeps offsets, blanks comments, keeps string and template content", () => {
    const src = "const a = 1; // note\n/* block */ const b = 'x // y'; const c = `t /* z */`;\n";
    const out = maskComments(src);
    expect(out.length).toBe(src.length);
    expect(out).not.toContain("note");
    expect(out).not.toContain("block");
    expect(out).toContain("'x // y'");
    expect(out).toContain("`t /* z */`");
    expect(out.indexOf("const b")).toBe(src.indexOf("const b"));
  });
});

describe("walkFiles", () => {
  const root = mkdtempSync(join(tmpdir(), "wraith-walk-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("returns sorted posix paths, skips named dirs, does not follow symlinks", () => {
    mkdirSync(join(root, "src", "sub"), { recursive: true });
    mkdirSync(join(root, "src", "node_modules"), { recursive: true });
    mkdirSync(join(root, "outside"), { recursive: true });
    writeFileSync(join(root, "src", "b.ts"), "");
    writeFileSync(join(root, "src", "a.ts"), "");
    writeFileSync(join(root, "src", "sub", "c.ts"), "");
    writeFileSync(join(root, "src", "node_modules", "skip.ts"), "");
    writeFileSync(join(root, "outside", "secret.ts"), "");
    symlinkSync(join(root, "outside"), join(root, "src", "link"));
    symlinkSync(join(root, "outside", "secret.ts"), join(root, "src", "flink.ts"));
    expect(walkFiles({ root, dirs: ["src"], skipDirNames: new Set(["node_modules"]) })).toEqual([
      "src/a.ts",
      "src/b.ts",
      "src/sub/c.ts",
    ]);
  });
});
