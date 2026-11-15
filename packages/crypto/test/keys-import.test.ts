// Feature: s-crypto, Property 16: Import fails closed and ignores optional members
// **Validates: Requirements 3.4, 5.7, 5.8, 5.9**
import * as fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";
import {
  importPrivateKey,
  importPublicKey,
  keyFingerprint,
  publicKeyToCompressed,
} from "../src/keys.js";
import { pbt } from "./config.js";
import {
  addPrivateMember,
  getKeyPool,
  IGNORABLE_MEMBERS,
  type JwkObject,
  missingMember,
  nonStringMember,
  offCurvePoint,
  type PoolKey,
  unsupportedExtraMember,
  wrongCrv,
  wrongKty,
  wrongLengthCoordinate,
} from "./support/keys.js";

const POOL = 8;
let pool: readonly PoolKey[] = [];
beforeAll(async () => {
  pool = await getKeyPool(POOL);
});

type Injector = (jwk: JwkObject) => JwkObject;
const OFF_CURVE = 5;
const INJECTORS: readonly Injector[] = [
  (j) => addPrivateMember(j),
  (j) => wrongKty(j),
  (j) => wrongCrv(j),
  (j) => wrongLengthCoordinate(j, "x", 42),
  (j) => wrongLengthCoordinate(j, "x", 44),
  (j) => offCurvePoint(j),
  (j) => wrongLengthCoordinate(j, "y", 42),
  (j) => wrongLengthCoordinate(j, "y", 44),
  (j) => missingMember(j, "kty"),
  (j) => missingMember(j, "crv"),
  (j) => missingMember(j, "x"),
  (j) => missingMember(j, "y"),
  (j) => nonStringMember(j, "kty"),
  (j) => nonStringMember(j, "crv", null),
  (j) => nonStringMember(j, "x", ["a"]),
  (j) => nonStringMember(j, "y", {}),
  (j) => unsupportedExtraMember(j),
];
/** Pairs whose composition can restore a valid input: off-curve twice, or truncate then pad one coordinate back to 43 chars. */
function cancels(idx: readonly number[]): boolean {
  if (idx.length !== 2) return false;
  const [a, b] = idx as [number, number];
  return (a === OFF_CURVE && b === OFF_CURVE) || (a === 3 && b === 4) || (a === 6 && b === 7);
}
const injectorIndex = fc.integer({ min: 0, max: INJECTORS.length - 1 });
const poolIndex = fc.integer({ min: 0, max: POOL - 1 });

/** Applies the injectors in order; returns null when one cannot apply to the current shape. */
function inject(base: JwkObject, indexes: readonly number[]): JwkObject | null {
  let current = base;
  try {
    for (const i of indexes) current = (INJECTORS[i] as Injector)(current);
  } catch {
    return null;
  }
  return current;
}

function expectClosed(result: unknown, input: JwkObject | null): void {
  const r = result as { ok: boolean; code?: string; reason?: unknown };
  expect(r.ok).toBe(false);
  expect(r.code).toBe("E_SCHEMA_INVALID");
  expect(typeof r.reason).toBe("string");
  if (input !== null) {
    const text = JSON.stringify(result);
    for (const m of ["x", "y", "d"]) {
      const v = input[m];
      if (typeof v === "string" && v.length >= 8) expect(text.includes(v)).toBe(false);
    }
  }
}

function unwrap(h: unknown, make: (kind: string) => unknown): unknown {
  if (typeof h === "object" && h !== null && Object.keys(h).join() === "kind") {
    const kind = (h as { kind: unknown }).kind;
    if (kind === "getter" || kind === "proxy") return make(kind);
  }
  if (typeof h === "object" && h !== null && Object.keys(h).join() === "v") {
    return (h as { v: unknown }).v;
  }
  return h;
}

describe("Property 16: import fails closed", () => {
  it("any one or two defects on a public JWK fail closed", { timeout: 120_000 }, async () => {
    await pbt(
      fc.asyncProperty(
        poolIndex,
        fc.array(injectorIndex, { minLength: 1, maxLength: 2 }),
        async (k, idx) => {
          fc.pre(!cancels(idx));
          const input = inject({ ...(pool[k] as PoolKey).publicJwk }, idx);
          fc.pre(input !== null);
          expectClosed(await importPublicKey(input), input);
        },
      ),
    );
  });

  it("any one or two defects on a private JWK fail closed", { timeout: 120_000 }, async () => {
    await pbt(
      fc.asyncProperty(
        poolIndex,
        fc.array(injectorIndex, { minLength: 1, maxLength: 2 }),
        async (k, idx) => {
          fc.pre(!cancels(idx));
          const input = inject({ ...(pool[k] as PoolKey).privateJwk }, idx);
          fc.pre(input !== null);
          expectClosed(await importPrivateKey(input), input);
        },
      ),
    );
  });

  it("private import rejects a missing or wrong-length d and accepts a pool private JWK", {
    timeout: 120_000,
  }, async () => {
    await pbt(
      fc.asyncProperty(poolIndex, fc.nat({ max: 80 }), async (k, len) => {
        const jwk = (pool[k] as PoolKey).privateJwk;
        const { d: _d, ...noD } = jwk;
        expectClosed(await importPrivateKey(noD), noD);
        if (len !== 43) {
          const bad = { ...jwk, d: "A".repeat(len) };
          expectClosed(await importPrivateKey(bad), bad);
        }
        const good = await importPrivateKey(jwk);
        expect(good.ok).toBe(true);
        if (good.ok) expect(good.value.usages).toEqual(["sign"]);
      }),
    );
  });

  it("arbitrary values never throw or reject", { timeout: 120_000 }, async () => {
    const boom = (): never => {
      throw new Error("boom");
    };
    const makeThrowing = (kind: string): unknown =>
      kind === "getter"
        ? Object.defineProperty({}, "kty", { enumerable: true, get: boom })
        : new Proxy(
            {},
            {
              getPrototypeOf: boom,
              ownKeys: boom,
              get: boom,
              has: boom,
              getOwnPropertyDescriptor: boom,
            },
          );
    const hostile = fc.oneof(
      fc.anything(),
      fc.object(),
      fc.constantFrom("getter", "proxy").map((kind) => ({ kind })),
      fc.constantFrom(null, undefined, 0, 1n, "EC", true, Symbol("s"), () => 1).map((v) => ({ v })),
    );
    await pbt(
      fc.asyncProperty(hostile, async (h) => {
        const v = unwrap(h, makeThrowing);
        expectClosed(await importPublicKey(v), null);
        expectClosed(await importPrivateKey(v), null);
      }),
    );
  });
});

describe("Property 16: optional members are ignored", () => {
  const value = fc.oneof(
    fc.string(),
    fc.double(),
    fc.array(fc.anything(), { maxLength: 3 }),
    fc.object({ maxDepth: 2 }),
    fc.constant(null),
  );
  const extras = fc.tuple(
    ...IGNORABLE_MEMBERS.map(() => fc.option(value, { nil: undefined, freq: 2 })),
  );

  it("adding ignorable members changes nothing observable", { timeout: 120_000 }, async () => {
    await pbt(
      fc.asyncProperty(poolIndex, extras, async (k, vals) => {
        const plain = (pool[k] as PoolKey).publicJwk;
        const spelled: JwkObject = { ...plain };
        IGNORABLE_MEMBERS.forEach((m, i) => {
          if (vals[i] !== undefined) spelled[m.name] = vals[i];
        });
        const a = await importPublicKey(plain);
        const b = await importPublicKey(spelled);
        expect(a.ok).toBe(true);
        expect(b.ok).toBe(true);
        if (a.ok && b.ok) {
          expect(b.value.usages).toEqual(["verify"]);
          expect(b.value.usages).toEqual(a.value.usages);
          expect(b.value.extractable).toBe(a.value.extractable);
        }
        const ca = publicKeyToCompressed(plain);
        const cb = publicKeyToCompressed(spelled);
        expect(ca.ok && cb.ok).toBe(true);
        if (ca.ok && cb.ok) expect(Array.from(cb.value)).toEqual(Array.from(ca.value));
        const fa = await keyFingerprint(plain);
        const fb = await keyFingerprint(spelled);
        if (fa.ok && fb.ok) expect(Array.from(fb.value)).toEqual(Array.from(fa.value));
        else expect(fa.ok && fb.ok).toBe(true);
      }),
    );
  });

  it("any other member name fails", { timeout: 120_000 }, async () => {
    const reserved = new Set(["use", "key_ops", "ext", "alg", "kty", "crv", "x", "y", "d"]);
    await pbt(
      fc.asyncProperty(
        poolIndex,
        fc.string().filter((s) => !reserved.has(s)),
        value,
        async (k, name, v) => {
          const input = Object.fromEntries([
            ...Object.entries((pool[k] as PoolKey).publicJwk),
            [name, v],
          ]);
          expectClosed(await importPublicKey(input), input);
        },
      ),
    );
  });
});
