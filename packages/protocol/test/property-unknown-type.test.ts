/**
 * Feature: s-protocol, Property 3: Unknown message types are rejected
 * **Validates: Requirements 2.10**
 */
import * as fc from "fast-check";
import { describe, it } from "vitest";
import { parseEnvelopeValue } from "../src/envelope.ts";
import { MESSAGE_TYPES } from "../src/message-types.ts";
import { parseRaw } from "../src/parse.ts";
import { ENVELOPE_ARBITRARIES } from "../src/testing/arbitraries.ts";
import { PBT_MIN_RUNS, pbt } from "./config.ts";

const REAL: ReadonlySet<string> = new Set(MESSAGE_TYPES);

const realTypeArb = fc.constantFrom(...MESSAGE_TYPES);

/** Arbitrary strings plus near-misses of real types (suffix, prefix, case change, empty). */
const unknownTypeArb: fc.Arbitrary<string> = fc
  .oneof(
    fc.string({ maxLength: 40 }),
    fc.string({ unit: "grapheme", maxLength: 20 }),
    fc.tuple(realTypeArb, fc.string({ minLength: 1, maxLength: 5 })).map(([t, s]) => t + s),
    fc.tuple(realTypeArb, fc.string({ minLength: 1, maxLength: 5 })).map(([t, s]) => s + t),
    realTypeArb.map((t) => t.toUpperCase()),
    realTypeArb.map((t) => ` ${t}`),
    realTypeArb.map((t) => `${t} `),
    realTypeArb.map((t) => t.slice(0, -1)),
    realTypeArb.map((t) => t.replace(".", "_")),
    fc.constantFrom("", "constructor", "__proto__", "toString", "hasOwnProperty", "prototype"),
  )
  .filter((s) => !REAL.has(s));

const cases = fc
  .tuple(realTypeArb, unknownTypeArb)
  .chain(([type, bad]) =>
    ENVELOPE_ARBITRARIES[type].map((envelope) => {
      const e = envelope as unknown as { meta: Record<string, unknown> };
      return { bad, value: { ...e, meta: { ...e.meta, type: bad } } };
    }),
  );

function assertNoContent(result: object, bad: string): void {
  const keys = Object.keys(result);
  if (keys.some((k) => k !== "ok" && k !== "code" && k !== "path")) {
    throw new Error(`failure carries extra keys: ${keys.join(",")}`);
  }
  const path = (result as { path?: readonly string[] }).path ?? [];
  if (path.some((p) => typeof p !== "string")) throw new Error("non-string path segment");
  if (bad.length > 8 && JSON.stringify(result).includes(JSON.stringify(bad).slice(1, -1))) {
    throw new Error("failure echoes the offending type");
  }
}

describe("Property 3: Unknown message types are rejected", () => {
  it("parseEnvelopeValue and parseRaw return E_SCHEMA_INVALID without content", () => {
    pbt(
      fc.property(cases, ({ bad, value }) => {
        const viaValue = parseEnvelopeValue(value);
        if (viaValue.ok || viaValue.code !== "E_SCHEMA_INVALID") {
          throw new Error(`parseEnvelopeValue: ${JSON.stringify(viaValue).slice(0, 200)}`);
        }
        assertNoContent(viaValue, bad);
        const viaRaw = parseRaw(JSON.stringify(value));
        if (viaRaw.ok || viaRaw.code !== "E_SCHEMA_INVALID") {
          throw new Error(`parseRaw: ${JSON.stringify(viaRaw).slice(0, 200)}`);
        }
        assertNoContent(viaRaw, bad);
      }),
      { numRuns: PBT_MIN_RUNS },
    );
  });
});
