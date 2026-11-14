import type { ErrorCode } from "@wraith/protocol";

/** Stable vocabulary of programmer errors (thrown, never sent on the wire). */
export type ProgrammerReason =
  | "non_json_value"
  | "non_finite_number"
  | "bigint_value"
  | "lone_surrogate"
  | "cyclic_value"
  | "missing_body"
  | "webcrypto_unavailable"
  | "webcrypto_failed"
  | "key_not_extractable"
  | "wrong_key_type"
  | "empty_secret"
  | "invalid_argument"
  | "invalid_public_key"
  | "duplicate_member_id";

/** Stable vocabulary of failure reasons returned in a failed CryptoResult. */
export type FailReason =
  | "not_a_string"
  | "bad_character"
  | "bad_length"
  | "non_zero_trailing_bits"
  | "not_a_jwk"
  | "unsupported_member"
  | "has_private_member"
  | "missing_private_member"
  | "wrong_key_type"
  | "wrong_curve"
  | "bad_coordinate"
  | "not_on_curve"
  | "bad_compressed_length"
  | "bad_compressed_prefix"
  | "import_failed";

/** Error with a fixed message: no cause, no payload, no input fragment. */
export class ProgrammerError extends Error {
  readonly reason: ProgrammerReason;

  constructor(reason: ProgrammerReason) {
    super(`wraith-crypto: ${reason}`);
    this.name = "ProgrammerError";
    this.reason = reason;
  }
}

export type CryptoFailure = {
  ok: false;
  code: Extract<ErrorCode, "E_SCHEMA_INVALID">;
  reason: FailReason;
};

export type CryptoResult<T> = { ok: true; value: T } | CryptoFailure;

/** Structural key type so the package lib needs no DOM typings. */
export interface CryptoKeyHandle {
  readonly type: string;
  readonly extractable: boolean;
  readonly algorithm: { readonly name: string };
  readonly usages: readonly string[];
}

export type KeyPair = {
  publicKey: CryptoKeyHandle;
  privateKey: CryptoKeyHandle;
};
