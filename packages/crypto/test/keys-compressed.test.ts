import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { decodeBase64Url } from "../src/base64url.js";
import {
  exportPublicJwk,
  generateKeyPair,
  importPublicKey,
  keyFingerprint,
  publicKeyFromCompressed,
  publicKeyToCompressed,
} from "../src/keys.js";
import { bytesToBigInt, decompress } from "../src/p256.js";
import { getSubtle } from "../src/webcrypto.js";
import { pbt } from "./config.js";
import { IGNORABLE_MEMBERS } from "./support/keys.js";

// Feature: s-crypto, Property 17: Compressed point conversions and fingerprint
// **Validates: Requirements 5.12, 5.13**
const P = (1n << 256n) - (1n << 224n) + (1n << 192n) + (1n << 96n) - 1n;
async function freshJwk() {
  const pair = await generateKeyPair();
  return exportPublicJwk(pair.publicKey);
}
function bytesOf(b64: string): Uint8Array {
  const d = decodeBase64Url(b64);
  if (!d.ok) throw new Error("bad base64url");
  return d.value;
}
function expectSchemaInvalid(input: unknown): void {
  const r = publicKeyFromCompressed(input);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.code).toBe("E_SCHEMA_INVALID");
}
function withPrefix(prefix: number, x: Uint8Array): Uint8Array {
  const out = new Uint8Array(33);
  out[0] = prefix;
  out.set(x, 1);
  return out;
}
const xArb = fc.uint8Array({ minLength: 32, maxLength: 32 });
const unit = fc.constant(null);
describe("Property 17: compressed point conversions and fingerprint", () => {
  it("compressed form has 33 bytes, prefix is parity of y, and it round trips", async () => {
    await pbt(
      fc.asyncProperty(unit, async () => {
        const jwk = await freshJwk();
        const r = publicKeyToCompressed(jwk);
        if (!r.ok) throw new Error("compress failed");
        expect(r.value.length).toBe(33);
        const y = bytesOf(jwk.y);
        expect(r.value[0]).toBe((y[31] as number) % 2 === 0 ? 2 : 3);
        expect(Array.from(r.value.slice(1))).toEqual(Array.from(bytesOf(jwk.x)));
        const back = publicKeyFromCompressed(r.value);
        expect(back).toEqual({ ok: true, value: jwk });
      }),
    );
  });
  it("ignorable members do not change the compressed bytes or fingerprint", async () => {
    await pbt(
      fc.asyncProperty(fc.subarray([...IGNORABLE_MEMBERS], { minLength: 1 }), async (extras) => {
        const jwk = await freshJwk();
        const spelled: Record<string, unknown> = { ...jwk };
        for (const e of extras) spelled[e.name] = e.value;
        const a = publicKeyToCompressed(jwk);
        const b = publicKeyToCompressed(spelled);
        if (!a.ok || !b.ok) throw new Error("compress failed");
        expect(Array.from(b.value)).toEqual(Array.from(a.value));
        const fa = await keyFingerprint(jwk);
        const fb = await keyFingerprint(spelled);
        if (!fa.ok || !fb.ok) throw new Error("fingerprint failed");
        expect(Array.from(fb.value)).toEqual(Array.from(fa.value));
      }),
    );
  });
  it("fingerprint is the SHA-256 of the compressed bytes, 32 bytes, deterministic", async () => {
    await pbt(
      fc.asyncProperty(unit, async () => {
        const jwk = await freshJwk();
        const c = publicKeyToCompressed(jwk);
        if (!c.ok) throw new Error("compress failed");
        const expected = new Uint8Array(await getSubtle().digest("SHA-256", c.value));
        const f1 = await keyFingerprint(jwk);
        const f2 = await keyFingerprint(jwk);
        if (!f1.ok || !f2.ok) throw new Error("fingerprint failed");
        expect(f1.value.length).toBe(32);
        expect(Array.from(f1.value)).toEqual(Array.from(expected));
        expect(Array.from(f2.value)).toEqual(Array.from(f1.value));
      }),
    );
  });
  it("different keys give different fingerprints", async () => {
    await pbt(
      fc.asyncProperty(unit, async () => {
        const a = await keyFingerprint(await freshJwk());
        const b = await keyFingerprint(await freshJwk());
        if (!a.ok || !b.ok) throw new Error("fingerprint failed");
        expect(Array.from(a.value)).not.toEqual(Array.from(b.value));
      }),
    );
  });
  it("flipping the prefix yields the negated point, distinct from the original", async () => {
    await pbt(
      fc.asyncProperty(unit, async () => {
        const jwk = await freshJwk();
        const c = publicKeyToCompressed(jwk);
        if (!c.ok) throw new Error("compress failed");
        const flipped = c.value.slice();
        flipped[0] = c.value[0] === 2 ? 3 : 2;
        const r = publicKeyFromCompressed(flipped);
        if (!r.ok) throw new Error("flipped prefix must stay on the curve");
        expect(r.value.x).toBe(jwk.x);
        expect(r.value.y).not.toBe(jwk.y);
        expect(bytesToBigInt(bytesOf(r.value.y))).toBe(P - bytesToBigInt(bytesOf(jwk.y)));
        expect((await importPublicKey(r.value)).ok).toBe(true);
      }),
    );
  });
  it("rejects every length other than 33", () => {
    pbt(
      fc.property(
        fc.uint8Array({ minLength: 0, maxLength: 80 }).filter((b) => b.length !== 33),
        (bytes) => {
          expectSchemaInvalid(bytes);
        },
      ),
    );
  });
  it("rejects every prefix other than 2 and 3", () => {
    pbt(
      fc.property(
        fc.integer({ min: 0, max: 255 }).filter((p) => p !== 2 && p !== 3),
        xArb,
        (prefix, x) => {
          expectSchemaInvalid(withPrefix(prefix, x));
        },
      ),
    );
  });
  it("rejects x values with no curve point", () => {
    pbt(
      fc.property(
        xArb.filter((x) => decompress(2, bytesToBigInt(x)) === null),
        fc.constantFrom(2, 3),
        (x, prefix) => {
          expectSchemaInvalid(withPrefix(prefix, x));
        },
      ),
    );
  });
  it("accepts a decompressed point only when WebCrypto accepts it too", async () => {
    await pbt(
      fc.asyncProperty(xArb, fc.constantFrom(2, 3), async (x, prefix) => {
        const r = publicKeyFromCompressed(withPrefix(prefix, x));
        if (!r.ok) {
          expect(r.code).toBe("E_SCHEMA_INVALID");
          return;
        }
        expect((await importPublicKey(r.value)).ok).toBe(true);
        const again = publicKeyToCompressed(r.value);
        if (!again.ok) throw new Error("compress failed");
        expect(Array.from(again.value)).toEqual(Array.from(withPrefix(prefix, x)));
      }),
    );
  });
  it("rejects x >= p", () => {
    pbt(
      fc.property(
        fc.bigInt({ min: 0n, max: (1n << 256n) - 1n - P }),
        fc.constantFrom(2, 3),
        (k, prefix) => {
          const x = new Uint8Array(32);
          let v = P + k;
          for (let i = 31; i >= 0; i--) {
            x[i] = Number(v & 0xffn);
            v >>= 8n;
          }
          expectSchemaInvalid(withPrefix(prefix, x));
        },
      ),
    );
  });
  it("rejects non-Uint8Array input without throwing", () => {
    pbt(
      fc.property(
        fc.anything().filter((v) => !(v instanceof Uint8Array)),
        (v) => {
          expectSchemaInvalid(v);
        },
      ),
    );
  });
});
