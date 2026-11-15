// Completeness of the protocol envelope arbitraries (task 5.8; R13.4, R13.13).
// Portable. Fails when ENVELOPE_ARBITRARIES lacks a key of MESSAGE_TYPES, or has a key that is
// not in MESSAGE_TYPES, so a new protocol type cannot be silently skipped. Coverage is the
// registry types of the day and grows as S-protocol P1 lands; the type list is never
// hard-coded here.
import { describe, expect, it } from "vitest";
import {
  ENVELOPE_ARBITRARIES,
  MESSAGE_TYPES,
  sampleMany,
  validEnvelopeArb,
  validRawEnvelopeArb,
} from "./support/envelopes.js";

const SAMPLES_PER_TYPE = 3;
const SEED = 5;

describe("envelope arbitraries are complete", () => {
  const arbitraryKeys = Object.keys(ENVELOPE_ARBITRARIES);
  const types: readonly string[] = MESSAGE_TYPES;

  it("has a key for every MESSAGE_TYPES entry", () => {
    const missing = types.filter((t) => !arbitraryKeys.includes(t));
    expect(missing).toEqual([]);
  });

  it("has no key outside MESSAGE_TYPES", () => {
    const extra = arbitraryKeys.filter((k) => !types.includes(k));
    expect(extra).toEqual([]);
  });

  it("samples a typed and a raw envelope for every type, covering all of MESSAGE_TYPES", () => {
    let covered = 0;
    for (const type of MESSAGE_TYPES) {
      const typed = sampleMany(validEnvelopeArb(type), SAMPLES_PER_TYPE, SEED);
      const raw = sampleMany(validRawEnvelopeArb(type), SAMPLES_PER_TYPE, SEED);
      expect(typed).toHaveLength(SAMPLES_PER_TYPE);
      expect(raw).toHaveLength(SAMPLES_PER_TYPE);
      for (const e of [...typed, ...raw]) {
        expect(typeof e).toBe("object");
        expect(e).not.toBeNull();
      }
      covered++;
    }
    expect(covered).toBe(MESSAGE_TYPES.length);
  });
});
