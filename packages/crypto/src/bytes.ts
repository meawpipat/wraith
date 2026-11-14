import { ProgrammerError } from "./errors.js";

/** Concatenates byte arrays into a new array. */
export function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * Compares two arrays by XOR accumulation over the longer length, with no
 * early exit. Different lengths always compare unequal.
 */
export function equalBytesFixed(a: Uint8Array, b: Uint8Array): boolean {
  const n = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < n; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

/** Encodes a safe non-negative integer as 8 big-endian bytes. */
export function u64be(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ProgrammerError("invalid_argument");
  }
  const high = Math.floor(value / 0x1_0000_0000);
  const low = value % 0x1_0000_0000;
  const out = new Uint8Array(8);
  out[0] = (high >>> 24) & 0xff;
  out[1] = (high >>> 16) & 0xff;
  out[2] = (high >>> 8) & 0xff;
  out[3] = high & 0xff;
  out[4] = (low >>> 24) & 0xff;
  out[5] = (low >>> 16) & 0xff;
  out[6] = (low >>> 8) & 0xff;
  out[7] = low & 0xff;
  return out;
}
