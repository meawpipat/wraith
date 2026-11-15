// Feature: s-crypto, Property 11: Wrong key, wrong version and wrong algorithm are rejected
// **Validates: Requirements 8.6, 8.7, 8.9, 13.9**
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { verify } from "../src/sign.js";
import { pbt } from "./config.js";
import {
  ENVELOPE_KEY_POOL_SIZE,
  MESSAGE_TYPES,
  signCase,
  signedEnvelopeArb,
} from "./support/envelopes.js";
import { getKeyPool } from "./support/keys.js";

const wrongVersionArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.integer().filter((n) => n !== 1),
  fc.double({ noNaN: false }),
  fc.constantFrom<unknown>(
    "1",
    "v1",
    "",
    1.0000001,
    0,
    2,
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    null,
    undefined,
    true,
    false,
    1n,
    [1],
    { v: 1 },
    new Number(1),
  ),
  fc.string(),
);
const wrongAlgArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.constantFrom<unknown>(
    "es256",
    "ES256 ",
    " ES256",
    "ES384",
    "ES512",
    "RS256",
    "HS256",
    "none",
    "",
    null,
    undefined,
    256,
    true,
    ["ES256"],
    { alg: "ES256" },
    new String("ES256"),
  ),
  fc.string().filter((s) => s !== "ES256"),
);

describe("Property 11: wrong key, wrong version and wrong algorithm are rejected", () => {
  it("covers a non-empty registry", () => {
    expect(MESSAGE_TYPES.length).toBeGreaterThan(0);
  });
  for (const type of MESSAGE_TYPES) {
    describe(type, () => {
      it("rejects verification under a second independent public key", async () => {
        await pbt(
          fc.asyncProperty(signedEnvelopeArb(type), fc.nat(), async (c, n) => {
            const s = await signCase(c);
            const pool = await getKeyPool(ENVELOPE_KEY_POOL_SIZE);
            const others = pool.filter((k) => k !== s.key);
            const other = others[n % others.length];
            if (other === undefined) throw new Error("test setup: no second key");
            expect(await verify(s.envelope, s.envelope.sig, s.key.publicJwk)).toBe(true);
            expect(await verify(s.envelope, s.envelope.sig, other.publicJwk)).toBe(false);
            expect(await verify(s.envelope, s.envelope.sig, other.pair.publicKey)).toBe(false);
          }),
        );
      });
      it("rejects every v other than the number 1", async () => {
        await pbt(
          fc.asyncProperty(signedEnvelopeArb(type), wrongVersionArb, async (c, v) => {
            const s = await signCase(c);
            expect(await verify({ ...s.envelope, v }, s.envelope.sig, s.key.publicJwk)).toBe(false);
          }),
        );
      });
      it("rejects every sig.alg other than the exact string ES256", async () => {
        await pbt(
          fc.asyncProperty(signedEnvelopeArb(type), wrongAlgArb, async (c, alg) => {
            const s = await signCase(c);
            const sig = { ...(s.envelope.sig as Record<string, unknown>), alg };
            expect(await verify(s.envelope, sig, s.key.publicJwk)).toBe(false);
          }),
        );
      });
    });
  }
});
