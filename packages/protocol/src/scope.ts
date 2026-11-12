import type { Meta } from "./envelope.js";

/**
 * The signature scope of an envelope (R3.1): exactly `v`, `meta` and `body`.
 * `sig` and `relay` are NOT part of it (SI-4): a relay-added field can never
 * influence what is signed. Canonicalisation, hashing and signing of this
 * value belong to S-crypto, not to this package (R3.8).
 *
 * `M` defaults to the strict `Meta`; it is wider only for the raw-JSON path.
 */
export type SignatureScope<M = Meta> = { v: 1; meta: M; body: unknown };

/**
 * Minimal structural input of `signatureScope`. A parsed `Envelope` satisfies
 * it, and so does a raw parsed JSON value with `v`, `meta` and `body`, which
 * lets `parseRaw` build `signed` from the raw value before any stripping.
 * Extra keys (`sig`, `relay`, anything else) are allowed and ignored.
 */
export type SignatureScopeInput<M = Meta> = {
  readonly v: 1;
  readonly meta: M;
  readonly body?: unknown;
};

/**
 * Returns a NEW object with exactly the keys `v`, `meta`, `body`. It shares
 * the input's `meta` and `body` references, never mutates the input, performs
 * no I/O, and does no canonicalisation, hashing or signing (R3.2, R3.8).
 */
export function signatureScope<M = Meta>(input: SignatureScopeInput<M>): SignatureScope<M> {
  return { v: input.v, meta: input.meta, body: input.body };
}
