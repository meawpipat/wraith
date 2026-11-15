// Feature: s-crypto, Property 14: requestHash binds the signed bytes
// **Validates: Requirements 9.1, 9.2, 9.3, 9.5, 9.6, 9.8, 13.11**
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { encodeBase64Url } from "../src/base64url.js";
import { requestHash, requestHashEquals } from "../src/request-hash.js";
import { pbt } from "./config.js";
import {
  MESSAGE_TYPES,
  mutationArb,
  signCase,
  signedEnvelopeArb,
  withMutation,
} from "./support/envelopes.js";
import { referenceCanonicalize } from "./support/jcs-reference.js";

/** Independent oracle: SHA-256 over the reference canonicalization of {v, meta, body}. */
async function oracleHash(v: unknown, meta: unknown, body: unknown): Promise<string> {
  const text = referenceCanonicalize({ v, meta, body });
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return encodeBase64Url(new Uint8Array(digest));
}

const digestArb = fc.uint8Array({ minLength: 32, maxLength: 32 }).map(encodeBase64Url);

describe("Property 14: requestHash binds the signed bytes", () => {
  it("covers a non-empty registry", () => {
    expect(MESSAGE_TYPES.length).toBeGreaterThan(0);
  });

  for (const type of MESSAGE_TYPES) {
    describe(type, () => {
      it("equals the digest of the signed bytes, for envelope and Signed_Member alike", async () => {
        await pbt(
          fc.asyncProperty(signedEnvelopeArb(type), async (c) => {
            const s = await signCase(c);
            const { meta, body } = s.envelope;
            const typed = await requestHash(s.envelope as never);
            const member = await requestHash({ v: 1 as const, meta, body });
            expect(typed).toMatch(/^[A-Za-z0-9_-]{43}$/);
            expect(member).toBe(typed);
            expect(typed).toBe(await oracleHash(1, meta, body));
          }),
        );
      });

      it("ignores sig and relay", async () => {
        await pbt(
          fc.asyncProperty(signedEnvelopeArb(type), async (c) => {
            const s = await signCase(c);
            const stripped = { v: 1 as const, meta: s.envelope.meta, body: s.envelope.body };
            const decorated = { ...s.envelope, relay: { extra: 1 }, sig: { by: "other" } };
            expect(await requestHash(decorated as never)).toBe(await requestHash(stripped));
          }),
        );
      });

      it("changes under any single mutation that changes the canonical bytes", async () => {
        await pbt(
          fc.asyncProperty(
            signedEnvelopeArb(type).chain((c) => mutationArb(c.envelope).map((m) => ({ c, m }))),
            async ({ c, m }) => {
              const s = await signCase(c);
              const mutated = withMutation(s.envelope, m);
              expect(await requestHash(mutated as never)).not.toBe(
                await requestHash(s.envelope as never),
              );
            },
          ),
        );
      });
    });
  }

  describe("requestHashEquals", () => {
    it("is true exactly when two valid digests are equal", async () => {
      await pbt(
        fc.asyncProperty(digestArb, digestArb, async (a, b) => {
          expect(requestHashEquals(a, a)).toBe(true);
          expect(requestHashEquals(a, b)).toBe(a === b);
        }),
      );
    });

    it("is true for hashes of equal envelopes and false for different ones", async () => {
      await pbt(
        fc.asyncProperty(signedEnvelopeArb(), signedEnvelopeArb(), async (x, y) => {
          const a = await requestHash(x.envelope as never);
          const b = await requestHash(y.envelope as never);
          expect(requestHashEquals(a, b)).toBe(a === b);
        }),
      );
    });

    it("is false when either side is malformed", async () => {
      const malformed = fc.oneof(
        fc.string({ maxLength: 60 }).filter((s) => !/^[A-Za-z0-9_-]{43}$/.test(s)),
        digestArb.map((d) => `${d}=`),
        digestArb.map((d) => d.slice(0, 42)),
        digestArb.map((d) => `${d}A`),
        digestArb.map((d) => d.replace(/^./, "+")),
        fc.anything().filter((v) => typeof v !== "string"),
        fc.constantFrom<unknown>(undefined, null, 0, 1, {}, [], new Uint8Array(32)),
      );
      await pbt(
        fc.asyncProperty(digestArb, malformed, async (good, bad) => {
          expect(requestHashEquals(good, bad)).toBe(false);
          expect(requestHashEquals(bad, good)).toBe(false);
          expect(requestHashEquals(bad, bad)).toBe(false);
        }),
      );
    });

    it("is false for a non-canonical encoding of the same digest", async () => {
      const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
      await pbt(
        fc.asyncProperty(digestArb, fc.integer({ min: 1, max: 15 }), async (d, delta) => {
          const last = alphabet.indexOf(d.charAt(42));
          const variant = d.slice(0, 42) + alphabet.charAt((last + delta) % 64);
          // Same top two bits of the final character, different trailing bits.
          expect(variant).not.toBe(d);
          expect(requestHashEquals(d, variant)).toBe(false);
        }),
      );
    });
  });
});
