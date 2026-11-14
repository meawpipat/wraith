// Key pool, fresh-pair helper and Property 16 defect injectors (R5.7, R5.8, R13.4).
// Portable: no `node:` import; imports `src` modules directly.
import fc from "fast-check";
import { decodeBase64Url, encodeBase64Url } from "../../src/base64url.js";
import type { KeyPair } from "../../src/errors.js";
import {
  exportPrivateJwk,
  exportPublicJwk,
  generateKeyPair,
  type PrivateJwk,
  type PublicJwk,
} from "../../src/keys.js";

/** One pool entry: both handles and both JWK forms. */
export type PoolKey = { pair: KeyPair; publicJwk: PublicJwk; privateJwk: PrivateJwk };

/** A plain mutable copy of a public JWK, the input of every injector. */
export type JwkObject = Record<string, unknown>;

/** Generates a fresh pair; the private key is extractable only when asked. */
export async function freshKeyPair(options?: { extractablePrivate?: boolean }): Promise<KeyPair> {
  return generateKeyPair(options);
}

async function makePoolKey(): Promise<PoolKey> {
  const pair = await generateKeyPair({ extractablePrivate: true });
  return {
    pair,
    publicJwk: await exportPublicJwk(pair.publicKey),
    privateJwk: await exportPrivateJwk(pair.privateKey),
  };
}

let pool: PoolKey[] = [];
let pending: Promise<void> | null = null;

/** The first `n` pool keys; the pool grows on demand and is shared within one test file. */
export async function getKeyPool(n: number): Promise<readonly PoolKey[]> {
  while (pool.length < n) {
    if (pending === null) {
      const missing = n - pool.length;
      pending = (async () => {
        const made = await Promise.all(Array.from({ length: missing }, makePoolKey));
        pool = pool.concat(made);
      })().finally(() => {
        pending = null;
      });
    }
    await pending;
  }
  return pool.slice(0, n);
}

/** Arbitrary over indexes into a pool of size `n`. */
export function poolIndexArb(n: number): fc.Arbitrary<number> {
  return fc.integer({ min: 0, max: n - 1 });
}

function copy(jwk: PublicJwk | JwkObject): JwkObject {
  return { ...(jwk as JwkObject) };
}

/** Adds a private member `d`. */
export function addPrivateMember(jwk: PublicJwk | JwkObject, d = "AAAA"): JwkObject {
  return { ...copy(jwk), d };
}

/** Replaces `kty` with a wrong value. */
export function wrongKty(jwk: PublicJwk | JwkObject, kty = "RSA"): JwkObject {
  return { ...copy(jwk), kty };
}

/** Replaces `crv` with a wrong value. */
export function wrongCrv(jwk: PublicJwk | JwkObject, crv = "P-384"): JwkObject {
  return { ...copy(jwk), crv };
}

/** Makes coordinate `member` 42 or 44 characters long (31 or 33 bytes). */
export function wrongLengthCoordinate(
  jwk: PublicJwk | JwkObject,
  member: "x" | "y",
  length: 42 | 44,
): JwkObject {
  const out = copy(jwk);
  const value = String(out[member]);
  out[member] = length === 42 ? value.slice(0, 42) : `${value}A`;
  return out;
}

/** Flips the low bit of y so the point is almost surely off the curve. */
export function offCurvePoint(jwk: PublicJwk | JwkObject): JwkObject {
  const out = copy(jwk);
  const decoded = decodeBase64Url(out.y);
  if (!decoded.ok) throw new Error("offCurvePoint needs a valid public JWK");
  const bytes = decoded.value.slice();
  bytes[31] = (bytes[31] as number) ^ 1;
  out.y = encodeBase64Url(bytes);
  return out;
}

/** Removes one of kty, crv, x, y. */
export function missingMember(
  jwk: PublicJwk | JwkObject,
  name: "kty" | "crv" | "x" | "y",
): JwkObject {
  const out = copy(jwk);
  delete out[name];
  return out;
}

/** Replaces one of kty, crv, x, y with a non-string value. */
export function nonStringMember(
  jwk: PublicJwk | JwkObject,
  name: "kty" | "crv" | "x" | "y",
  value: unknown = 1,
): JwkObject {
  return { ...copy(jwk), [name]: value };
}

/** Adds an unsupported extra member such as `kid`. */
export function unsupportedExtraMember(
  jwk: PublicJwk | JwkObject,
  name = "kid",
  value: unknown = "k1",
): JwkObject {
  return { ...copy(jwk), [name]: value };
}

/** The four members import must ignore, with sample values. */
export const IGNORABLE_MEMBERS: readonly { name: string; value: unknown }[] = [
  { name: "use", value: "sig" },
  { name: "key_ops", value: ["verify"] },
  { name: "ext", value: true },
  { name: "alg", value: "ES256" },
];
