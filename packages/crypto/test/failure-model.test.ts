// Feature: s-crypto, failure-model table (R3.8): hostile inputs make verify, verifyBytes and
// requestHashEquals return exactly `false`, never throw and never reject.
// Portable: no `node:` import.
// NOTE: the HMAC and payload verifiers are added to this table in task 12.1.
import { describe, expect, it } from "vitest";
import { decodeBase64Url } from "../src/base64url.js";
import { requestHash, requestHashEquals } from "../src/request-hash.js";
import { signBytes, verify, verifyBytes } from "../src/sign.js";
import { type SignedCase, signedEnvelopesForAllTypes } from "./support/envelopes.js";
import { type HostileVerifyInput, hostileVerifyInputs } from "./support/hostile.js";

type Rec = Record<string, unknown>;

const REQUIRED_NAMES = [
  "undefined scope",
  "null scope",
  "number scope",
  "string scope",
  "empty object scope",
  "array scope",
  "cyclic object scope",
  "scope with meta missing",
  "scope with a bigint",
  "non-string signature (number)",
  "signature of 63 decoded bytes",
  "signature of 65 decoded bytes",
  "padded signature",
  "public key with d",
  "key on another curve",
  "key with a missing x",
];

async function baseline(): Promise<{
  c: SignedCase;
  sig: Rec;
  bytes: Uint8Array;
  rawSig: Uint8Array;
}> {
  const c = (await signedEnvelopesForAllTypes())[0] as SignedCase;
  const sig = c.envelope.sig as Rec;
  const decoded = decodeBase64Url(sig.value);
  if (!decoded.ok) throw new Error("baseline signature does not decode");
  return { c, sig, bytes: new Uint8Array([1, 2, 3]), rawSig: decoded.value };
}

/** Bytes for a hostile signature: strings decode (when they can), anything else passes through. */
function asSignatureBytes(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const d = decodeBase64Url(value);
  return d.ok ? d.value : value;
}

describe("failure model: hostile inputs (R3.8)", () => {
  it("the table covers every R3.8 input", () => {
    const names = hostileVerifyInputs().map((h) => h.name);
    for (const n of REQUIRED_NAMES) expect(names).toContain(n);
  });

  it("the baseline valid call resolves true (the table is not vacuous)", async () => {
    const { c, sig, rawSig } = await baseline();
    expect(await verify(c.envelope, sig, c.key.publicJwk)).toBe(true);
    expect(await verify(c.envelope, sig, c.key.pair.publicKey)).toBe(true);
    expect(rawSig.length).toBe(64);
    const h = await requestHash(c.envelope as never);
    expect(requestHashEquals(h, h)).toBe(true);
  });

  it("verifyBytes baseline resolves true over a real signature", async () => {
    const { c } = await baseline();
    const bytes = new Uint8Array([9, 8, 7]);
    const s = await signBytes(c.key.pair.privateKey, bytes);
    expect(await verifyBytes(bytes, s, c.key.publicJwk)).toBe(true);
  });

  for (const h of hostileVerifyInputs()) {
    const { name, slot } = h as HostileVerifyInput;
    it(`verify returns false for: ${name}`, async () => {
      const { c, sig } = await baseline();
      const fresh = hostileVerifyInputs().find((x) => x.name === name) as HostileVerifyInput;
      const v = fresh.value;
      const results: boolean[] = [];
      if (slot === "scope") {
        results.push(await verify(v, sig, c.key.publicJwk));
      } else if (slot === "signature") {
        results.push(await verify(c.envelope, v, c.key.publicJwk));
        results.push(await verify(c.envelope, { ...sig, value: v }, c.key.publicJwk));
      } else {
        results.push(await verify(c.envelope, sig, v));
      }
      for (const r of results) expect(r).toBe(false);
    });

    it(`verifyBytes returns false for: ${name}`, async () => {
      const { c, bytes, rawSig } = await baseline();
      const fresh = hostileVerifyInputs().find((x) => x.name === name) as HostileVerifyInput;
      const v = fresh.value;
      const results: boolean[] = [];
      if (slot === "scope") {
        results.push(await verifyBytes(v, rawSig, c.key.publicJwk));
      } else if (slot === "signature") {
        results.push(await verifyBytes(bytes, v, c.key.publicJwk));
        results.push(await verifyBytes(bytes, asSignatureBytes(v), c.key.publicJwk));
      } else {
        results.push(await verifyBytes(bytes, rawSig, v));
      }
      for (const r of results) expect(r).toBe(false);
    });

    it(`requestHashEquals returns false for: ${name}`, async () => {
      const { c } = await baseline();
      const h0 = await requestHash(c.envelope as never);
      const fresh = hostileVerifyInputs().find((x) => x.name === name) as HostileVerifyInput;
      expect(requestHashEquals(fresh.value, h0)).toBe(false);
      expect(requestHashEquals(h0, fresh.value)).toBe(false);
      expect(requestHashEquals(fresh.value, fresh.value)).toBe(false);
    });
  }
});
