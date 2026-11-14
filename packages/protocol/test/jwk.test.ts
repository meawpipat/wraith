/**
 * Example tests for the JWK shape (public EC P-256 key, roster signPub).
 * **Validates: Requirements 1.7**
 */
import { describe, expect, it } from "vitest";
import { JWK } from "../src/shapes.ts";

// Artificial 43-character base64url coordinates; not real key material.
const X = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE";
const Y = "ZyXwVuTsRqPoNmLkJiHgFeDcBa9876543210_-ZyXwV";
const PUBLIC = { kty: "EC", crv: "P-256", x: X, y: Y };

describe("JWK", () => {
  it("fixture coordinates are 43 characters", () => {
    expect(X).toHaveLength(43);
    expect(Y).toHaveLength(43);
  });

  it("accepts a public P-256 key", () => {
    const r = JWK.safeParse(PUBLIC);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toEqual(PUBLIC);
  });

  it("rejects the private member d", () => {
    expect(JWK.safeParse({ ...PUBLIC, d: X }).success).toBe(false);
  });

  it.each(["use", "key_ops", "ext", "alg", "kid"])("rejects extra member %s", (member) => {
    expect(JWK.safeParse({ ...PUBLIC, [member]: "x" }).success).toBe(false);
  });

  it("rejects wrong kty and crv", () => {
    expect(JWK.safeParse({ ...PUBLIC, kty: "RSA" }).success).toBe(false);
    expect(JWK.safeParse({ ...PUBLIC, crv: "P-384" }).success).toBe(false);
  });

  it.each(["x", "y"])("rejects wrong length for %s", (member) => {
    expect(JWK.safeParse({ ...PUBLIC, [member]: X.slice(1) }).success).toBe(false);
    expect(JWK.safeParse({ ...PUBLIC, [member]: `${X}A` }).success).toBe(false);
  });

  it.each(["+", "/", "="])("rejects character %s outside the alphabet", (ch) => {
    const bad = `${X.slice(0, 42)}${ch}`;
    expect(bad).toHaveLength(43);
    expect(JWK.safeParse({ ...PUBLIC, x: bad }).success).toBe(false);
    expect(JWK.safeParse({ ...PUBLIC, y: bad }).success).toBe(false);
  });

  it("rejects non-objects", () => {
    for (const v of [null, undefined, "EC", 1, true, [], [PUBLIC]]) {
      expect(JWK.safeParse(v).success).toBe(false);
    }
  });

  it("rejects missing members", () => {
    for (const member of ["kty", "crv", "x", "y"]) {
      const { [member]: _omitted, ...rest } = PUBLIC as Record<string, string>;
      expect(JWK.safeParse(rest).success).toBe(false);
    }
  });

  it("the error result carries no value", () => {
    const r = JWK.safeParse({ ...PUBLIC, d: "secret-private-value" });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r)).not.toContain("secret-private-value");
    expect("data" in r).toBe(false);
  });
});
