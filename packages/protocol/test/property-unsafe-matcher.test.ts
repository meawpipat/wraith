/**
 * Feature: s-protocol, Property 18: Unsafe token matcher
 * **Validates: Requirements 21.2, 21.3**
 */
import * as fc from "fast-check";
import { describe, it } from "vitest";
import { findUnsafeToken, UNSAFE_GROUPS, UNSAFE_TOKENS } from "../src/unsafe.ts";
import { PBT_MIN_RUNS, pbt } from "./config.ts";

interface Sample {
  readonly group: (typeof UNSAFE_GROUPS)[number];
  readonly text: string;
}

const SAMPLES: readonly Sample[] = UNSAFE_GROUPS.flatMap((group) =>
  UNSAFE_TOKENS[group].flatMap((entry) => entry.samples.map((text) => ({ group, text }))),
);

const usedChars = new Set(SAMPLES.flatMap((s) => [...s.text]));
const safeChars = [..."0123456789 \n\t#%&,.;!?@^~()/\\|<>{}[]`$"].filter((c) => !usedChars.has(c));
const safeTextArb = fc.string({ unit: fc.constantFrom(...safeChars), maxLength: 40 });

describe("Property 18: Unsafe token matcher", () => {
  it("finds every sample at any position, reporting its group and index", () => {
    pbt(
      fc.property(
        fc.constantFrom(...SAMPLES),
        safeTextArb,
        safeTextArb,
        (sample, before, after) => {
          const match = findUnsafeToken(before + sample.text + after);
          if (match === null) throw new Error(`no match for a ${sample.group} sample`);
          if (match.group !== sample.group || match.index !== before.length) {
            throw new Error(
              `got ${match.group}@${match.index}, want ${sample.group}@${before.length}`,
            );
          }
          if (Object.keys(match).sort().join() !== "group,index") throw new Error("extra keys");
        },
      ),
      { numRuns: PBT_MIN_RUNS },
    );
  });

  it("returns null for text built only from characters in no token", () => {
    pbt(
      fc.property(safeTextArb, (text) => {
        if (findUnsafeToken(text) !== null) throw new Error("unexpected match");
      }),
      { numRuns: PBT_MIN_RUNS },
    );
  });
});
