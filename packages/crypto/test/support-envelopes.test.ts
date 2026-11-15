// Sanity checks of the signed-envelope support (task 5.6).
import { describe, expect, it } from "vitest";
import { verify } from "../src/sign.js";
import {
  bitFlip,
  MESSAGE_TYPES,
  mutationArb,
  recordTopLevelReads,
  sampleMany,
  sampleOne,
  signCase,
  signedEnvelopeArb,
  signedEnvelopesForAllTypes,
  withMutation,
} from "./support/envelopes.js";
import { referenceCanonicalize } from "./support/jcs-reference.js";

const MUTATIONS_PER_TYPE = 40;

describe("envelope support", () => {
  it("signs every message type with a signature verify accepts", async () => {
    const all = await signedEnvelopesForAllTypes();
    expect(all.map((c) => c.type)).toEqual([...MESSAGE_TYPES]);
    for (const c of all) {
      expect(await verify(c.envelope, c.envelope.sig, c.key.publicJwk)).toBe(true);
    }
  });

  it("signs raw envelopes and rejects them after a mutation", async () => {
    const c = await signCase(sampleOne(signedEnvelopeArb(undefined, true), 7));
    expect(await verify(c.envelope, c.envelope.sig, c.key.publicJwk)).toBe(true);
    const mutated = withMutation(c.envelope, sampleOne(mutationArb(c.envelope), 3));
    expect(await verify(mutated, c.envelope.sig, c.key.publicJwk)).toBe(false);
  });

  it("mutations always change the canonical bytes", async () => {
    for (const c of await signedEnvelopesForAllTypes(2)) {
      for (const m of sampleMany(mutationArb(c.envelope), MUTATIONS_PER_TYPE, 11)) {
        expect(referenceCanonicalize(m.mutated)).not.toBe(referenceCanonicalize(m.original));
      }
    }
  });

  it("verify reads only v, meta and body", async () => {
    const [c] = await signedEnvelopesForAllTypes();
    const { proxy, reads } = recordTopLevelReads(c?.envelope ?? {});
    expect(await verify(proxy, c?.envelope.sig, c?.key.publicJwk)).toBe(true);
    expect(reads().sort()).toEqual(["body", "meta", "v"]);
  });

  it("bitFlip flips exactly one bit and wraps", () => {
    const b = new Uint8Array([0, 0]);
    expect(Array.from(bitFlip(b, 9))).toEqual([0, 2]);
    expect(Array.from(bitFlip(b, 16))).toEqual([1, 0]);
    expect(Array.from(b)).toEqual([0, 0]);
  });
});
