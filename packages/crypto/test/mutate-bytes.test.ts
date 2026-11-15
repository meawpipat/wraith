// Feature: s-crypto, Property 8: Mutating any byte is rejected
// **Validates: Requirements 7.7, 8.10, 13.6**
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { signBytes, verifyBytes } from "../src/sign.js";
import { pbt } from "./config.js";
import { bitFlip } from "./support/envelopes.js";
import { freshKeyPair } from "./support/keys.js";

describe("Property 8: mutating any byte is rejected", () => {
  it("verifies the original and rejects every single-bit and single-byte change", async () => {
    await pbt(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 1, maxLength: 256 }),
        fc.nat(),
        fc.nat(),
        fc.integer({ min: 1, max: 255 }),
        async (bytes, bitIndex, byteIndex, delta) => {
          const pair = await freshKeyPair();
          const sig = await signBytes(pair.privateKey, bytes);
          expect(await verifyBytes(bytes, sig, pair.publicKey)).toBe(true);

          expect(await verifyBytes(bitFlip(bytes, bitIndex), sig, pair.publicKey)).toBe(false);

          const changed = bytes.slice();
          const at = byteIndex % bytes.length;
          changed[at] = ((changed[at] as number) ^ delta) & 0xff;
          expect(await verifyBytes(changed, sig, pair.publicKey)).toBe(false);
        },
      ),
    );
  });
});
