import { describe, expect, it } from "vitest";
import { ProgrammerError } from "../src/errors.js";
import { randomBytes } from "../src/random.js";
import { sha256, sha256Base64Url } from "../src/sha256.js";

describe("sha256", () => {
  it("returns a 32-byte digest", async () => {
    const d = await sha256(new Uint8Array([1, 2, 3]));
    expect(d).toBeInstanceOf(Uint8Array);
    expect(d.length).toBe(32);
  });

  it("matches the known digest of empty input", async () => {
    const hex = Array.from(await sha256(new Uint8Array(0)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    expect(hex).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("sha256Base64Url is 43 characters of unpadded Base64url", async () => {
    const s = await sha256Base64Url(new Uint8Array([9, 8, 7]));
    expect(s).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(s).not.toContain("=");
  });
});

describe("randomBytes", () => {
  it.each([0, 1, 16, 65536])("returns %i bytes", (n) => {
    const r = randomBytes(n);
    expect(r).toBeInstanceOf(Uint8Array);
    expect(r.length).toBe(n);
  });

  it("two 16-byte calls differ", () => {
    expect(Array.from(randomBytes(16))).not.toEqual(Array.from(randomBytes(16)));
  });

  it.each([-1, 1.5, Number.NaN, 65537, "3"])("rejects invalid length %j", (n) => {
    let caught: unknown;
    try {
      randomBytes(n as number);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ProgrammerError);
    expect((caught as ProgrammerError).reason).toBe("invalid_argument");
  });
});
