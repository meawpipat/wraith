import { type CryptoKeyHandle, type KeyPair, ProgrammerError } from "./errors.js";

/**
 * Structural subset of WebCrypto used by the package. The lib has no DOM
 * typings, so a DOM or Workers `SubtleCrypto` is assignable to this type.
 */
export interface SubtleCryptoLike {
  digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer>;
  importKey(
    format: "jwk" | "raw",
    keyData: object | Uint8Array,
    algorithm: object,
    extractable: boolean,
    usages: readonly string[],
  ): Promise<CryptoKeyHandle>;
  exportKey(format: "jwk", key: CryptoKeyHandle): Promise<object>;
  generateKey(algorithm: object, extractable: boolean, usages: readonly string[]): Promise<KeyPair>;
  sign(algorithm: string | object, key: CryptoKeyHandle, data: Uint8Array): Promise<ArrayBuffer>;
  verify(
    algorithm: string | object,
    key: CryptoKeyHandle,
    signature: Uint8Array,
    data: Uint8Array,
  ): Promise<boolean>;
}

/** Fills the array with random values and returns it. */
export type GetRandomValues = (array: Uint8Array) => Uint8Array;

/** Minimal view of the platform TextEncoder. */
export interface TextEncoderLike {
  encode(input: string): Uint8Array;
}

interface CryptoLike {
  subtle?: Partial<SubtleCryptoLike>;
  getRandomValues?: GetRandomValues;
}

const SUBTLE_METHODS = [
  "digest",
  "importKey",
  "exportKey",
  "generateKey",
  "sign",
  "verify",
] as const;

function currentCrypto(): CryptoLike | undefined {
  // Read on every call: no module-load access, no caching.
  return (globalThis as { crypto?: CryptoLike }).crypto;
}

/** The platform SubtleCrypto, or ProgrammerError("webcrypto_unavailable"). */
export function getSubtle(): SubtleCryptoLike {
  const subtle = currentCrypto()?.subtle;
  if (subtle === undefined || subtle === null) {
    throw new ProgrammerError("webcrypto_unavailable");
  }
  for (const method of SUBTLE_METHODS) {
    if (typeof subtle[method] !== "function") {
      throw new ProgrammerError("webcrypto_unavailable");
    }
  }
  return subtle as SubtleCryptoLike;
}

/** The platform getRandomValues bound to crypto, or ProgrammerError("webcrypto_unavailable"). */
export function getRandomValuesFn(): GetRandomValues {
  const c = currentCrypto();
  const fn = c?.getRandomValues;
  if (c === undefined || typeof fn !== "function") {
    throw new ProgrammerError("webcrypto_unavailable");
  }
  return (array) => fn.call(c, array);
}
