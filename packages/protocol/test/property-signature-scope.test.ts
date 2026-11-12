/**
 * Feature: s-protocol, Property 5: Signature scope ignores sig and relay and tracks meta and body
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 24.3**
 */

import { isDeepStrictEqual } from "node:util";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Envelope } from "../src/envelope.ts";
import { MESSAGE_TYPES, type MessageType } from "../src/message-types.ts";
import { parseRaw } from "../src/parse.ts";
import { signatureScope } from "../src/scope.ts";
import { validEnvelopeArb, validRawEnvelopeArb } from "../src/testing/arbitraries.ts";
import { PBT_MIN_RUNS, pbt } from "./config.ts";

type Json = Record<string, unknown>;
type Path = (string | number)[];

const typeArb = fc.constantFrom<MessageType>(...MESSAGE_TYPES);
/** `signatureScope` cannot infer one `M` from the Envelope union; pin it. */
const scopeOf = (e: Envelope) => signatureScope<Envelope["meta"]>(e);
const envelopeArb = typeArb.chain((type) => validEnvelopeArb(type));
const jsonArb = fc.jsonValue();

/** Clone through JSON: generated envelopes are JSON values by construction. */
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Paths of every scalar leaf under `value`. */
function leafPaths(value: unknown, prefix: Path = []): Path[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => leafPaths(v, [...prefix, i]));
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([k, v]) => leafPaths(v, [...prefix, k]));
  }
  return [prefix];
}

function getAt(root: unknown, path: Path): unknown {
  let cur = root as Record<string | number, unknown>;
  for (const key of path) cur = cur[key] as Record<string | number, unknown>;
  return cur;
}

function setAt(root: Json, path: Path, value: unknown): void {
  const parent = getAt(root, path.slice(0, -1)) as Record<string | number, unknown>;
  parent[path[path.length - 1] as string | number] = value;
}

/** A value guaranteed to differ from `leaf`. */
function changed(leaf: unknown): unknown {
  if (typeof leaf === "string") return `${leaf}!`;
  if (typeof leaf === "number") return leaf + 1;
  if (typeof leaf === "boolean") return !leaf;
  return "changed";
}

// Generated records may have a null prototype; normalise through JSON before comparing.
const eq = (a: unknown, b: unknown): boolean => isDeepStrictEqual(clone(a), clone(b));

describe("Property 5: Signature scope ignores sig and relay and tracks meta and body", () => {
  it("(a) returns a new object with exactly v, meta, body; shares references; no mutation", () => {
    pbt(
      fc.property(envelopeArb, (envelope) => {
        const before = clone(envelope);
        const scope = scopeOf(envelope);
        expect(scope).not.toBe(envelope);
        expect(Object.keys(scope).sort()).toEqual(["body", "meta", "v"]);
        expect(scope.v).toBe(1);
        expect(scope.meta).toBe(envelope.meta);
        expect(scope.body).toBe(envelope.body);
        expect(eq(envelope, before)).toBe(true);
      }),
      { numRuns: PBT_MIN_RUNS },
    );
  });

  it("(b) adding, removing or changing relay or sig leaves the scope deeply equal", () => {
    const edit = fc.record({
      field: fc.constantFrom("relay", "sig"),
      mode: fc.constantFrom("remove", "replace", "subfield", "subfield-remove"),
      key: fc.string({ minLength: 1, maxLength: 8 }).filter((k) => k !== "__proto__"),
      value: jsonArb,
    });
    pbt(
      fc.property(envelopeArb, edit, (envelope, { field, mode, key, value }) => {
        const original = scopeOf(envelope);
        const originalSnapshot = clone(original);
        const mutated = clone(envelope) as unknown as Json;
        const current = mutated[field];
        if (mode === "remove") delete mutated[field];
        else if (mode === "replace") mutated[field] = value;
        else {
          const base =
            typeof current === "object" && current !== null && !Array.isArray(current)
              ? (current as Json)
              : {};
          if (mode === "subfield") mutated[field] = { ...base, [key]: value };
          else {
            const { [key]: _dropped, ...rest } = base;
            const firstKey = Object.keys(base)[0];
            if (firstKey !== undefined && !(key in base)) delete rest[firstKey];
            mutated[field] = rest;
          }
        }
        const after = scopeOf(mutated as unknown as typeof envelope);
        expect(eq(after, originalSnapshot)).toBe(true);
        expect(eq(after, original)).toBe(true);
      }),
      { numRuns: PBT_MIN_RUNS },
    );
  });

  it("(c) changing any leaf inside meta or body changes the scope", () => {
    pbt(
      fc.property(
        envelopeArb,
        fc.constantFrom("meta", "body"),
        fc.nat(),
        (envelope, section, pick) => {
          const paths = leafPaths((envelope as unknown as Json)[section]);
          fc.pre(paths.length > 0 && paths.every((p) => p.length > 0));
          const path = paths[pick % paths.length] as Path;
          const mutated = clone(envelope) as unknown as Json;
          const leaf = getAt(mutated[section], path);
          setAt(mutated[section] as Json, path, changed(leaf));
          const before = scopeOf(envelope);
          const after = scopeOf(mutated as unknown as typeof envelope);
          expect(eq(before, after)).toBe(false);
        },
      ),
      { numRuns: PBT_MIN_RUNS },
    );
  });

  it("(d) parseRaw: signed equals the scope of the RAW JSON value, never the stripped envelope", () => {
    const extrasArb = fc.dictionary(
      fc.string({ minLength: 1, maxLength: 6 }).map((s) => `extra_${s}`),
      jsonArb,
      { minKeys: 1, maxKeys: 3 },
    );
    pbt(
      fc.property(
        typeArb.chain((type) => validRawEnvelopeArb(type)),
        extrasArb,
        fc.boolean(),
        (rawValue, extras, withExtras) => {
          const value = clone(rawValue);
          if (withExtras) value.body = { ...(value.body as Json), ...extras };
          const text = JSON.stringify(value);
          const result = parseRaw(text);
          expect(result.ok).toBe(true);
          if (!result.ok) return;
          const rawParsed = JSON.parse(text) as { v: 1; meta: unknown; body: unknown };
          expect(eq(result.signed, signatureScope(rawParsed))).toBe(true);
          expect(Object.keys(result.signed).sort()).toEqual(["body", "meta", "v"]);
          if (withExtras) {
            const signedBody = result.signed.body as Json;
            for (const key of Object.keys(extras)) {
              expect(key in signedBody).toBe(true);
              // Typed parse strips unknown body fields; `signed` is not the stripped envelope.
              expect(key in (result.envelope.body as Json)).toBe(false);
            }
            expect(eq(result.signed, scopeOf(result.envelope))).toBe(false);
          }
        },
      ),
      { numRuns: PBT_MIN_RUNS },
    );
  });
});
