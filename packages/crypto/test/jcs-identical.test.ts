// Feature: s-crypto, Property 3: JCS output is identical to the independent reference
// **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.8, 6.11, 6.12, 12.1, 13.12**
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { canonicalize, canonicalizeBytes } from "../src/jcs.js";
import { pbt } from "./config.js";
import {
  jsonStringifyOracle,
  referenceCanonicalize,
  referenceCanonicalizeBytes,
} from "./support/jcs-reference.js";
import { deepFreeze, jsonValueArb, permutedJsonArb } from "./support/json-arbitrary.js";

const OPTIONS = { maxDepth: 3 } as const;
const STRING_LITERAL = /"(?:[^"\\]|\\[\s\S])*"/g;

describe("Property 3: JCS output is identical to the independent reference", () => {
  it("canonicalize equals the reference and the JSON.stringify oracle", () => {
    pbt(
      fc.property(jsonValueArb(OPTIONS), (v) => {
        const out = canonicalize(v);
        expect(out).toBe(referenceCanonicalize(v));
        // JSON.stringify writes 0 for -0, as JCS does, so the oracle needs no exemption.
        expect(out).toBe(jsonStringifyOracle(v));
      }),
    );
  });

  it("output has no whitespace outside strings", () => {
    pbt(
      fc.property(jsonValueArb(OPTIONS), (v) => {
        const outside = canonicalize(v).replace(STRING_LITERAL, '""');
        expect(outside).not.toMatch(/\s/);
      }),
    );
  });

  it("output does not depend on object insertion order", () => {
    pbt(
      fc.property(permutedJsonArb(OPTIONS), ({ original, permuted }) => {
        expect(canonicalize(permuted)).toBe(canonicalize(original));
      }),
    );
  });

  it("a deep-frozen copy gives the same output and the input is not mutated", () => {
    pbt(
      fc.property(jsonValueArb(OPTIONS), (v) => {
        const expected = canonicalize(v);
        const snapshot = structuredClone(v);
        const frozen = deepFreeze(structuredClone(v));
        expect(canonicalize(frozen)).toBe(expected);
        expect(frozen).toStrictEqual(snapshot);
        expect(canonicalize(v)).toBe(expected);
        expect(v).toStrictEqual(snapshot);
      }),
    );
  });

  it("canonicalizeBytes equals the reference bytes", () => {
    pbt(
      fc.property(jsonValueArb(OPTIONS), (v) => {
        expect(Array.from(canonicalizeBytes(v))).toStrictEqual(
          Array.from(referenceCanonicalizeBytes(v)),
        );
      }),
    );
  });
});
