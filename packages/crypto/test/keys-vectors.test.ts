// Key known-answer and curve-constant tests. Portable: runs in node and workers.
// **Validates: Requirements 5.12, 5.13, 5.7**
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
import { bytesToBigInt, isOnCurve } from "../src/p256.js";
import { getKeyVectors } from "./support/vectors.js";

// Generator point G of secp256r1, read from SEC 2 v1 (https://www.secg.org/SEC2-Ver-1.0.pdf)
// via https://std.neuromancer.sk/secg/secp256r1.
const GX = 0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296n;
const GY = 0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5n;

const keys = getKeyVectors();

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function coords(jwk: { x: string; y: string }): { x: bigint; y: bigint } {
  const x = decodeBase64Url(jwk.x);
  const y = decodeBase64Url(jwk.y);
  if (!x.ok || !y.ok) throw new Error("test setup: bad coordinate");
  return { x: bytesToBigInt(x.value), y: bytesToBigInt(y.value) };
}

describe("key vectors: valid", () => {
  for (const v of keys.valid) {
    it(`${v.id}: compressed, decompressed and fingerprint forms`, async () => {
      const c = publicKeyToCompressed(v.jwk);
      expect(c.ok && toHex(c.value)).toBe(v.compressedHex);

      const back = publicKeyFromCompressed(fromHex(v.compressedHex));
      expect(back.ok).toBe(true);
      if (back.ok) {
        expect(back.value.x).toBe(v.jwk.x);
        expect(back.value.y).toBe(v.jwk.y);
      }

      const fp = await keyFingerprint(v.jwk);
      expect(fp.ok && toHex(fp.value)).toBe(v.fingerprintHex);

      expect((await importPublicKey(v.jwk)).ok).toBe(true);
    });
  }
});

describe("key vectors: ignored members", () => {
  for (const v of keys.validIgnoredMembers) {
    it(`${v.id}: use, key_ops, ext and alg are ignored`, async () => {
      expect((await importPublicKey(v.jwk)).ok).toBe(true);
      const fp = await keyFingerprint(v.jwk);
      expect(fp.ok && toHex(fp.value)).toBe(v.fingerprintHex);
      const plain = await keyFingerprint({
        kty: v.jwk.kty,
        crv: v.jwk.crv,
        x: v.jwk.x,
        y: v.jwk.y,
      });
      expect(plain.ok && fp.ok && toHex(plain.value)).toBe(fp.ok && toHex(fp.value));
    });
  }
});

describe("key vectors: rejected inputs", () => {
  for (const v of keys.invalidCompressed) {
    it(`${v.id}: compressed form is rejected`, () => {
      const r = publicKeyFromCompressed(fromHex(v.compressedHex));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("E_SCHEMA_INVALID");
    });
  }

  for (const v of keys.invalidJwk) {
    it(`${v.id}: JWK is rejected`, async () => {
      const input = v.withD ? { ...v.jwk, d: "AQ" } : v.jwk;
      const r = await importPublicKey(input);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("E_SCHEMA_INVALID");
    });
  }
});

describe("curve constants", () => {
  it("the SEC 2 generator point is on the curve", () => {
    expect(isOnCurve(GX, GY)).toBe(true);
  });

  it("every vector public key is on the curve", () => {
    for (const v of [...keys.valid, ...keys.validIgnoredMembers]) {
      const { x, y } = coords(v.jwk);
      expect(isOnCurve(x, y)).toBe(true);
    }
  });

  it("20 freshly generated public keys are on the curve", async () => {
    for (let i = 0; i < 20; i++) {
      const pair = await generateKeyPair();
      const { x, y } = coords(await exportPublicJwk(pair.publicKey));
      expect(isOnCurve(x, y)).toBe(true);
    }
  });

  it("a one-bit flip of y is off the curve", () => {
    expect(isOnCurve(GX, GY ^ 1n)).toBe(false);
    for (const v of keys.valid) {
      const { x, y } = coords(v.jwk);
      expect(isOnCurve(x, y ^ 1n)).toBe(false);
    }
  });

  it("decompress then compress reproduces the vector", () => {
    for (const v of keys.valid) {
      const jwk = publicKeyFromCompressed(fromHex(v.compressedHex));
      expect(jwk.ok).toBe(true);
      if (!jwk.ok) continue;
      const again = publicKeyToCompressed(jwk.value);
      expect(again.ok && toHex(again.value)).toBe(v.compressedHex);
    }
  });
});
