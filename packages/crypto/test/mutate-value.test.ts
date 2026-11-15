// Feature: s-crypto, Property 7: Mutating any value of meta or body is rejected
// **Validates: Requirements 8.4, 13.5**
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { verify } from "../src/sign.js";
import { pbt } from "./config.js";
import {
  MESSAGE_TYPES,
  mutationArb,
  type Rec,
  signCase,
  signedEnvelopeArb,
  withMutation,
} from "./support/envelopes.js";

function isObj(v: unknown): v is Rec {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** JSON text with members in reverse order and every integer spelled `n.0`. */
function respell(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(respell).join(",")}]`;
  if (isObj(value)) {
    const members = Object.keys(value)
      .reverse()
      .map(
        (k) => `${JSON.stringify(k)}:${respell(Object.getOwnPropertyDescriptor(value, k)?.value)}`,
      );
    return `{${members.join(",")}}`;
  }
  if (typeof value === "number" && /^-?\d+$/.test(String(value))) return `${value}.0`;
  return JSON.stringify(value);
}

describe("Property 7: mutating any value of meta or body is rejected", () => {
  it("covers a non-empty registry", () => {
    expect(MESSAGE_TYPES.length).toBeGreaterThan(0);
  });

  for (const type of MESSAGE_TYPES) {
    describe(type, () => {
      it("rejects every single-value mutation and accepts the unmutated envelope", async () => {
        await pbt(
          fc.asyncProperty(
            signedEnvelopeArb(type).chain((c) => mutationArb(c.envelope).map((m) => ({ c, m }))),
            async ({ c, m }) => {
              const s = await signCase(c);
              const jwk = s.key.publicJwk;
              const sig = s.envelope.sig;
              expect(await verify(s.envelope, sig, jwk)).toBe(true);
              expect(await verify(withMutation(s.envelope, m), sig, jwk)).toBe(false);
            },
          ),
        );
      });

      it("accepts spellings that leave the canonical bytes identical", async () => {
        await pbt(
          fc.asyncProperty(signedEnvelopeArb(type), async (c) => {
            const s = await signCase(c);
            const respelled = JSON.parse(
              `{"meta":${respell(s.envelope.meta)},"body":${respell(s.envelope.body)}}`,
            ) as Rec;
            const same = { ...s.envelope, meta: respelled.meta, body: respelled.body };
            expect(await verify(same, s.envelope.sig, s.key.publicJwk)).toBe(true);
          }),
        );
      });
    });
  }
});
