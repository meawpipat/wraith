// Design-rule scan of the public exports.
// Validates: Requirements 3.7, 10.11, 11.11, 14.1
import { describe, expect, it } from "vitest";
import * as api from "../src/index.js";

const EXPECTED_RUNTIME_EXPORTS = [
  "ProgrammerError",
  "canonicalize",
  "canonicalizeBytes",
  "decodeBase64Url",
  "encodeBase64Url",
  "exportPrivateJwk",
  "exportPublicJwk",
  "generateKeyPair",
  "importPrivateKey",
  "importPublicKey",
  "keyFingerprint",
  "publicJwkOf",
  "publicKeyFromCompressed",
  "publicKeyToCompressed",
  "randomBytes",
  "requestHash",
  "requestHashEquals",
  "sha256",
  "sha256Base64Url",
  "sign",
  "signBytes",
  "utf8Encode",
  "verify",
  "verifyBytes",
].sort();

const FORBIDDEN: ReadonlyArray<readonly [string, RegExp]> = [
  ["Authorization header parse/format", /authorization|wraithsig|header/i],
  ["ErrorCode mapping", /errorcode|toerror|maperror|statuscode|httpstatus/i],
  ["key storage", /keystore|storekey|savekey|loadkey|persist|keyring|keychain/i],
  ["roster check", /roster|member|allowlist|authorized/i],
  ["replay check", /replay|nonce|seen/i],
  ["clock check", /clock|skew|expir|now|timestamp|fresh/i],
];

describe("public export list", () => {
  const names = Object.keys(api).sort();

  it("matches the expected runtime exports exactly", () => {
    expect(names).toEqual(EXPECTED_RUNTIME_EXPORTS);
  });

  it.each(FORBIDDEN)("exports nothing for %s", (_label, pattern) => {
    const hits = names.filter((name) => pattern.test(name));
    expect(hits).toEqual([]);
  });
});
