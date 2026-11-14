import { describe, expect, it } from "vitest";
import { decodeBase64Url, encodeBase64Url } from "../src/base64url.js";
import type { FailReason } from "../src/errors.js";
import { sha256, sha256Base64Url } from "../src/sha256.js";
import { bytesToHex, hexToBytes } from "./support/hex.js";
import { getBase64urlVectors, getSha256Vectors } from "./support/vectors.js";

// Known-answer tests (R4.8). Portable: no node: imports, runs in the node and workers projects.

const INVALID_REASON: Record<string, FailReason> = {
  padding: "bad_character",
  plus: "bad_character",
  slash: "bad_character",
  whitespace: "bad_character",
  length: "bad_length",
  trailing_bits: "non_zero_trailing_bits",
};

describe("base64url known answers", () => {
  const { valid, invalid } = getBase64urlVectors();

  it("has vectors to run", () => {
    expect(valid.length).toBeGreaterThan(0);
    expect(invalid.length).toBeGreaterThan(0);
  });

  for (const v of valid) {
    it(`valid ${v.id}: encode and decode`, () => {
      const bytes = hexToBytes(v.bytesHex);
      expect(encodeBase64Url(bytes)).toBe(v.text);
      const decoded = decodeBase64Url(v.text);
      expect(decoded.ok).toBe(true);
      if (decoded.ok) expect(bytesToHex(decoded.value)).toBe(v.bytesHex);
    });
  }

  for (const v of invalid) {
    it(`invalid ${v.id}: rejected as ${v.reason}`, () => {
      const expected = INVALID_REASON[v.reason];
      expect(expected, `unmapped reason ${v.reason}`).toBeDefined();
      expect(decodeBase64Url(v.text)).toEqual({
        ok: false,
        code: "E_SCHEMA_INVALID",
        reason: expected,
      });
    });
  }
});

describe("sha256 known answers", () => {
  const vectors = getSha256Vectors();

  it("has vectors to run", () => {
    expect(vectors.length).toBeGreaterThan(0);
  });

  for (const v of vectors) {
    it(`${v.id}: digest hex and base64url`, async () => {
      const input = hexToBytes(v.inputHex);
      const digest = await sha256(input);
      expect(bytesToHex(digest)).toBe(v.digestHex);
      expect(await sha256Base64Url(input)).toBe(encodeBase64Url(hexToBytes(v.digestHex)));
    });
  }
});
