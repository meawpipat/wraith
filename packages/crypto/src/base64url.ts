import type { CryptoResult, FailReason } from "./errors.js";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** 128-entry reverse table; -1 marks a character outside the alphabet. */
const REVERSE: Int8Array = (() => {
  const table = new Int8Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) {
    table[ALPHABET.charCodeAt(i)] = i;
  }
  return table;
})();

function fail(reason: FailReason): CryptoResult<Uint8Array> {
  return { ok: false, code: "E_SCHEMA_INVALID", reason };
}

/** Encodes bytes as Base64url without padding. */
export function encodeBase64Url(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n =
      ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8) | (bytes[i + 2] as number);
    out +=
      ALPHABET.charAt((n >> 18) & 63) +
      ALPHABET.charAt((n >> 12) & 63) +
      ALPHABET.charAt((n >> 6) & 63) +
      ALPHABET.charAt(n & 63);
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = (bytes[i] as number) << 16;
    out += ALPHABET.charAt((n >> 18) & 63) + ALPHABET.charAt((n >> 12) & 63);
  } else if (rest === 2) {
    const n = ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8);
    out +=
      ALPHABET.charAt((n >> 18) & 63) +
      ALPHABET.charAt((n >> 12) & 63) +
      ALPHABET.charAt((n >> 6) & 63);
  }
  return out;
}

/** Strict Base64url decoder: no padding, no whitespace, canonical trailing bits. */
export function decodeBase64Url(input: unknown): CryptoResult<Uint8Array> {
  if (typeof input !== "string") return fail("not_a_string");
  const len = input.length;
  const values = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    const code = input.charCodeAt(i);
    const v = code < 128 ? (REVERSE[code] as number) : -1;
    if (v < 0) return fail("bad_character");
    values[i] = v;
  }
  if (len % 4 === 1) return fail("bad_length");

  const out = new Uint8Array(Math.floor((len * 6) / 8));
  let o = 0;
  let i = 0;
  for (; i + 3 < len; i += 4) {
    const n =
      ((values[i] as number) << 18) |
      ((values[i + 1] as number) << 12) |
      ((values[i + 2] as number) << 6) |
      (values[i + 3] as number);
    out[o++] = (n >> 16) & 255;
    out[o++] = (n >> 8) & 255;
    out[o++] = n & 255;
  }
  const rest = len - i;
  if (rest === 2) {
    const n = ((values[i] as number) << 6) | (values[i + 1] as number);
    if ((n & 15) !== 0) return fail("non_zero_trailing_bits");
    out[o++] = n >> 4;
  } else if (rest === 3) {
    const n =
      ((values[i] as number) << 12) | ((values[i + 1] as number) << 6) | (values[i + 2] as number);
    if ((n & 3) !== 0) return fail("non_zero_trailing_bits");
    out[o++] = (n >> 10) & 255;
    out[o++] = (n >> 2) & 255;
  }
  return { ok: true, value: out };
}
