// Sanity checks of the key pool and the Property 16 injectors (task 4.3).
import { describe, expect, it } from "vitest";
import { importPublicKey } from "../src/keys.js";
import {
  addPrivateMember,
  freshKeyPair,
  getKeyPool,
  IGNORABLE_MEMBERS,
  missingMember,
  nonStringMember,
  offCurvePoint,
  poolIndexArb,
  unsupportedExtraMember,
  wrongCrv,
  wrongKty,
  wrongLengthCoordinate,
} from "./support/keys.js";

describe("key pool support", () => {
  it("returns distinct keys with handles and JWKs, reusing entries", async () => {
    const a = await getKeyPool(2);
    const b = await getKeyPool(3);
    expect(b.length).toBe(3);
    expect(b[0]).toBe(a[0]);
    expect(a[0]?.publicJwk.x).not.toBe(a[1]?.publicJwk.x);
    expect(a[0]?.privateJwk.d.length).toBe(43);
    expect(a[0]?.pair.privateKey.extractable).toBe(true);
    expect((await freshKeyPair()).privateKey.extractable).toBe(false);
    expect(poolIndexArb(3)).toBeDefined();
  });

  it("every injector output is rejected with E_SCHEMA_INVALID", async () => {
    const jwk = (await getKeyPool(1))[0]?.publicJwk as NonNullable<unknown> as never;
    const defects = [
      addPrivateMember(jwk),
      wrongKty(jwk),
      wrongCrv(jwk),
      wrongLengthCoordinate(jwk, "x", 42),
      wrongLengthCoordinate(jwk, "x", 44),
      wrongLengthCoordinate(jwk, "y", 42),
      wrongLengthCoordinate(jwk, "y", 44),
      offCurvePoint(jwk),
      ...(["kty", "crv", "x", "y"] as const).flatMap((n) => [
        missingMember(jwk, n),
        nonStringMember(jwk, n),
      ]),
      unsupportedExtraMember(jwk),
    ];
    for (const defect of defects) {
      const r = await importPublicKey(defect);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("E_SCHEMA_INVALID");
    }
  });

  it("ignorable members are accepted", async () => {
    const jwk = (await getKeyPool(1))[0]?.publicJwk as never;
    for (const { name, value } of IGNORABLE_MEMBERS) {
      expect((await importPublicKey({ ...(jwk as object), [name]: value })).ok).toBe(true);
    }
  });
});
