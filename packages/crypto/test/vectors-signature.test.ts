// Known-answer tests for requestHash and signature verification. Portable: runs in node and workers.
// **Validates: Requirements 9.9, 13.15**
import { describe, expect, it } from "vitest";
import { canonicalizeBytes } from "../src/jcs.js";
import { requestHash, requestHashEquals } from "../src/request-hash.js";
import { sha256 } from "../src/sha256.js";
import { verify } from "../src/sign.js";
import { getRequestHashVectors, getSignatureVectors } from "./support/vectors.js";

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

describe("requestHash known answers", () => {
  for (const vec of getRequestHashVectors()) {
    it(`${vec.id}: canonical bytes, digest and hash`, async () => {
      const { v, meta, body } = vec.envelope;
      const canonical = canonicalizeBytes({ v, meta, body });
      expect(toHex(canonical)).toBe(vec.canonicalHex);
      expect(toHex(await sha256(canonical))).toBe(vec.digestHex);
      const hash = await requestHash(vec.envelope as Parameters<typeof requestHash>[0]);
      expect(hash).toBe(vec.requestHash);
      expect(requestHashEquals(hash, vec.requestHash)).toBe(true);
      const other = `${hash.slice(0, -1)}${hash.endsWith("A") ? "B" : "A"}`;
      expect(requestHashEquals(hash, other)).toBe(false);
    });
  }
});

describe("signature known answers", () => {
  for (const vec of getSignatureVectors()) {
    it(`${vec.id}: verify returns ${vec.expected}`, async () => {
      expect(await verify(vec.envelope, vec.envelope.sig, vec.jwk)).toBe(vec.expected);
    });
  }
});
