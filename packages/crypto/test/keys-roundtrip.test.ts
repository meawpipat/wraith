import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  exportPrivateJwk,
  exportPublicJwk,
  generateKeyPair,
  importPrivateKey,
  importPublicKey,
  publicJwkOf,
} from "../src/keys.js";
import { getSubtle } from "../src/webcrypto.js";
import { pbt } from "./config.js";

// Feature: s-crypto, Property 15: Key export and import round trip
// **Validates: Requirements 5.3, 5.4, 5.10, 5.11**

const SIGN = { name: "ECDSA", hash: "SHA-256" } as const;
const messageArb = fc.uint8Array({ minLength: 0, maxLength: 64 });

describe("Property 15: key export and import round trip", () => {
  it("public JWK has exactly kty, crv, x, y and survives import then export", async () => {
    await pbt(
      fc.asyncProperty(fc.constant(null), async () => {
        const pair = await generateKeyPair({ extractablePrivate: true });
        const first = await exportPublicJwk(pair.publicKey);
        expect(Object.keys(first).sort()).toEqual(["crv", "kty", "x", "y"]);
        const imported = await importPublicKey(first);
        if (!imported.ok) throw new Error("public import failed");
        expect(await exportPublicJwk(imported.value)).toEqual(first);
      }),
    );
  });

  it("private JWK has exactly kty, crv, x, y, d; publicJwkOf matches the public export without d", async () => {
    await pbt(
      fc.asyncProperty(fc.constant(null), async () => {
        const pair = await generateKeyPair({ extractablePrivate: true });
        const publicJwk = await exportPublicJwk(pair.publicKey);
        const privateJwk = await exportPrivateJwk(pair.privateKey);
        expect(Object.keys(privateJwk).sort()).toEqual(["crv", "d", "kty", "x", "y"]);
        const derived = publicJwkOf(privateJwk);
        if (!derived.ok) throw new Error("publicJwkOf failed");
        expect(derived.value).toEqual(publicJwk);
        expect(Object.hasOwn(derived.value, "d")).toBe(false);
      }),
    );
  });

  it("importing a private JWK as extractable exports the same private JWK", async () => {
    await pbt(
      fc.asyncProperty(fc.constant(null), async () => {
        const pair = await generateKeyPair({ extractablePrivate: true });
        const privateJwk = await exportPrivateJwk(pair.privateKey);
        const imported = await importPrivateKey(privateJwk, { extractable: true });
        if (!imported.ok) throw new Error("private import failed");
        expect(await exportPrivateJwk(imported.value)).toEqual(privateJwk);
      }),
    );
  });

  it("signatures verify under the re-imported public key and not under another pair's key", async () => {
    await pbt(
      fc.asyncProperty(messageArb, async (message) => {
        const subtle = getSubtle();
        const pair = await generateKeyPair({ extractablePrivate: true });
        const other = await generateKeyPair();
        const privateJwk = await exportPrivateJwk(pair.privateKey);
        const signer = await importPrivateKey(privateJwk);
        if (!signer.ok) throw new Error("private import failed");
        const publicJwk = await exportPublicJwk(pair.publicKey);
        const verifier = await importPublicKey(publicJwk);
        if (!verifier.ok) throw new Error("public import failed");
        const otherPublic = await importPublicKey(await exportPublicJwk(other.publicKey));
        if (!otherPublic.ok) throw new Error("other public import failed");
        const signature = await subtle.sign(SIGN, signer.value, message);
        expect(await subtle.verify(SIGN, verifier.value, new Uint8Array(signature), message)).toBe(
          true,
        );
        expect(
          await subtle.verify(SIGN, otherPublic.value, new Uint8Array(signature), message),
        ).toBe(false);
      }),
    );
  });
});
