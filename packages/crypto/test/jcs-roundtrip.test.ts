import * as fc from "fast-check";
import { describe, it } from "vitest";
import { canonicalize } from "../src/jcs.js";
import { pbt } from "./config.js";
import { type JsonValue, jsonValueArb } from "./support/json-arbitrary.js";

// Feature: s-crypto, Property 4: JCS parse round trip and idempotence
// **Validates: Requirements 6.1, 6.13, 13.12**

/** Structural equality of JSON values; -0 equals 0, object member order is ignored. */
function jsonEqual(a: JsonValue, b: JsonValue): boolean {
  if (typeof a === "number" && typeof b === "number") return a === b; // -0 === 0
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => jsonEqual(item, b[i] as JsonValue));
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every(
    (k) =>
      Object.hasOwn(b, k) &&
      jsonEqual(
        Object.getOwnPropertyDescriptor(a, k)?.value,
        Object.getOwnPropertyDescriptor(b, k)?.value,
      ),
  );
}

const indentArb: fc.Arbitrary<number | string> = fc.oneof(
  fc.integer({ min: 0, max: 10 }),
  fc.constantFrom("\t", "  ", "\t\t", " \t", "\n"),
);

describe("JCS parse round trip and idempotence", () => {
  it("JSON.parse(canonicalize(v)) deep-equals v", () => {
    pbt(
      fc.property(jsonValueArb(), (v) => {
        return jsonEqual(JSON.parse(canonicalize(v)) as JsonValue, v);
      }),
    );
  });

  it("canonicalize is idempotent through parse", () => {
    pbt(
      fc.property(jsonValueArb(), (v) => {
        const c = canonicalize(v);
        return canonicalize(JSON.parse(c)) === c;
      }),
    );
  });

  it("canonical form is independent of the whitespace of the source JSON text", () => {
    pbt(
      fc.property(jsonValueArb(), indentArb, (v, indent) => {
        const text = JSON.stringify(v, null, indent);
        return canonicalize(JSON.parse(text)) === canonicalize(v);
      }),
    );
  });
});
