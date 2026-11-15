import { parseRaw } from "@wraith/protocol";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { decodeBase64Url } from "../src/base64url.js";
import { exportPublicJwk, generateKeyPair, importPublicKey } from "../src/keys.js";
import { sign, verify } from "../src/sign.js";
import { pbt } from "./config.js";
import {
  cloneJson,
  MESSAGE_TYPES,
  type Rec,
  signedEnvelopeArb,
  type UnsignedCase,
  validEnvelopeArb,
  validRawEnvelopeArb,
} from "./support/envelopes.js";

// Feature: s-crypto, Property 6: Sign then verify holds for every message type
// **Validates: Requirements 7.1, 7.4, 7.8, 7.9, 7.10, 8.1, 8.2, 13.4**

const MEMBER_ID = "member-fresh";
const memberIdArb = fc.string({ minLength: 1, maxLength: 24 });

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze((value as Rec)[key]);
  }
  return value;
}

const rawOrTypedArb: fc.Arbitrary<UnsignedCase> = fc
  .boolean()
  .chain((raw) => signedEnvelopeArb(undefined, raw));

async function signAndCheck(envelope: Rec, memberId: string) {
  const pair = await generateKeyPair();
  const publicJwk = await exportPublicJwk(pair.publicKey);
  const before = cloneJson(envelope);
  const sig = await sign(pair.privateKey, memberId, envelope as never);
  expect(envelope).toEqual(before);
  return { pair, publicJwk, sig, before };
}

describe("Property 6: sign then verify holds for every message type", () => {
  it("covers every entry of MESSAGE_TYPES", () => {
    expect(MESSAGE_TYPES.length).toBeGreaterThan(0);
    const generated = new Set(fc.sample(signedEnvelopeArb(), 2000).map((c) => c.type));
    for (const type of MESSAGE_TYPES) expect(generated.has(type)).toBe(true);
  });

  it("sign returns {by, alg, value} with a 64-byte unpadded base64url value", {
    timeout: 120_000,
  }, async () => {
    await pbt(
      fc.asyncProperty(rawOrTypedArb, memberIdArb, async (c, memberId) => {
        const { sig } = await signAndCheck(c.envelope, memberId);
        expect(Object.keys(sig).sort()).toEqual(["alg", "by", "value"]);
        expect(sig.by).toBe(memberId);
        expect(sig.alg).toBe("ES256");
        expect(sig.value).toMatch(/^[A-Za-z0-9_-]{86}$/);
        const decoded = decodeBase64Url(sig.value);
        expect(decoded.ok && decoded.value.length === 64).toBe(true);
      }),
    );
  });

  for (const type of MESSAGE_TYPES) {
    it(`${type}: verifies with a fresh key as Public_JWK and as a key handle`, {
      timeout: 120_000,
    }, async () => {
      await pbt(
        fc.asyncProperty(signedEnvelopeArb(type), async (c) => {
          const { pair, publicJwk, sig } = await signAndCheck(c.envelope, MEMBER_ID);
          expect(await verify(c.envelope, sig, publicJwk)).toBe(true);
          expect(await verify(c.envelope, sig, pair.publicKey)).toBe(true);
          const imported = await importPublicKey(publicJwk);
          if (!imported.ok) throw new Error("import failed");
          expect(await verify(c.envelope, sig, imported.value)).toBe(true);
        }),
      );
    });
  }

  it("typed and raw envelopes of any type verify", { timeout: 120_000 }, async () => {
    const anyArb = fc
      .constantFrom(...MESSAGE_TYPES)
      .chain((t) => fc.oneof(validEnvelopeArb(t), validRawEnvelopeArb(t)));
    await pbt(
      fc.asyncProperty(anyArb, async (envelope) => {
        const { publicJwk, sig } = await signAndCheck(envelope as unknown as Rec, MEMBER_ID);
        expect(await verify(envelope, sig, publicJwk)).toBe(true);
      }),
    );
  });

  it("does not mutate the input, and a deeply frozen input works", {
    timeout: 120_000,
  }, async () => {
    await pbt(
      fc.asyncProperty(rawOrTypedArb, async (c) => {
        const frozen = deepFreeze(cloneJson(c.envelope) as Rec);
        const { publicJwk, sig, before } = await signAndCheck(frozen, MEMBER_ID);
        expect(frozen).toEqual(before);
        expect(await verify(frozen, sig, publicJwk)).toBe(true);
      }),
    );
  });

  it("verifies the Signed_Member of parseRaw for the JSON text of the envelope", {
    timeout: 120_000,
  }, async () => {
    await pbt(
      fc.asyncProperty(rawOrTypedArb, async (c) => {
        const pair = await generateKeyPair();
        const publicJwk = await exportPublicJwk(pair.publicKey);
        const sig = await sign(pair.privateKey, MEMBER_ID, c.envelope as never);
        // Unsigned-by-protocol envelopes (bot.tool interim) carry no `sig` member on the wire.
        const wire = "sig" in c.envelope ? { ...c.envelope, sig } : c.envelope;
        const parsed = parseRaw(JSON.stringify(wire));
        if (!parsed.ok) throw new Error(`parseRaw failed: ${parsed.code}`);
        expect(await verify(parsed.signed, sig, publicJwk)).toBe(true);
      }),
    );
  });

  it("verifies parsed.signed but not parsed.envelope when the body has an unknown field", {
    timeout: 120_000,
  }, async () => {
    let stripped = 0;
    await pbt(
      fc.asyncProperty(signedEnvelopeArb(undefined, true), async (c) => {
        const body = c.envelope.body;
        if (typeof body !== "object" || body === null || Array.isArray(body)) return;
        const extended: Rec = {
          ...c.envelope,
          body: { ...(body as Rec), zzUnknownExtra: { n: 1 } },
        };
        const pair = await generateKeyPair();
        const publicJwk = await exportPublicJwk(pair.publicKey);
        const sig = await sign(pair.privateKey, MEMBER_ID, extended as never);
        const wire = "sig" in extended ? { ...extended, sig } : extended;
        const parsed = parseRaw(JSON.stringify(wire));
        if (!parsed.ok) return;
        expect(await verify(parsed.signed, sig, publicJwk)).toBe(true);
        const keptExtra =
          typeof parsed.envelope.body === "object" &&
          parsed.envelope.body !== null &&
          "zzUnknownExtra" in parsed.envelope.body;
        if (!keptExtra) {
          stripped++;
          expect(await verify(parsed.envelope, sig, publicJwk)).toBe(false);
        }
      }),
    );
    expect(stripped).toBeGreaterThan(0);
  });
});
