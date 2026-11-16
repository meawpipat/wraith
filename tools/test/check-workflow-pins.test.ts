import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";
import { checkWorkflowsDir, checkWorkflowText } from "../check-workflow-pins.ts";
import { pbt } from "./config.ts";

// Property 6: The Pin_Check accepts exactly full lowercase SHAs.
// Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.6

const HEX = "0123456789abcdef".split("");
const hexArb = (min: number, max: number): fc.Arbitrary<string> =>
  fc
    .array(fc.constantFrom(...HEX), { minLength: min, maxLength: max })
    .map((chars) => chars.join(""));
const repoArb = fc.constantFrom("actions/checkout", "owner/repo", "a-b/c_d.e", "o/r/sub/path");

interface Case {
  readonly value: string;
  readonly problem: string | null;
}

const caseArb: fc.Arbitrary<Case> = fc.oneof(
  fc.tuple(repoArb, hexArb(40, 40)).map(([r, s]) => ({ value: `${r}@${s}`, problem: null })),
  fc
    .tuple(repoArb, fc.constantFrom("v", "v1.", "release-", "main-", "x"), fc.nat(99))
    .map(([r, p, n]) => ({ value: `${r}@${p}${n}`, problem: "mutable-ref" })),
  fc
    .tuple(repoArb, fc.constantFrom("main", "master", `\${{ matrix.ref }}`, "feature/x"))
    .map(([r, b]) => ({ value: `${r}@${b}`, problem: "mutable-ref" })),
  fc.tuple(repoArb, hexArb(7, 39)).map(([r, s]) => ({ value: `${r}@${s}`, problem: "short-sha" })),
  fc.tuple(repoArb, hexArb(41, 64)).map(([r, s]) => ({ value: `${r}@${s}`, problem: "long-sha" })),
  fc
    .tuple(repoArb, hexArb(40, 40))
    .filter(([, s]) => /[a-f]/.test(s))
    .map(([r, s]) => ({ value: `${r}@${s.toUpperCase()}`, problem: "uppercase-sha" })),
  repoArb.map((r) => ({ value: r, problem: "no-ref" })),
  fc
    .tuple(fc.constantFrom("ubuntu", "node:22", "a/b"), hexArb(64, 64))
    .map(([i, d]) => ({ value: `docker://${i}@sha256:${d}`, problem: null })),
  fc
    .constantFrom("docker://ubuntu", "docker://node:22", "docker://a/b@sha256:abc")
    .map((v) => ({ value: v, problem: "docker-no-digest" })),
  fc
    .constantFrom("./", "./local/action", "./.github/actions/x")
    .map((v) => ({ value: v, problem: null })),
);

const styleArb = fc.constantFrom("plain", "dash", "quoted", "comment");

function render(value: string, style: string): string {
  switch (style) {
    case "dash":
      return `      - uses: ${value}`;
    case "quoted":
      return `      uses: "${value}"`;
    case "comment":
      return `      uses: ${value} # note`;
    default:
      return `      uses: ${value}`;
  }
}

describe("Pin_Check property", () => {
  it("passes if and only if the value is a full lowercase SHA, local or digest-pinned", () => {
    pbt(
      fc.property(
        fc.array(fc.tuple(caseArb, styleArb), { minLength: 1, maxLength: 6 }),
        (items) => {
          const lines: string[] = [];
          const expected: { line: number; rule: string }[] = [];
          for (const [c, style] of items) {
            lines.push("name: filler");
            lines.push(render(c.value, style));
            if (c.problem !== null) expected.push({ line: lines.length, rule: `pin/${c.problem}` });
          }
          const found = checkWorkflowText("wf.yml", lines.join("\n")).map((f) => ({
            line: f.line,
            rule: f.rule,
          }));
          expect(found).toEqual(expected);
          for (const f of checkWorkflowText("wf.yml", lines.join("\n"))) {
            expect(f.file).toBe("wf.yml");
          }
        },
      ),
    );
  });

  it("ignores a uses: that appears only after a comment marker", () => {
    pbt(
      fc.property(caseArb, fc.constantFrom("", "  ", "      "), (c, indent) => {
        const text = `${indent}# uses: ${c.value}\nname: x # uses: ${c.value}\n`;
        expect(checkWorkflowText("wf.yml", text)).toEqual([]);
      }),
    );
  });
});

describe("Pin_Check example table (R10.6)", () => {
  const sha40 = "0123456789abcdef0123456789abcdef01234567";
  const table: readonly [string, string, string | null][] = [
    ["a tag", "actions/checkout@v4", "pin/mutable-ref"],
    ["a branch", "actions/checkout@main", "pin/mutable-ref"],
    ["a 7-character SHA", "actions/checkout@0123456", "pin/short-sha"],
    ["a 39-character SHA", `actions/checkout@${sha40.slice(0, 39)}`, "pin/short-sha"],
    ["a 40-hex SHA", `actions/checkout@${sha40}`, null],
    ["a local ./ path", "./", null],
  ];
  it.each(table)("%s", (_name, value, rule) => {
    const found = checkWorkflowText("w.yml", `jobs:\n  uses: ${value}\n`);
    expect(found.map((f) => f.rule)).toEqual(rule === null ? [] : [rule]);
    if (rule !== null) expect(found[0]?.line).toBe(2);
  });
});

describe("checkWorkflowsDir", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("reports findings with the workflow file path and passes a pinned folder", () => {
    const root = mkdtempSync(join(tmpdir(), "pins-"));
    dirs.push(root);
    const wf = join(root, ".github", "workflows");
    mkdirSync(wf, { recursive: true });
    writeFileSync(join(wf, "ok.yml"), `steps:\n  - uses: actions/checkout@${"a".repeat(40)}\n`);
    expect(checkWorkflowsDir(root)).toEqual([]);
    writeFileSync(join(wf, "bad.yaml"), "steps:\n  - uses: actions/checkout@v4\n");
    expect(checkWorkflowsDir(root)).toEqual([
      { file: ".github/workflows/bad.yaml", line: 2, rule: "pin/mutable-ref" },
    ]);
  });
});
