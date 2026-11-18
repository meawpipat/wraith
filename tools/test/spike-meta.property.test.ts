import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { formatMetaBlock, parseMetaBlock, type SpikeMeta } from "../lib/spike-meta.ts";
import { pbt } from "./config.ts";

// Feature: s-spikes, Property 13: Metadata block round trip and strictness
// Validates: Requirements 4.2, 4.3, 10.1

const idArb = fc.stringMatching(/^[a-z][a-z0-9]{0,5}$/);
const humanArb = fc.stringMatching(/^HS-S[0-9]{1,2}$/);
const numArb = fc.integer({ min: 0, max: 1_000_000 });
const wordsArb = fc.stringMatching(/^[A-Za-z0-9()., ]{0,30}$/).map((s) => s.trim());

const metaArb: fc.Arbitrary<SpikeMeta> = fc
  .record({
    id: idArb,
    group: fc.constantFrom("A", "B", "I", "J"),
    cost: fc.constantFrom("none", "low", "medium"),
    runBy: fc.constantFrom("loop", "owner"),
    agents: fc.subarray(["kiro", "claude"], { minLength: 0 }),
    maxPrompts: numArb,
    maxWallSeconds: numArb,
    estimateCredits: fc.option(
      fc.tuple(numArb, numArb).map(([a, b]) => ({ lo: Math.min(a, b), hi: Math.max(a, b) })),
      { nil: null },
    ),
    claudePrompts: numArb,
    human: fc.array(humanArb, { maxLength: 3 }),
    depends: fc.array(idArb, { maxLength: 3 }),
    shares: fc.option(idArb, { nil: null }),
    allowAlways: fc.constantFrom("never", "manual"),
    assumption: wordsArb,
  })
  .filter((m) => m.cost === "none" || m.assumption !== "") as fc.Arbitrary<SpikeMeta>;

function withBlock(text: string, edit: (rows: string[]) => string[]): string {
  const rows = text.trimEnd().split("\n").slice(1, -1);
  return `${["// spike-meta", ...edit(rows), "// end-spike-meta"].join("\n")}\n`;
}

describe("Feature: s-spikes, Property 13: Metadata block round trip and strictness", () => {
  it("parse(format(m)) equals m", () => {
    pbt(
      fc.property(metaArb, (m) => {
        expect(parseMetaBlock(formatMetaBlock(m))).toEqual({ ok: true, meta: m });
      }),
    );
  });

  it("refuses a missing required key", () => {
    pbt(
      fc.property(metaArb, fc.nat({ max: 13 }), (m, i) => {
        const text = withBlock(formatMetaBlock(m), (rows) => rows.filter((_, j) => j !== i));
        expect(parseMetaBlock(text).ok).toBe(false);
      }),
    );
  });

  it("refuses an unknown key", () => {
    pbt(
      fc.property(metaArb, fc.stringMatching(/^zz[a-z]{1,6}$/), (m, key) => {
        const text = withBlock(formatMetaBlock(m), (rows) => [...rows, `// ${key}: x`]);
        expect(parseMetaBlock(text).ok).toBe(false);
      }),
    );
  });

  it("refuses a duplicate key", () => {
    pbt(
      fc.property(metaArb, fc.nat({ max: 13 }), (m, i) => {
        const text = withBlock(formatMetaBlock(m), (rows) => [...rows, rows[i] ?? ""]);
        expect(parseMetaBlock(text).ok).toBe(false);
      }),
    );
  });

  it("refuses a non-numeric number", () => {
    pbt(
      fc.property(
        metaArb,
        fc.constantFrom("max-prompts", "max-wall-seconds", "claude-prompts"),
        fc.stringMatching(/^[a-z]{1,5}$/),
        (m, key, junk) => {
          const text = withBlock(formatMetaBlock(m), (rows) =>
            rows.map((r) => (r.startsWith(`// ${key}:`) ? `// ${key}: ${junk}` : r)),
          );
          expect(parseMetaBlock(text).ok).toBe(false);
        },
      ),
    );
  });

  it("does not find a block that starts after line 40", () => {
    pbt(
      fc.property(metaArb, fc.integer({ min: 40, max: 80 }), (m, pad) => {
        const text = `${"// pad\n".repeat(pad)}${formatMetaBlock(m)}`;
        expect(parseMetaBlock(text).ok).toBe(false);
      }),
    );
  });
});
