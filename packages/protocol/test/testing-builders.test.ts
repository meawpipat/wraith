import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseEnvelopeValue } from "../src/envelope.js";
import { MESSAGE_TYPES } from "../src/message-types.js";
import { ENVELOPE_ARBITRARIES, validRawEnvelopeArb } from "../src/testing/arbitraries.js";
import {
  BUILDERS,
  buildBotToolFinal,
  buildBotToolInterim,
  resetBuilderCounter,
} from "../src/testing/builders.js";

const SAMPLES = 20;

describe("testing builders", () => {
  it("has one builder and one arbitrary per message type", () => {
    expect(Object.keys(BUILDERS).sort()).toEqual([...MESSAGE_TYPES].sort());
    expect(Object.keys(ENVELOPE_ARBITRARIES).sort()).toEqual([...MESSAGE_TYPES].sort());
  });

  it("every builder returns an envelope that parses", () => {
    for (const type of MESSAGE_TYPES) {
      const result = parseEnvelopeValue(BUILDERS[type]());
      expect(result.ok, type).toBe(true);
    }
  });

  it("bot.tool variants differ in sig and persist", () => {
    const final = buildBotToolFinal();
    const interim = buildBotToolInterim();
    expect(parseEnvelopeValue(final).ok).toBe(true);
    expect(parseEnvelopeValue(interim).ok).toBe(true);
    expect(final.sig).toBeDefined();
    expect(final.meta.persist).toBe(true);
    expect(interim.sig).toBeUndefined();
    expect(interim.meta.persist).toBe(false);
  });

  it("is deterministic after a counter reset", () => {
    resetBuilderCounter();
    const a = JSON.stringify(BUILDERS.ping());
    resetBuilderCounter();
    expect(JSON.stringify(BUILDERS.ping())).toBe(a);
  });
});

describe("testing arbitraries (samples)", () => {
  for (const type of MESSAGE_TYPES) {
    it(`${type}: sampled envelopes parse, explicit and raw variants`, () => {
      for (const sample of fc.sample(ENVELOPE_ARBITRARIES[type], SAMPLES)) {
        expect(parseEnvelopeValue(sample).ok, type).toBe(true);
      }
      for (const sample of fc.sample(validRawEnvelopeArb(type), SAMPLES)) {
        expect(parseEnvelopeValue(sample).ok, type).toBe(true);
      }
    });
  }
});
