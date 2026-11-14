/**
 * P-256 (secp256r1) point helpers: on-curve check and point decompression.
 *
 * Side-channel position: every value processed here is a public key
 * coordinate, which is public by definition, so variable-time BigInt
 * arithmetic leaks nothing secret. No private scalar, secret or signature
 * input ever enters this module. It uses no Node or browser API and imports
 * nothing else.
 *
 * Constants: FIPS 186-4 / SEC 2 secp256r1, `b` read from
 * https://std.neuromancer.sk/secg/secp256r1 (the field prime is computed).
 */

/** Field prime p = 2^256 - 2^224 + 2^192 + 2^96 - 1 (computed). */
const P: bigint = (1n << 256n) - (1n << 224n) + (1n << 192n) + (1n << 96n) - 1n;

/** Curve coefficient b of y^2 = x^3 - 3x + b. */
const B = 0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604bn;

function mod(a: bigint): bigint {
  const r = a % P;
  return r < 0n ? r + P : r;
}

function modPow(base: bigint, exponent: bigint): bigint {
  let result = 1n;
  let b = mod(base);
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % P;
    b = (b * b) % P;
    e >>= 1n;
  }
  return result;
}

/** Right-hand side of the curve equation: x^3 - 3x + b mod p. */
function rhs(x: bigint): bigint {
  return mod(x * x * x - 3n * x + B);
}

/** Interprets bytes as an unsigned big-endian integer. */
export function bytesToBigInt(bytes: Uint8Array): bigint {
  let n = 0n;
  for (const byte of bytes) n = (n << 8n) | BigInt(byte);
  return n;
}

/** Encodes 0 <= n < 2^256 as 32 big-endian bytes; null if out of range. */
export function bigIntToBytes32(n: bigint): Uint8Array | null {
  if (n < 0n || n >= 1n << 256n) return null;
  const out = new Uint8Array(32);
  let v = n;
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

/** True when 0 <= x, y < p and y^2 = x^3 - 3x + b (mod p). */
export function isOnCurve(x: bigint, y: bigint): boolean {
  if (x < 0n || y < 0n || x >= P || y >= P) return false;
  return mod(y * y) === rhs(x);
}

/**
 * Recovers y from x and the compressed-point prefix (2 = even y, 3 = odd y).
 * Returns null when x is out of range or not on the curve.
 */
export function decompress(prefix: 2 | 3, x: bigint): bigint | null {
  if (x < 0n || x >= P) return null;
  const r = rhs(x);
  // p = 3 (mod 4), so a square root is r^((p + 1) / 4).
  const root = modPow(r, (P + 1n) >> 2n);
  if (mod(root * root) !== r) return null;
  const wantOdd = prefix === 3;
  const isOdd = (root & 1n) === 1n;
  return isOdd === wantOdd ? root : mod(P - root);
}
