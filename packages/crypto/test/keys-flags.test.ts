import { describe, expect, it } from "vitest";
import { ProgrammerError } from "../src/errors.js";
import {
  exportPrivateJwk,
  exportPublicJwk,
  generateKeyPair,
  importPrivateKey,
  importPublicKey,
} from "../src/keys.js";
import { getSubtle } from "../src/webcrypto.js";

async function reasonOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (e) {
    return e instanceof ProgrammerError ? e.reason : "other";
  }
  return undefined;
}

describe("key flags and export shape", () => {
  it("default private key is non-extractable; the flag makes it extractable", async () => {
    const def = await generateKeyPair();
    expect(def.privateKey.extractable).toBe(false);
    const ext = await generateKeyPair({ extractablePrivate: true });
    expect(ext.privateKey.extractable).toBe(true);
  });

  it("public key is exportable in both cases", async () => {
    for (const extractablePrivate of [false, true]) {
      const kp = await generateKeyPair({ extractablePrivate });
      const jwk = await exportPublicJwk(kp.publicKey);
      expect(jwk.kty).toBe("EC");
    }
  });

  it("export errors carry the right reasons", async () => {
    const kp = await generateKeyPair();
    expect(await reasonOf(exportPrivateJwk(kp.privateKey))).toBe("key_not_extractable");
    expect(await reasonOf(exportPublicJwk(kp.privateKey))).toBe("wrong_key_type");
  });

  it("exported JWKs have exactly the expected members", async () => {
    const kp = await generateKeyPair({ extractablePrivate: true });
    const pub = await exportPublicJwk(kp.publicKey);
    expect(Object.keys(pub).sort()).toEqual(["crv", "kty", "x", "y"]);
    expect(pub.kty).toBe("EC");
    expect(pub.crv).toBe("P-256");
    expect(pub.x).toHaveLength(43);
    expect(pub.y).toHaveLength(43);
    const priv = await exportPrivateJwk(kp.privateKey);
    expect(Object.keys(priv).sort()).toEqual(["crv", "d", "kty", "x", "y"]);
    expect(priv.d).toHaveLength(43);
  });

  it("generated keys have the expected usages", async () => {
    const kp = await generateKeyPair();
    expect([...kp.privateKey.usages]).toEqual(["sign"]);
    expect([...kp.publicKey.usages]).toEqual(["verify"]);
  });

  it("imported keys obey usage and the extractable option", async () => {
    const kp = await generateKeyPair({ extractablePrivate: true });
    const pubJwk = await exportPublicJwk(kp.publicKey);
    const privJwk = await exportPrivateJwk(kp.privateKey);

    const pub = await importPublicKey(pubJwk);
    if (!pub.ok) throw new Error("public import failed");
    expect([...pub.value.usages]).toEqual(["verify"]);

    const def = await importPrivateKey(privJwk);
    if (!def.ok) throw new Error("private import failed");
    expect([...def.value.usages]).toEqual(["sign"]);
    expect(def.value.extractable).toBe(false);

    const ext = await importPrivateKey(privJwk, { extractable: true });
    if (!ext.ok) throw new Error("private import failed");
    expect(ext.value.extractable).toBe(true);
    expect([...ext.value.usages]).toEqual(["sign"]);

    const non = await importPrivateKey(privJwk, { extractable: false });
    if (!non.ok) throw new Error("private import failed");
    expect(non.value.extractable).toBe(false);
  });

  it("use, key_ops, ext and alg in an imported public JWK do not change the key", async () => {
    const kp = await generateKeyPair();
    const pubJwk = await exportPublicJwk(kp.publicKey);
    const decorated = {
      ...pubJwk,
      use: "enc",
      key_ops: ["sign"],
      ext: false,
      alg: "ES256",
    };
    const plain = await importPublicKey(pubJwk);
    const dec = await importPublicKey(decorated);
    if (!plain.ok || !dec.ok) throw new Error("public import failed");
    expect([...dec.value.usages]).toEqual(["verify"]);
    expect(dec.value.extractable).toBe(plain.value.extractable);
    expect(await exportPublicJwk(dec.value)).toEqual(pubJwk);
  });

  it("non-extractable imported private key signs and verifies under the public key", async () => {
    const kp = await generateKeyPair({ extractablePrivate: true });
    const pubJwk = await exportPublicJwk(kp.publicKey);
    const privJwk = await exportPrivateJwk(kp.privateKey);
    const priv = await importPrivateKey(privJwk, { extractable: false });
    const pub = await importPublicKey(pubJwk);
    if (!priv.ok || !pub.ok) throw new Error("import failed");
    expect(priv.value.extractable).toBe(false);
    expect(await reasonOf(exportPrivateJwk(priv.value))).toBe("key_not_extractable");

    const subtle = getSubtle();
    const algo = { name: "ECDSA", hash: "SHA-256" };
    const data = new Uint8Array([1, 2, 3, 4]);
    const sig = await subtle.sign(algo, priv.value, data);
    expect(await subtle.verify(algo, pub.value, new Uint8Array(sig), data)).toBe(true);
  });
});
