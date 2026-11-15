// Public API of @wraith/crypto. Re-exports only (R1.5); nothing from @wraith/protocol (R1.2, R1.3).

export { decodeBase64Url, encodeBase64Url } from "./base64url.js";
export type {
  CryptoFailure,
  CryptoKeyHandle,
  CryptoResult,
  FailReason,
  KeyPair,
  ProgrammerReason,
} from "./errors.js";
export { ProgrammerError } from "./errors.js";
export { canonicalize, canonicalizeBytes } from "./jcs.js";
export type { PrivateJwk, PublicJwk } from "./keys.js";
export {
  exportPrivateJwk,
  exportPublicJwk,
  generateKeyPair,
  importPrivateKey,
  importPublicKey,
  keyFingerprint,
  publicJwkOf,
  publicKeyFromCompressed,
  publicKeyToCompressed,
} from "./keys.js";
export { randomBytes } from "./random.js";
export { requestHash, requestHashEquals } from "./request-hash.js";
export { sha256, sha256Base64Url } from "./sha256.js";
export { sign, signBytes, verify, verifyBytes } from "./sign.js";
export { utf8Encode } from "./utf8.js";
