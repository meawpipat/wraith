/**
 * Feature: s-protocol, Property 4: Meta rejects unknown fields
 * **Validates: Requirements 2.3, 2.4, 24.4**
 */
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseEnvelopeValue } from "../src/envelope.ts";
import { MESSAGE_TYPES } from "../src/message-types.ts";
import { parseRaw } from "../src/parse.ts";
import { buildEnvelope } from "../src/testing/builders.ts";
import { PBT_MIN_RUNS, pbt } from "./config.ts";

const DECLARED_META = new Set([
  "id",
  "ts",
  "space",
  "room",
  "bot",
  "node",
  "epoch",
  "type",
  "to",
  "persist",
  "prompt",
  "mentions",
  "leaseEpoch",
]);

const keyArb = fc
  .oneof(
    fc.constantFrom("__proto__", "constructor", "prototype", "toString", "hasOwnProperty"),
    fc.string({ minLength: 1, maxLength: 12 }),
  )
  .filter((k) => !DECLARED_META.has(k));

const typeArb = fc.constantFrom(...MESSAGE_TYPES);

/** Add `key` as an OWN property (so `__proto__` is a real key, not a prototype setter). */
function withExtraMeta(
  envelope: Record<string, unknown>,
  key: string,
  value: unknown,
): Record<string, unknown> {
  const meta: Record<string, unknown> = { ...(envelope.meta as Record<string, unknown>) };
  Object.defineProperty(meta, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
  return { ...envelope, meta };
}

describe("Property 4: Meta rejects unknown fields", () => {
  it("rejects any extra meta key with E_SCHEMA_INVALID and accepts the unmodified envelope", () => {
    pbt(
      fc.property(typeArb, keyArb, fc.jsonValue(), (type, key, value) => {
        const valid = JSON.parse(JSON.stringify(buildEnvelope(type))) as Record<string, unknown>;
        expect(parseEnvelopeValue(valid).ok).toBe(true);
        expect(parseRaw(JSON.stringify(valid)).ok).toBe(true);

        const bad = withExtraMeta(valid, key, value);
        const viaValue = parseEnvelopeValue(bad);
        expect(viaValue.ok).toBe(false);
        if (!viaValue.ok) expect(viaValue.code).toBe("E_SCHEMA_INVALID");

        const viaRaw = parseRaw(JSON.stringify(bad));
        expect(viaRaw.ok).toBe(false);
        if (!viaRaw.ok) expect(viaRaw.code).toBe("E_SCHEMA_INVALID");
      }),
      { numRuns: PBT_MIN_RUNS },
    );
  });
});
