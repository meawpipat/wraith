import type { SignatureScopeInput } from "@wraith/protocol";
import { decodeBase64Url } from "./base64url.js";
import { equalBytesFixed } from "./bytes.js";
import { scopeBytes } from "./scope-bytes.js";
import { sha256Base64Url } from "./sha256.js";

const HASH_LENGTH = 32;

/**
 * Request_Hash: Base64url (43 characters) of SHA-256 over the same Canonical_Bytes that `sign`
 * signs, so the hash and the signature cannot cover different bytes. `sig` and `relay` do not
 * matter (SI-4). Accepts an Envelope or the Signed_Member and checks no `meta.type`. Throws
 * ProgrammerError on a Non_JSON_Value (from scopeBytes).
 */
export async function requestHash(input: SignatureScopeInput<unknown>): Promise<string> {
  return sha256Base64Url(scopeBytes(input));
}

/**
 * Compares two Request_Hash values in constant time over the decoded 32 bytes. Returns false
 * for anything malformed (not a string, bad Base64url, not 32 bytes). Never throws and binds
 * nothing: a true result only says the two strings denote the same digest.
 */
export function requestHashEquals(a: unknown, b: unknown): boolean {
  try {
    const left = decodeBase64Url(a);
    const right = decodeBase64Url(b);
    if (!left.ok || !right.ok) return false;
    if (left.value.length !== HASH_LENGTH || right.value.length !== HASH_LENGTH) return false;
    return equalBytesFixed(left.value, right.value);
  } catch {
    return false;
  }
}
