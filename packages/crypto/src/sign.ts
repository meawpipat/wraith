import type { Sig, SignatureScopeInput } from "@wraith/protocol";
import { decodeBase64Url, encodeBase64Url } from "./base64url.js";
import { type CryptoKeyHandle, ProgrammerError } from "./errors.js";
import { failClosed, isPlainRecord, isRecord } from "./guard.js";
import { importPublicKey } from "./keys.js";
import { scopeBytes } from "./scope-bytes.js";
import { getSubtle } from "./webcrypto.js";

const ECDSA_SHA256 = { name: "ECDSA", hash: "SHA-256" } as const;
const SIGNATURE_LENGTH = 64;

function isKeyHandle(key: unknown, type: string, usage: string): key is CryptoKeyHandle {
  if (typeof key !== "object" || key === null) return false;
  const k = key as Partial<CryptoKeyHandle>;
  return (
    k.type === type &&
    typeof k.algorithm === "object" &&
    k.algorithm !== null &&
    k.algorithm.name === "ECDSA" &&
    Array.isArray(k.usages) &&
    k.usages.includes(usage)
  );
}

/** Signs raw bytes with ECDSA P-256 / SHA-256. Returns 64 bytes (raw r||s). */
export async function signBytes(
  privateKey: CryptoKeyHandle,
  bytes: Uint8Array,
): Promise<Uint8Array> {
  if (!isKeyHandle(privateKey, "private", "sign")) throw new ProgrammerError("wrong_key_type");
  const subtle = getSubtle();
  let raw: ArrayBuffer;
  try {
    raw = await subtle.sign(ECDSA_SHA256, privateKey, bytes);
  } catch {
    throw new ProgrammerError("webcrypto_failed");
  }
  const out = new Uint8Array(raw);
  if (out.length !== SIGNATURE_LENGTH) throw new ProgrammerError("webcrypto_failed");
  return out;
}

/**
 * Signs the signature scope `{v, meta, body}` of an envelope. `memberId` is only copied
 * into `by`. The envelope is not validated and not mutated; `sig` and `relay` are never read.
 */
export async function sign(
  privateKey: CryptoKeyHandle,
  memberId: string,
  input: SignatureScopeInput<unknown>,
): Promise<Sig> {
  const signature = await signBytes(privateKey, scopeBytes(input));
  return { by: memberId, alg: "ES256", value: encodeBase64Url(signature) } as Sig;
}

async function resolveVerifyKey(publicKey: unknown): Promise<CryptoKeyHandle | null> {
  if (isPlainRecord(publicKey)) {
    const imported = await importPublicKey(publicKey);
    return imported.ok ? imported.value : null;
  }
  return isKeyHandle(publicKey, "public", "verify") ? publicKey : null;
}

async function verifyBytesImpl(
  bytes: unknown,
  signature: unknown,
  publicKey: unknown,
): Promise<boolean> {
  if (!(bytes instanceof Uint8Array)) return false;
  if (!(signature instanceof Uint8Array) || signature.length !== SIGNATURE_LENGTH) return false;
  const key = await resolveVerifyKey(publicKey);
  if (key === null) return false;
  return (await getSubtle().verify(ECDSA_SHA256, key, signature, bytes)) === true;
}

async function verifyImpl(scope: unknown, sig: unknown, publicKey: unknown): Promise<boolean> {
  if (!isPlainRecord(sig)) return false;
  if (!isRecord(scope) || scope.v !== 1) return false;
  if (sig.alg !== "ES256") return false;
  const decoded = decodeBase64Url(sig.value);
  if (!decoded.ok || decoded.value.length !== SIGNATURE_LENGTH) return false;
  const bytes = scopeBytes(scope as unknown as SignatureScopeInput<unknown>);
  return verifyBytesImpl(bytes, decoded.value, publicKey);
}

/**
 * Verifies ECDSA P-256 / SHA-256 over raw bytes. `signature` is the 64-byte raw r||s.
 * `publicKey` is a Public_JWK or a public CryptoKeyHandle. Never throws; any failure is `false`.
 */
export async function verifyBytes(
  bytes: unknown,
  signature: unknown,
  publicKey: unknown,
): Promise<boolean> {
  return failClosed(async () => verifyBytesImpl(bytes, signature, publicKey));
}

/**
 * Verifies `sig` over the signature scope `{v, meta, body}` of `scope`. Never throws;
 * every failure is `false`.
 *
 * Frames parsed with parseRaw are verified with `parsed.signed` (the Signed_Member).
 * `true` means only that the bytes verify under the key. It says nothing about freshness,
 * revocation, authorization or roster membership: SI-3 and SI-5 stay with the Verifier.
 * The caller passes the public key taken from the owner-signed pinned roster; `sig.by` is
 * never used for the decision and `relay` is never read.
 */
export async function verify(scope: unknown, sig: unknown, publicKey: unknown): Promise<boolean> {
  return failClosed(async () => verifyImpl(scope, sig, publicKey));
}
