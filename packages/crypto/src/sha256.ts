import { encodeBase64Url } from "./base64url.js";
import { ProgrammerError } from "./errors.js";
import { getSubtle } from "./webcrypto.js";

/** SHA-256 digest (32 bytes) through WebCrypto. */
export async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const subtle = getSubtle();
  try {
    return new Uint8Array(await subtle.digest("SHA-256", bytes));
  } catch {
    throw new ProgrammerError("webcrypto_failed");
  }
}

/** SHA-256 digest encoded as unpadded Base64url (43 characters). */
export async function sha256Base64Url(bytes: Uint8Array): Promise<string> {
  return encodeBase64Url(await sha256(bytes));
}
