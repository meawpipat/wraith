import { afterEach, describe, expect, it } from "vitest";
import { ProgrammerError } from "../src/errors.js";
import { randomBytes } from "../src/random.js";
import { sha256 } from "../src/sha256.js";
import { getSubtle } from "../src/webcrypto.js";

const original = Object.getOwnPropertyDescriptor(globalThis, "crypto");
const originalValue = globalThis.crypto;

function setCrypto(value: unknown): void {
  Object.defineProperty(globalThis, "crypto", {
    value,
    configurable: true,
    writable: true,
    enumerable: original?.enumerable ?? false,
  });
}

function reasonOf(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ProgrammerError);
    return (e as ProgrammerError).reason;
  }
  return undefined;
}

afterEach(() => {
  if (original !== undefined) {
    Object.defineProperty(globalThis, "crypto", original);
  } else {
    Reflect.deleteProperty(globalThis, "crypto");
  }
});

describe("WebCrypto missing", () => {
  it("restores the original crypto after replacement", () => {
    expect(globalThis.crypto).toBe(originalValue);
    expect(typeof globalThis.crypto.subtle.digest).toBe("function");
  });

  it.each([
    ["crypto undefined", undefined],
    ["crypto without subtle", { getRandomValues: (): undefined => undefined }],
    ["subtle without methods", { subtle: {}, getRandomValues: (): undefined => undefined }],
  ])("getSubtle throws webcrypto_unavailable (%s)", (_name, value) => {
    setCrypto(value);
    expect(reasonOf(() => getSubtle())).toBe("webcrypto_unavailable");
  });

  it("sha256 rejects with webcrypto_unavailable", async () => {
    setCrypto(undefined);
    await expect(sha256(new Uint8Array(1))).rejects.toMatchObject({
      reason: "webcrypto_unavailable",
    });
  });

  it("randomBytes throws webcrypto_unavailable", () => {
    setCrypto({ subtle: originalValue.subtle });
    expect(reasonOf(() => randomBytes(16))).toBe("webcrypto_unavailable");
    setCrypto(undefined);
    expect(reasonOf(() => randomBytes(16))).toBe("webcrypto_unavailable");
  });

  it("works again after restore", async () => {
    expect((await sha256(new Uint8Array(0))).length).toBe(32);
    expect(randomBytes(4).length).toBe(4);
  });
});
