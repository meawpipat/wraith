// Feature: s-crypto, Property 10: Fields outside the signature scope have no effect
// **Validates: Requirements 7.2, 7.3, 8.3, 8.8, 9.4, 13.8**
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { requestHash } from "../src/request-hash.js";
import { scopeBytes } from "../src/scope-bytes.js";
import { sign, verify } from "../src/sign.js";
import { pbt } from "./config.js";
import {
  MESSAGE_TYPES,
  type Rec,
  recordTopLevelReads,
  signCase,
  signedEnvelopeArb,
} from "./support/envelopes.js";

const SCOPE_MEMBERS = ["body", "meta", "v"];

/** A replacement for `relay`, or undefined to remove it. */
const relayArb = fc.oneof(
  fc.constant(undefined),
  fc.record({ at: fc.nat(), hop: fc.string(), extra: fc.array(fc.string(), { maxLength: 3 }) }),
  fc.string(),
  fc.constant(null),
);

/** A valid-looking or invalid member id. */
const byArb = fc.oneof(fc.string(), fc.constant(""), fc.stringMatching(/^member-[a-z0-9]{1,8}$/));

function scopeOf(e: Rec): { v: unknown; meta: unknown; body: unknown } {
  return { v: e.v, meta: e.meta, body: e.body };
}

describe("Property 10: fields outside the signature scope have no effect", () => {
  it("covers a non-empty registry", () => {
    expect(MESSAGE_TYPES.length).toBeGreaterThan(0);
  });

  it("relay and sig.by change neither scopeBytes, requestHash nor verify", async () => {
    await pbt(
      fc.asyncProperty(signedEnvelopeArb(), relayArb, byArb, async (unsigned, relay, by) => {
        const s = await signCase(unsigned);
        const base = { ...s.envelope, v: 1 } as Rec;
        const variant: Rec = { ...base };
        if (relay === undefined) delete variant.relay;
        else variant.relay = relay;
        const sig = s.envelope.sig as Rec;
        const otherSig = { ...sig, by };

        const jwk = s.key.publicJwk;
        expect(scopeBytes(variant as never)).toEqual(scopeBytes(base as never));
        expect(await requestHash(variant as never)).toBe(await requestHash(base as never));
        expect(await verify(base, sig, jwk)).toBe(true);
        expect(await verify(variant, sig, jwk)).toBe(true);
        expect(await verify(variant, otherSig, jwk)).toBe(true);
      }),
    );
  });

  it("sign, verify, requestHash and scopeBytes read only v, meta and body", async () => {
    await pbt(
      fc.asyncProperty(signedEnvelopeArb(), relayArb, async (unsigned, relay) => {
        const s = await signCase(unsigned);
        const env: Rec = { ...s.envelope, v: 1 };
        if (relay !== undefined) env.relay = relay;
        const jwk = s.key.publicJwk;

        const wrap = () => recordTopLevelReads(env);

        const a = wrap();
        await sign(s.key.pair.privateKey, "member-x", a.proxy as never);
        const b = wrap();
        expect(await verify(b.proxy, env.sig, jwk)).toBe(true);
        const c = wrap();
        await requestHash(c.proxy as never);
        const d = wrap();
        scopeBytes(d.proxy as never);

        for (const r of [a, b, c, d]) {
          const names = r.reads();
          for (const n of names) expect(SCOPE_MEMBERS).toContain(n);
          expect(names).toContain("meta");
          expect(names).toContain("body");
        }
        // The signed scope itself is what the bytes depend on.
        expect(scopeBytes(scopeOf(env) as never)).toEqual(scopeBytes(env as never));
      }),
    );
  });
});
