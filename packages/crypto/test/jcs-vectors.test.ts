// JCS known-answer tests (RFC 8785) through canonicalizeBytes. Portable: runs in node and workers.
// **Validates: Requirements 6.14, 12.1, 12.2, 12.9**
import { describe, expect, it } from "vitest";
import { canonicalizeBytes } from "../src/jcs.js";
import { getJcsVectors, type JcsVector } from "./support/vectors.js";

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

function doubleFromBits(bits: string): number {
  const view = new DataView(new ArrayBuffer(8));
  view.setBigUint64(0, BigInt(`0x${bits}`), false);
  return view.getFloat64(0, false);
}

function buildInput(v: JcsVector): unknown {
  switch (v.kind) {
    case "number":
      return doubleFromBits(v.bits);
    case "json":
      return JSON.parse(v.inputJson);
    case "depth": {
      let value: unknown[] = [];
      for (let i = 1; i < v.depth; i++) value = [value];
      return value;
    }
  }
}

describe("JCS known-answer vectors", () => {
  for (const v of getJcsVectors()) {
    it(`${v.id}`, () => {
      expect(toHex(canonicalizeBytes(buildInput(v)))).toBe(v.expectedHex);
    });
  }
});
