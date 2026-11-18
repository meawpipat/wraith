import { describe, expect, it } from "vitest";
import { formatMetaBlock, parseMetaBlock } from "../lib/spike-meta.ts";

const EXAMPLE = `// spike-meta
// id: q3
// group: B
// cost: low
// run-by: owner
// agents: kiro
// max-prompts: 4
// max-wall-seconds: 1800
// estimate-credits: 2-6
// claude-prompts: 0
// human: HS-S2, HS-S3
// depends: q43
// shares: none
// allow-always: never
// assumption: A1 (1 to 3 credits per small prompt turn), Estimate
// end-spike-meta
`;

const lines = (text: string): string[] => text.trimEnd().split("\n");

function reason(text: string): string {
  const r = parseMetaBlock(text);
  if (r.ok) throw new Error("expected a refusal");
  return r.reason;
}

describe("parseMetaBlock", () => {
  it("parses the example block of the design", () => {
    const r = parseMetaBlock(`#!/usr/bin/env node\n${EXAMPLE}export {};\n`);
    expect(r).toEqual({
      ok: true,
      meta: {
        id: "q3",
        group: "B",
        cost: "low",
        runBy: "owner",
        agents: ["kiro"],
        maxPrompts: 4,
        maxWallSeconds: 1800,
        estimateCredits: { lo: 2, hi: 6 },
        claudePrompts: 0,
        human: ["HS-S2", "HS-S3"],
        depends: ["q43"],
        shares: null,
        allowAlways: "never",
        assumption: "A1 (1 to 3 credits per small prompt turn), Estimate",
      },
    });
  });

  it("parses estimate-credits none and 2-6", () => {
    const none = parseMetaBlock(EXAMPLE.replace("2-6", "none"));
    expect(none.ok && none.meta.estimateCredits).toBeNull();
    const range = parseMetaBlock(EXAMPLE);
    expect(range.ok && range.meta.estimateCredits).toEqual({ lo: 2, hi: 6 });
  });

  it("round-trips through formatMetaBlock", () => {
    const r = parseMetaBlock(EXAMPLE);
    if (!r.ok) throw new Error(r.reason);
    expect(formatMetaBlock(r.meta)).toBe(EXAMPLE);
  });

  it("refuses an unknown key", () => {
    expect(reason(EXAMPLE.replace("// end-spike-meta", "// colour: red\n// end-spike-meta"))).toBe(
      "unknown key: colour",
    );
  });

  it("refuses a duplicate key", () => {
    expect(reason(EXAMPLE.replace("// group: B", "// group: B\n// group: A"))).toBe(
      "duplicate key: group",
    );
  });

  it("refuses a missing required key", () => {
    expect(
      reason(
        lines(EXAMPLE)
          .filter((l) => !l.startsWith("// depends:"))
          .join("\n"),
      ),
    ).toBe("missing required key: depends");
  });

  it("refuses a bad number", () => {
    expect(reason(EXAMPLE.replace("max-prompts: 4", "max-prompts: four"))).toBe(
      "max-prompts: not a number: four",
    );
  });

  it("refuses text that is not a key line", () => {
    expect(reason(EXAMPLE.replace("// end-spike-meta", "stray\n// end-spike-meta"))).toContain(
      "malformed line",
    );
  });

  it("refuses a missing block and an unclosed block", () => {
    expect(reason("export {};\n")).toContain("no metadata block");
    expect(reason(lines(EXAMPLE).slice(0, -1).join("\n"))).toBe("metadata block is not closed");
  });

  it("does not find a block that starts after line 40", () => {
    const pad = `${"// pad\n".repeat(40)}`;
    expect(reason(pad + EXAMPLE)).toContain("no metadata block");
    const ok = parseMetaBlock(`${"// pad\n".repeat(20)}${EXAMPLE}`);
    expect(ok.ok).toBe(true);
  });

  it("requires an assumption when cost is not none", () => {
    expect(reason(EXAMPLE.replace(/\/\/ assumption: .*/, "// assumption:"))).toContain(
      "assumption",
    );
  });
});
