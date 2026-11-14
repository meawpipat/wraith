import { JWK } from "@wraith/protocol";
import { decodeBase64Url, encodeBase64Url } from "./base64url.js";
import {
  type CryptoFailure,
  type CryptoKeyHandle,
  type CryptoResult,
  type FailReason,
  type KeyPair,
  ProgrammerError,
} from "./errors.js";
import { isPlainRecord } from "./guard.js";
import { bigIntToBytes32, bytesToBigInt, decompress, isOnCurve } from "./p256.js";
import { sha256 } from "./sha256.js";
import { getSubtle } from "./webcrypto.js";

/** Public key in JWK form: exactly kty, crv, x, y. */
export type PublicJwk = JWK;

/** Private key in JWK form (local type, hand-written structural check). */
export type PrivateJwk = { kty: "EC"; crv: "P-256"; x: string; y: string; d: string };

const ALGORITHM = { name: "ECDSA", namedCurve: "P-256" } as const;
const IGNORED_MEMBERS: readonly string[] = ["use", "key_ops", "ext", "alg"];

function fail(reason: FailReason): CryptoFailure {
  return { ok: false, code: "E_SCHEMA_INVALID", reason };
}

function pick(source: Record<string, unknown>, names: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const name of names) out[name] = source[name];
  return out;
}

/**
 * Copies own enumerable data properties (plus own `d`) without invoking getters.
 * Returns null when any member is an accessor.
 */
function snapshotOf(input: Record<string, unknown>): Record<string, unknown> | null {
  const out: Record<string, unknown> = Object.create(null);
  const names = new Set(Object.keys(input));
  if (Object.hasOwn(input, "d")) names.add("d");
  for (const name of names) {
    const desc = Object.getOwnPropertyDescriptor(input, name);
    if (desc === undefined || !("value" in desc)) return null;
    out[name] = desc.value;
  }
  return out;
}

/** Strict 32-byte coordinate (or scalar) decode. */
function decode32(value: unknown): Uint8Array | null {
  const decoded = decodeBase64Url(value);
  if (!decoded.ok || decoded.value.length !== 32) return null;
  return decoded.value;
}

type Normalized = {
  jwk: PublicJwk;
  d: string | undefined;
  x: Uint8Array;
  y: Uint8Array;
};

/** Steps 1 to 6 of import: plain record, members, schema, decoding, on-curve. */
function normalize(input: unknown, withPrivate: boolean): CryptoResult<Normalized> {
  try {
    if (!isPlainRecord(input)) return fail("not_a_jwk");
    const snapshot = snapshotOf(input);
    if (snapshot === null) return fail("not_a_jwk");
    return normalizeSnapshot(snapshot, withPrivate);
  } catch {
    return fail("not_a_jwk");
  }
}

function normalizeSnapshot(
  input: Record<string, unknown>,
  withPrivate: boolean,
): CryptoResult<Normalized> {
  const hasD = Object.hasOwn(input, "d");
  if (!withPrivate && hasD) return fail("has_private_member");
  if (withPrivate && !hasD) return fail("missing_private_member");
  for (const name of Object.keys(input)) {
    if (name === "kty" || name === "crv" || name === "x" || name === "y") continue;
    if (withPrivate && name === "d") continue;
    if (IGNORED_MEMBERS.includes(name)) continue;
    return fail("unsupported_member");
  }
  const { kty, crv } = input;
  if (typeof kty === "string" && kty !== "EC") return fail("wrong_key_type");
  if (typeof crv === "string" && crv !== "P-256") return fail("wrong_curve");
  const parsed = JWK.safeParse(pick(input, ["kty", "crv", "x", "y"]));
  if (!parsed.success) return fail("not_a_jwk");
  const jwk = parsed.data as PublicJwk;
  const x = decode32(jwk.x);
  const y = decode32(jwk.y);
  if (x === null || y === null) return fail("bad_coordinate");
  let d: string | undefined;
  if (withPrivate) {
    if (typeof input.d !== "string" || decode32(input.d) === null) return fail("bad_coordinate");
    d = input.d;
  }
  if (!isOnCurve(bytesToBigInt(x), bytesToBigInt(y))) return fail("not_on_curve");
  return { ok: true, value: { jwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, d, x, y } };
}

function publicOf(n: Normalized): PublicJwk {
  return { kty: "EC", crv: "P-256", x: n.jwk.x, y: n.jwk.y };
}

/** Generates an ECDSA P-256 pair; the private key is non-extractable by default. */
export async function generateKeyPair(options?: {
  extractablePrivate?: boolean;
}): Promise<KeyPair> {
  const subtle = getSubtle();
  try {
    return await subtle.generateKey(ALGORITHM, options?.extractablePrivate === true, [
      "sign",
      "verify",
    ]);
  } catch {
    throw new ProgrammerError("webcrypto_failed");
  }
}

/** Exports a public key as exactly kty, crv, x, y. */
export async function exportPublicJwk(publicKey: CryptoKeyHandle): Promise<PublicJwk> {
  if (publicKey.type !== "public") throw new ProgrammerError("wrong_key_type");
  const subtle = getSubtle();
  let raw: object;
  try {
    raw = await subtle.exportKey("jwk", publicKey);
  } catch {
    throw new ProgrammerError("webcrypto_failed");
  }
  const r = raw as Record<string, string>;
  return { kty: "EC", crv: "P-256", x: r.x as string, y: r.y as string };
}

/** Exports an extractable private key as kty, crv, x, y, d. */
export async function exportPrivateJwk(privateKey: CryptoKeyHandle): Promise<PrivateJwk> {
  if (privateKey.type !== "private") throw new ProgrammerError("wrong_key_type");
  if (!privateKey.extractable) throw new ProgrammerError("key_not_extractable");
  const subtle = getSubtle();
  let raw: object;
  try {
    raw = await subtle.exportKey("jwk", privateKey);
  } catch {
    throw new ProgrammerError("webcrypto_failed");
  }
  const r = raw as Record<string, string>;
  return { kty: "EC", crv: "P-256", x: r.x as string, y: r.y as string, d: r.d as string };
}

async function importNormalized(
  members: Record<string, string>,
  extractable: boolean,
  usage: "sign" | "verify",
): Promise<CryptoResult<CryptoKeyHandle>> {
  try {
    const key = await getSubtle().importKey("jwk", members, ALGORITHM, extractable, [usage]);
    return { ok: true, value: key };
  } catch {
    return fail("import_failed");
  }
}

/** Imports a Public_JWK as a `verify` key. Never throws on bad input. */
export async function importPublicKey(jwk: unknown): Promise<CryptoResult<CryptoKeyHandle>> {
  const n = normalize(jwk, false);
  if (!n.ok) return n;
  return importNormalized({ ...publicOf(n.value) }, true, "verify");
}

/** Imports a Private_JWK as a `sign` key. Never throws on bad input. */
export async function importPrivateKey(
  jwk: unknown,
  options?: { extractable?: boolean },
): Promise<CryptoResult<CryptoKeyHandle>> {
  const n = normalize(jwk, true);
  if (!n.ok) return n;
  const members = { ...publicOf(n.value), d: n.value.d as string };
  return importNormalized(members, options?.extractable === true, "sign");
}

/** Derives the Public_JWK from a Private_JWK; `d` is dropped. */
export function publicJwkOf(privateJwk: unknown): CryptoResult<PublicJwk> {
  const n = normalize(privateJwk, true);
  if (!n.ok) return n;
  return { ok: true, value: publicOf(n.value) };
}

/** 33-byte compressed SEC1 point: prefix 2 or 3 by parity of y, then x. */
export function publicKeyToCompressed(jwk: unknown): CryptoResult<Uint8Array> {
  const n = normalize(jwk, false);
  if (!n.ok) return n;
  const out = new Uint8Array(33);
  out[0] = ((n.value.y[31] as number) & 1) === 1 ? 3 : 2;
  out.set(n.value.x, 1);
  return { ok: true, value: out };
}

/** Decompresses a 33-byte SEC1 point into a Public_JWK. Never throws. */
export function publicKeyFromCompressed(bytes: unknown): CryptoResult<PublicJwk> {
  if (!(bytes instanceof Uint8Array) || bytes.length !== 33) return fail("bad_compressed_length");
  const prefix = bytes[0];
  if (prefix !== 2 && prefix !== 3) return fail("bad_compressed_prefix");
  const xBytes = bytes.slice(1);
  const y = decompress(prefix, bytesToBigInt(xBytes));
  if (y === null) return fail("not_on_curve");
  const yBytes = bigIntToBytes32(y);
  if (yBytes === null) return fail("bad_coordinate");
  return {
    ok: true,
    value: { kty: "EC", crv: "P-256", x: encodeBase64Url(xBytes), y: encodeBase64Url(yBytes) },
  };
}

/** SHA-256 of the compressed point (32 bytes). */
export async function keyFingerprint(jwk: unknown): Promise<CryptoResult<Uint8Array>> {
  const compressed = publicKeyToCompressed(jwk);
  if (!compressed.ok) return compressed;
  return { ok: true, value: await sha256(compressed.value) };
}
