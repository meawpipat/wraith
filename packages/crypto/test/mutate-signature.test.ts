// Feature: s-crypto, Property 9: Mutating the signature is rejected
// **Validates: Requirements 8.5, 13.7**
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { decodeBase64Url, encodeBase64Url } from "../src/base64url.js";
import { verify } from "../src/sign.js";
import { pbt } from "./config.js";
import {
  bitFlip,
  bitIndexArb,
  MESSAGE_TYPES,
  signCase,
  signedEnvelopeArb,
} from "./support/envelopes.js";

const SIG_BYTES = 64;

type Replacer = (original: string) => string;

/** Replacement rules: padded, shortened, lengthened, non-alphabet and arbitrary strings. */
const replacerArb: fc.Arbitrary<Replacer> = fc.oneof(
  fc.constant<Replacer>((o) => `${o}=`),
  fc.constant<Replacer>((o) => `${o}==`),
  fc.constant<Replacer>((o) => `${o}A`),
  fc.constant<Replacer>((o) => `${o}\n`),
  fc.constant<Replacer>(() => ""),
  fc.nat().map<Replacer>((n) => (o) => o.slice(0, n % o.length)),
  fc.nat().map<Replacer>((n) => (o) => `${o}${o.slice(0, 1 + (n % o.length))}`),
  fc
    .tuple(fc.nat(), fc.constantFrom("+", "/", " ", "\n", "=", ".", "\u00e9", "\u0000"))
    .map<Replacer>(([n, ch]) => (o) => {
      const i = n % o.length;
      return `${o.slice(0, i)}${ch}${o.slice(i + 1)}`;
    }),
  fc.string({ unit: "binary" }).map<Replacer>((str) => () => str),
  fc.base64String().map<Replacer>((str) => () => str),
  fc.uint8Array({ minLength: 0, maxLength: 100 }).map<Replacer>((b) => () => encodeBase64Url(b)),
);

describe("Property 9: mutating the signature is rejected", () => {
  it("covers a non-empty registry", () => {
    expect(MESSAGE_TYPES.length).toBeGreaterThan(0);
  });

  for (const type of MESSAGE_TYPES) {
    describe(type, () => {
      it("rejects every single-bit change of the 64 signature bytes", {
        timeout: 120_000,
      }, async () => {
        await pbt(
          fc.asyncProperty(signedEnvelopeArb(type), bitIndexArb(SIG_BYTES), async (c, bit) => {
            const s = await signCase(c);
            const jwk = s.key.publicJwk;
            const sig = s.envelope.sig as Record<string, unknown>;
            expect(await verify(s.envelope, sig, jwk)).toBe(true);
            const decoded = decodeBase64Url(sig.value);
            if (!decoded.ok) throw new Error("test setup: signature does not decode");
            expect(decoded.value.length).toBe(SIG_BYTES);
            const flipped = { ...sig, value: encodeBase64Url(bitFlip(decoded.value, bit)) };
            expect(await verify(s.envelope, flipped, jwk)).toBe(false);
          }),
        );
      });

      it("rejects every replacement of sig.value by a different string", {
        timeout: 120_000,
      }, async () => {
        await pbt(
          fc.asyncProperty(signedEnvelopeArb(type), replacerArb, async (c, replace) => {
            const s = await signCase(c);
            const sig = s.envelope.sig as Record<string, unknown>;
            const original = sig.value as string;
            const replacement = replace(original);
            fc.pre(replacement !== original);
            expect(await verify(s.envelope, { ...sig, value: replacement }, s.key.publicJwk)).toBe(
              false,
            );
          }),
        );
      });
    });
  }
});
