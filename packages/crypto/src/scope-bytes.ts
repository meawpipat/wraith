import { type SignatureScopeInput, signatureScope } from "@wraith/protocol";
import { ProgrammerError } from "./errors.js";
import { canonicalizeBytes } from "./jcs.js";

/**
 * Canonical_Bytes of the signature scope `{v, meta, body}`. The only place a scope is
 * canonicalized: sign, verify and requestHash all use it. `sig` and `relay` are never read.
 * Throws ProgrammerError("missing_body") when `body` is undefined.
 */
export function scopeBytes(input: SignatureScopeInput<unknown>): Uint8Array {
  const scope = signatureScope(input);
  if (scope.body === undefined) throw new ProgrammerError("missing_body");
  return canonicalizeBytes(scope);
}
