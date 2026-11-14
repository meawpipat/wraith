import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { decodeBase64Url, encodeBase64Url } from "../src/base64url.js";
import { pbt } from "./config.js";

// Feature: s-crypto, Property 1: Base64url round trip and canonical form
// **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 13.11**

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const bytesArb = fc.oneof(
  fc.uint8Array({ minLength: 0, maxLength: 64 }),
  fc.uint8Array({ minLength: 0, maxLength: 2048 }),
);

const alphaChar = fc.constantFrom(...ALPHABET.split(""));
const alphaString = (minLength: number, maxLength: number) =>
  fc.string({ unit: alphaChar, minLength, maxLength });

const validEncodingArb = bytesArb.map((b) => encodeBase64Url(b));

/** Characters the decoder must refuse anywhere in the input. */
const forbiddenCharArb = fc.oneof(
  fc.constantFrom("=", "+", "/", " ", "\t", "\n", "\r", "\f", "\v", "\u00a0", "\u2003"),
  fc.integer({ min: 128, max: 0xffff }).map((c) => String.fromCharCode(c)),
);

function rejected(result: ReturnType<typeof decodeBase64Url>): boolean {
  return !result.ok && result.code === "E_SCHEMA_INVALID";
}

describe("Property 1: Base64url round trip and canonical form", () => {
  it("decode(encode(bytes)) equals bytes", () => {
    pbt(
      fc.property(bytesArb, (bytes) => {
        const res = decodeBase64Url(encodeBase64Url(bytes));
        expect(res.ok).toBe(true);
        if (res.ok) expect(Array.from(res.value)).toEqual(Array.from(bytes));
      }),
    );
  });

  it("round-trips every length 0..64", () => {
    pbt(
      fc.property(
        fc.integer({ min: 0, max: 64 }).chain((n) => fc.uint8Array({ minLength: n, maxLength: n })),
        (bytes) => {
          const res = decodeBase64Url(encodeBase64Url(bytes));
          expect(res.ok && res.value.length === bytes.length).toBe(true);
        },
      ),
    );
    expect(decodeBase64Url("")).toEqual({ ok: true, value: new Uint8Array(0) });
  });

  it("encoding uses only the URL-safe alphabet and no padding", () => {
    pbt(
      fc.property(bytesArb, (bytes) => {
        const s = encodeBase64Url(bytes);
        expect(/^[A-Za-z0-9_-]*$/.test(s)).toBe(true);
        expect(s.includes("=")).toBe(false);
        expect(s.length).toBe(Math.ceil((bytes.length * 4) / 3));
      }),
    );
  });

  it("whenever decode accepts, encode(decode(s)) equals s (no second spelling)", () => {
    const candidate = fc.oneof(fc.string({ maxLength: 40 }), alphaString(0, 40), alphaString(1, 4));
    pbt(
      fc.property(candidate, (s) => {
        const res = decodeBase64Url(s);
        if (res.ok) expect(encodeBase64Url(res.value)).toBe(s);
      }),
    );
  });

  it("rejects a valid encoding mutated with a forbidden character", () => {
    pbt(
      fc.property(validEncodingArb, forbiddenCharArb, fc.nat(), (enc, ch, pos) => {
        const at = pos % (enc.length + 1);
        const mutated = enc.slice(0, at) + ch + enc.slice(at);
        expect(rejected(decodeBase64Url(mutated))).toBe(true);
      }),
    );
  });

  it("rejects padded encodings", () => {
    pbt(
      fc.property(bytesArb, (bytes) => {
        const enc = encodeBase64Url(bytes);
        const padded = enc + "=".repeat((4 - (enc.length % 4)) % 4 || 1);
        expect(rejected(decodeBase64Url(padded))).toBe(true);
      }),
    );
  });

  it("rejects any length with remainder 1 modulo 4", () => {
    const badLen = fc
      .tuple(fc.nat({ max: 40 }), alphaString(1, 1))
      .chain(([k, extra]) => alphaString(4 * k, 4 * k).map((s) => s + extra));
    pbt(
      fc.property(badLen, (s) => {
        expect(s.length % 4).toBe(1);
        expect(rejected(decodeBase64Url(s))).toBe(true);
      }),
    );
  });

  it("rejects non-string input without throwing", () => {
    pbt(
      fc.property(
        fc.anything().filter((v) => typeof v !== "string"),
        (v) => {
          expect(rejected(decodeBase64Url(v))).toBe(true);
        },
      ),
    );
  });

  it("never throws on arbitrary strings", () => {
    pbt(
      fc.property(fc.string({ unit: "binary", maxLength: 60 }), (s) => {
        const res = decodeBase64Url(s);
        expect(res.ok || res.code === "E_SCHEMA_INVALID").toBe(true);
      }),
    );
  });
});
