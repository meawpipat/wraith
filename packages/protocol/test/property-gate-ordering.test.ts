/**
 * Feature: s-protocol, Property 6: Gate ordering
 *
 * `parseRaw` never throws and applies a fixed order: UTF-8 size, then JSON object, then
 * version, then schema.
 *
 * **Validates: Requirements 5.1, 5.2, 5.3, 5.8, 24.5**
 */
import * as fc from "fast-check";
import { describe, it } from "vitest";
import { parseEnvelopeValue } from "../src/envelope.ts";
import { ENVELOPE_MAX_BYTES } from "../src/limits.ts";
import { parseRaw } from "../src/parse.ts";
import type { ParseRawResult } from "../src/parse.ts";
import { MESSAGE_TYPES } from "../src/message-types.ts";
import { validRawEnvelopeArb } from "../src/testing/arbitraries.ts";
import { PBT_MIN_RUNS, pbt } from "./config.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

/** Independent oracle: the verdict the fixed gate order prescribes. */
function oracle(raw: string | Uint8Array): unknown {
  const bytes = typeof raw === "string" ? encoder.encode(raw) : raw;
  if (bytes.byteLength > ENVELOPE_MAX_BYTES) return { ok: false, code: "E_PAYLOAD_TOO_LARGE" };
  let value: unknown;
  try {
    value = JSON.parse(typeof raw === "string" ? raw : decoder.decode(raw));
  } catch {
    return { ok: false, code: "E_SCHEMA_INVALID" };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, code: "E_SCHEMA_INVALID" };
  }
  if ((value as Record<string, unknown>).v !== 1) {
    return { ok: false, code: "E_UNSUPPORTED_VERSION" };
  }
  const parsed = parseEnvelopeValue(value);
  return parsed.ok ? { ok: true } : { ok: false, code: parsed.code };
}

/** Reduce a result to the comparable verdict (code or ok). */
function verdict(r: ParseRawResult): unknown {
  return r.ok ? { ok: true } : { ok: false, code: r.code };
}

const versionArb = fc.oneof(
  fc.constant(1),
  fc.constant(undefined),
  fc.integer(),
  fc.double(),
  fc.string({ maxLength: 4 }),
  fc.constant(null),
  fc.boolean(),
  fc.constant("1"),
  fc.constant(1.5),
  fc.constantFrom(0, 2, -1),
);

/** Valid envelope with `v` possibly replaced, and optional junk meta/body/sig/relay. */
const objectJsonArb: fc.Arbitrary<string> = fc.oneof(
  fc
    .constantFrom(...MESSAGE_TYPES)
    .chain((t) => validRawEnvelopeArb(t))
    .map((e) => JSON.stringify(e)),
  fc
    .tuple(
      versionArb,
      fc.jsonValue(),
      fc.jsonValue(),
      fc.option(fc.jsonValue(), { nil: undefined }),
      fc.option(fc.jsonValue(), { nil: undefined }),
    )
    .map(([v, meta, body, sig, relay]) => JSON.stringify({ v, meta, body, sig, relay })),
  fc
    .tuple(
      versionArb,
      fc.constantFrom(...MESSAGE_TYPES).chain((t) => validRawEnvelopeArb(t)),
    )
    .map(([v, e]) => JSON.stringify({ ...e, v })),
);

const textArb: fc.Arbitrary<string> = fc.oneof(
  objectJsonArb,
  fc.jsonValue().map((j) => JSON.stringify(j)),
  fc.string({ maxLength: 200 }),
  fc.string({ unit: "binary", maxLength: 200 }),
  fc.constantFrom("", "{", "[]", "null", "1", '"x"', "{}", '{"v":1}', "\uFEFF{}", "{'v':1}"),
);

type Pad = { kind: "none" } | { kind: "ws" | "multibyte"; delta: number };
const padArb: fc.Arbitrary<Pad> = fc.oneof(
  fc.constant<Pad>({ kind: "none" }),
  fc.record({
    kind: fc.constantFrom<"ws" | "multibyte">("ws", "multibyte"),
    delta: fc.integer({ min: -3, max: 3 }),
  }),
);

/** Builds text whose UTF-8 byte length is ENVELOPE_MAX_BYTES + delta (when possible). */
function applyPad(text: string, pad: Pad): string {
  if (pad.kind === "none") return text;
  const target = ENVELOPE_MAX_BYTES + pad.delta;
  const base = encoder.encode(text).byteLength;
  if (pad.kind === "ws") {
    return base < target ? text + " ".repeat(target - base) : text;
  }
  // Multi-byte filler: a JSON object holding 2-byte characters, so the character count
  // stays well under the limit while the byte count sits at the boundary.
  const head = `{"v":${text.length % 2 === 0 ? 1 : 2},"pad":"`;
  const tail = '"}';
  const fixed = encoder.encode(head + tail).byteLength;
  const room = target - fixed;
  if (room < 0) return text;
  const twoByte = Math.floor(room / 2);
  return head + "\u00e9".repeat(twoByte) + "a".repeat(room - twoByte * 2) + tail;
}

const rawArb: fc.Arbitrary<string | Uint8Array> = fc.oneof(
  fc
    .tuple(textArb, padArb)
    .map(([t, p]) => applyPad(t, p)),
  fc
    .tuple(textArb, padArb)
    .map(([t, p]) => encoder.encode(applyPad(t, p))),
  fc.uint8Array({ maxLength: 200 }),
  // Oversize raw bytes of arbitrary content, plus invalid UTF-8 bytes at the boundary.
  fc
    .tuple(fc.uint8Array({ maxLength: 50 }), fc.integer({ min: -2, max: 2 }))
    .map(([b, d]) => {
      const out = new Uint8Array(Math.max(0, ENVELOPE_MAX_BYTES + d));
      out.fill(0xff);
      out.set(b.subarray(0, Math.min(b.length, out.length)));
      return out;
    }),
);

describe("Property 6: Gate ordering", () => {
  it("never throws and follows size, JSON object, version, schema order", () => {
    pbt(
      fc.property(rawArb, (raw) => {
        const result = parseRaw(raw);
        const expected = oracle(raw);
        if (JSON.stringify(verdict(result)) !== JSON.stringify(expected)) {
          throw new Error(
            `verdict mismatch: got ${JSON.stringify(verdict(result))}, expected ${JSON.stringify(expected)}`,
          );
        }
      }),
      { numRuns: PBT_MIN_RUNS },
    );
  });

  it("character count under the limit but byte count over it is E_PAYLOAD_TOO_LARGE", () => {
    pbt(
      fc.property(fc.integer({ min: 1, max: 4 }), fc.boolean(), (extra, asBytes) => {
        const chars = ENVELOPE_MAX_BYTES / 2 + extra;
        const text = "\u00e9".repeat(chars);
        const raw = asBytes ? encoder.encode(text) : text;
        const r = parseRaw(raw);
        if (chars >= ENVELOPE_MAX_BYTES || r.ok || r.code !== "E_PAYLOAD_TOO_LARGE") {
          throw new Error(`expected E_PAYLOAD_TOO_LARGE, got ${JSON.stringify(verdict(r))}`);
        }
      }),
      { numRuns: PBT_MIN_RUNS },
    );
  });
});
