import type { Envelope } from "./envelope.js";
import { parseEnvelopeValue } from "./envelope.js";
import type { ErrorCode } from "./errors.js";
import { ENVELOPE_MAX_BYTES } from "./limits.js";
import type { SignatureScope } from "./scope.js";
import { signatureScope } from "./scope.js";
import { utf8ByteLength } from "./text.js";

/** Minimal view of the platform TextDecoder (the package lib has no DOM typings). */
interface Utf8Decoder {
  decode(input: Uint8Array): string;
}
declare const TextDecoder: new (label: string, options: { fatal: boolean }) => Utf8Decoder;

/**
 * Result of the gate. Failures carry an error code and, for schema failures, path segments
 * only; never any content of the frame.
 */
export type ParseRawResult =
  | {
      ok: true;
      envelope: Envelope;
      /**
       * Signature scope of the RAW parsed JSON value, taken before the typed parse strips
       * unknown body fields. Application code acts only on `envelope` and never reads fields
       * from `signed`; `signed` is for signature verification only.
       */
      signed: SignatureScope<unknown>;
    }
  | { ok: false; code: ErrorCode; path?: readonly string[] };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The gate entry function (R5). Fixed order: (1) UTF-8 byte size of the raw frame, measured
 * before `JSON.parse`; (2) JSON decode, object check; (3) version; (4) schema. Never throws.
 *
 * Application code acts only on `envelope` and never reads fields from `signed`; `signed` is
 * for signature verification only.
 */
export function parseRaw(raw: string | Uint8Array): ParseRawResult {
  try {
    const size = typeof raw === "string" ? utf8ByteLength(raw, ENVELOPE_MAX_BYTES) : raw.byteLength;
    if (size > ENVELOPE_MAX_BYTES) return { ok: false, code: "E_PAYLOAD_TOO_LARGE" };

    let value: unknown;
    try {
      const text =
        typeof raw === "string" ? raw : new TextDecoder("utf-8", { fatal: true }).decode(raw);
      value = JSON.parse(text);
    } catch {
      return { ok: false, code: "E_SCHEMA_INVALID" };
    }
    if (!isPlainObject(value)) return { ok: false, code: "E_SCHEMA_INVALID" };

    if (value.v !== 1) return { ok: false, code: "E_UNSUPPORTED_VERSION" };

    const parsed = parseEnvelopeValue(value);
    if (!parsed.ok) {
      return parsed.path !== undefined
        ? { ok: false, code: parsed.code, path: parsed.path }
        : { ok: false, code: parsed.code };
    }
    const signed = signatureScope<unknown>({
      v: 1,
      meta: value.meta,
      body: value.body,
    });
    return { ok: true, envelope: parsed.envelope, signed };
  } catch {
    return { ok: false, code: "E_SCHEMA_INVALID" };
  }
}
