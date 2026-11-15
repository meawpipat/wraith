// Feature: s-crypto, Property 12: Verification never throws (no WebCrypto)
// Validates: Requirements 3.3, 13.10
// Node-only: removes globalThis.crypto and restores it in afterEach.
import * as fc from "fast-check";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { encodeBase64Url } from "../src/base64url.js";
import { requestHashEquals } from "../src/request-hash.js";
import { sign, signBytes, verify, verifyBytes } from "../src/sign.js";
import { pbt } from "./config.js";
import { anyHostileOrAnythingThunkArb, hostileThunkArb } from "./support/hostile.js";
import { getKeyPool, type PoolKey } from "./support/keys.js";

const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");

function removeCrypto(): void {
  Object.defineProperty(globalThis, "crypto", {
    value: undefined,
    configurable: true,
    writable: true,
    enumerable: originalDescriptor?.enumerable ?? false,
  });
}

afterEach(() => {
  if (originalDescriptor !== undefined) {
    Object.defineProperty(globalThis, "crypto", originalDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, "crypto");
  }
});

const scope = { v: 1 as const, meta: { t: "ping" }, body: { n: 1 } };
let key: PoolKey;
let sigBytes: Uint8Array;
let sigObject: { by: string; alg: string; value: string };
const payload = new Uint8Array([1, 2, 3]);

beforeAll(async () => {
  [key] = (await getKeyPool(1)) as [PoolKey];
  sigObject = await sign(key.pair.privateKey, "m", scope);
  sigBytes = await signBytes(key.pair.privateKey, payload);
});

const thunks = {
  hostile: hostileThunkArb,
  "hostile or anything": anyHostileOrAnythingThunkArb,
};

describe("Feature: s-crypto, Property 12: Verification never throws (no WebCrypto)", () => {
  it("test setup removes and restores crypto", () => {
    removeCrypto();
    expect(globalThis.crypto).toBeUndefined();
  });

  it("crypto is restored after the previous test", () => {
    expect(globalThis.crypto?.subtle).toBeDefined();
  });

  it("well-formed signatures resolve to false without WebCrypto", async () => {
    removeCrypto();
    expect(await verify(scope, sigObject, key.publicJwk)).toBe(false);
    expect(await verify(scope, sigObject, key.pair.publicKey)).toBe(false);
    expect(await verifyBytes(payload, sigBytes, key.publicJwk)).toBe(false);
    expect(await verifyBytes(payload, sigBytes, key.pair.publicKey)).toBe(false);
  });

  for (const [name, arb] of Object.entries(thunks)) {
    it(`verify resolves to false for any input (${name})`, async () => {
      removeCrypto();
      const validArb = fc.constantFrom(
        () => scope,
        () => sigObject,
        () => key.publicJwk,
        () => key.pair.publicKey,
      );
      await pbt(
        fc.asyncProperty(fc.oneof(arb, validArb), arb, fc.oneof(arb, validArb), async (a, b, c) => {
          try {
            return (await verify(a(), b(), c())) === false;
          } catch {
            return false;
          }
        }),
      );
    });

    it(`verify resolves to false for a valid signature with any key (${name})`, async () => {
      removeCrypto();
      await pbt(
        fc.asyncProperty(arb, async (c) => {
          try {
            return (await verify(scope, sigObject, c())) === false;
          } catch {
            return false;
          }
        }),
      );
    });

    it(`verifyBytes resolves to false for any input (${name})`, async () => {
      removeCrypto();
      const validArb = fc.constantFrom(
        () => payload,
        () => sigBytes,
        () => new Uint8Array(sigBytes),
        () => key.publicJwk,
        () => key.pair.publicKey,
      );
      await pbt(
        fc.asyncProperty(
          fc.oneof(arb, validArb),
          fc.oneof(arb, validArb),
          fc.oneof(arb, validArb),
          async (a, b, c) => {
            try {
              return (await verifyBytes(a(), b(), c())) === false;
            } catch {
              return false;
            }
          },
        ),
      );
    });

    it(`requestHashEquals returns a boolean without WebCrypto (${name})`, () => {
      removeCrypto();
      const hash = encodeBase64Url(sigBytes.slice(0, 32));
      const validArb = fc.constantFrom(
        () => hash,
        () => `${hash}x`,
      );
      pbt(
        fc.property(fc.oneof(arb, validArb), fc.oneof(arb, validArb), (a, b) => {
          try {
            return typeof requestHashEquals(a(), b()) === "boolean";
          } catch {
            return false;
          }
        }),
      );
    });
  }
});
