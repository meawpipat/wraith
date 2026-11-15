import { afterEach, describe, expect, it } from "vitest";
import { exportPublicJwk, generateKeyPair } from "../src/keys.js";
import { sign, verify } from "../src/sign.js";

// **Validates: Requirements 8.6, 8.7**

const subtle = globalThis.crypto.subtle;
const realVerify = subtle.verify;
let calls = 0;

function installCountingStub(): void {
  calls = 0;
  Object.defineProperty(subtle, "verify", {
    value: (...args: Parameters<typeof realVerify>) => {
      calls += 1;
      return realVerify.apply(subtle, args);
    },
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  Object.defineProperty(subtle, "verify", {
    value: realVerify,
    configurable: true,
    writable: true,
  });
});

async function fixture() {
  const pair = await generateKeyPair();
  const publicJwk = await exportPublicJwk(pair.publicKey);
  const scope = { v: 1, meta: { id: "m1", type: "ping" }, body: { n: 1 } };
  const sig = await sign(pair.privateKey, "member-a", scope as never);
  return { scope, sig, publicJwk };
}

describe("verify order of checks", () => {
  it("valid input reaches crypto.subtle.verify exactly once", async () => {
    const { scope, sig, publicJwk } = await fixture();
    installCountingStub();
    expect(await verify(scope, sig, publicJwk)).toBe(true);
    expect(calls).toBe(1);
  });

  it.each(["ES384", "es256", "", 1, null, undefined])(
    "wrong alg %s returns false with zero verify calls",
    async (alg) => {
      const { scope, sig, publicJwk } = await fixture();
      installCountingStub();
      expect(await verify(scope, { ...sig, alg }, publicJwk)).toBe(false);
      expect(calls).toBe(0);
    },
  );

  it.each([0, 2, "1", null, undefined])("v=%s returns false with zero verify calls", async (v) => {
    const { scope, sig, publicJwk } = await fixture();
    installCountingStub();
    expect(await verify({ ...scope, v }, sig, publicJwk)).toBe(false);
    expect(calls).toBe(0);
  });

  it("restores crypto.subtle.verify after each test", () => {
    expect(subtle.verify).toBe(realVerify);
  });
});
