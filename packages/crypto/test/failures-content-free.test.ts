// Feature: s-crypto, Property 13: Failures never contain content
// Validates: Requirements 2.9, 3.6, 11.12
// Portable: no `node:` import. The secret clause (11.12) is added in task 12.1.
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { decodeBase64Url } from "../src/base64url.js";
import { ProgrammerError } from "../src/errors.js";
import { canonicalize } from "../src/jcs.js";
import {
  exportPrivateJwk,
  exportPublicJwk,
  importPrivateKey,
  importPublicKey,
  keyFingerprint,
  publicJwkOf,
  publicKeyFromCompressed,
  publicKeyToCompressed,
} from "../src/keys.js";
import { requestHash } from "../src/request-hash.js";
import { sign } from "../src/sign.js";
import { utf8Encode } from "../src/utf8.js";
import { pbt } from "./config.js";
import { getKeyPool, type PoolKey } from "./support/keys.js";

type Outcome = { thrown: true; error: unknown } | { thrown: false; value: unknown };
type Case = { name: string; run: (marker: string) => unknown };

const MARKER_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("");
/** Upper case and digits only: it cannot occur inside a lower case reason code or the prefix. */
const markerArb = fc
  .array(fc.constantFrom(...MARKER_CHARS), { minLength: 24, maxLength: 48 })
  .map((chars) => chars.join(""));

const META = { id: "m", type: "t", ts: 1 };
const goodScope = (body: unknown): unknown => ({ v: 1, meta: META, body });
const cyclic = (marker: string): unknown => {
  const o: Record<string, unknown> = { [marker]: marker };
  o.self = o;
  return o;
};

function jwk(_marker: string, over: Record<string, unknown>): Record<string, unknown> {
  return { kty: "EC", crv: "P-256", x: "AAAA", y: "AAAA", ...over };
}

const keyMemberCases = (fn: (j: unknown) => unknown): Case[] => [
  { name: "x", run: (m) => fn(jwk(m, { x: m })) },
  { name: "y", run: (m) => fn(jwk(m, { y: m })) },
  { name: "kty", run: (m) => fn(jwk(m, { kty: m })) },
  { name: "crv", run: (m) => fn(jwk(m, { crv: m })) },
  { name: "d", run: (m) => fn(jwk(m, { d: m })) },
  { name: "extra member name", run: (m) => fn({ ...jwk(m, {}), [m]: "v" }) },
  { name: "extra member value", run: (m) => fn({ ...jwk(m, {}), kid: m }) },
  { name: "non-string x", run: (m) => fn(jwk(m, { x: { [m]: m } })) },
];

const failureCases: Case[] = [
  ...keyMemberCases(importPublicKey).map((c) => ({ ...c, name: `importPublicKey ${c.name}` })),
  ...keyMemberCases(importPrivateKey).map((c) => ({ ...c, name: `importPrivateKey ${c.name}` })),
  ...keyMemberCases(publicJwkOf).map((c) => ({ ...c, name: `publicJwkOf ${c.name}` })),
  ...keyMemberCases(publicKeyToCompressed).map((c) => ({
    ...c,
    name: `publicKeyToCompressed ${c.name}`,
  })),
  ...keyMemberCases(keyFingerprint).map((c) => ({ ...c, name: `keyFingerprint ${c.name}` })),
  { name: "decodeBase64Url marker string", run: (m) => decodeBase64Url(`${m}!`) },
  {
    name: "decodeBase64Url marker bad length",
    run: (m) => decodeBase64Url(`${m.slice(0, m.length - (m.length % 4))}A`),
  },
  { name: "decodeBase64Url marker object", run: (m) => decodeBase64Url({ [m]: m }) },
  {
    name: "publicKeyFromCompressed marker bytes",
    run: (m) => publicKeyFromCompressed(utf8Encode(m.padEnd(33, "A").slice(0, 33))),
  },
  {
    name: "publicKeyFromCompressed bad prefix",
    run: (m) => publicKeyFromCompressed(utf8Encode(`A${m}`.padEnd(33, "A").slice(0, 33))),
  },
];

const throwCases: Case[] = [
  { name: "canonicalize bigint under marker key", run: (m) => canonicalize({ [m]: 1n }) },
  { name: "canonicalize bigint marker array", run: (m) => canonicalize([m, 1n]) },
  { name: "canonicalize NaN under marker key", run: (m) => canonicalize({ [m]: Number.NaN }) },
  { name: "canonicalize Infinity", run: (m) => canonicalize({ [m]: m, n: Infinity }) },
  { name: "canonicalize undefined member", run: (m) => canonicalize({ [m]: undefined }) },
  { name: "canonicalize function member", run: (m) => canonicalize({ [m]: () => m }) },
  { name: "canonicalize symbol member", run: (m) => canonicalize({ [m]: Symbol(m) }) },
  { name: "canonicalize symbol key", run: (m) => canonicalize({ [Symbol(m)]: m }) },
  { name: "canonicalize cyclic", run: (m) => canonicalize(cyclic(m)) },
  { name: "canonicalize lone surrogate value", run: (m) => canonicalize(`${m}\ud800`) },
  { name: "canonicalize lone surrogate key", run: (m) => canonicalize({ [`${m}\udc00`]: 1 }) },
  { name: "canonicalize Map", run: (m) => canonicalize(new Map([[m, m]])) },
  { name: "canonicalize Date", run: (m) => canonicalize({ [m]: new Date(0) }) },
  {
    name: "canonicalize getter",
    run: (m) => canonicalize(Object.defineProperty({}, m, { get: () => m, enumerable: true })),
  },
  {
    name: "canonicalize class instance",
    run: (m) => canonicalize(Object.create({ [m]: m })),
  },
  {
    name: "canonicalize sparse array",
    run: (m) => canonicalize(Object.assign([m, m], { length: 3 })),
  },
  { name: "requestHash missing body", run: (m) => requestHash({ v: 1, meta: { ...META, id: m } }) },
  { name: "requestHash bigint body", run: (m) => requestHash(goodScope({ [m]: 1n }) as never) },
  { name: "requestHash cyclic body", run: (m) => requestHash(goodScope(cyclic(m)) as never) },
  {
    name: "requestHash lone surrogate meta",
    run: (m) => requestHash({ v: 1, meta: { ...META, id: `${m}\ud800` }, body: {} } as never),
  },
  {
    name: "sign wrong key handle (type is the marker)",
    run: (m) => sign({ type: m } as never, m, goodScope({}) as never),
  },
  {
    name: "sign wrong key handle (public key)",
    run: async (m) => {
      const [k] = (await getKeyPool(1)) as [PoolKey];
      return sign(k.pair.publicKey, m, goodScope(m) as never);
    },
  },
  {
    name: "sign non-JSON body",
    run: async (m) => {
      const [k] = (await getKeyPool(1)) as [PoolKey];
      return sign(k.pair.privateKey, m, goodScope({ [m]: 1n }) as never);
    },
  },
  {
    name: "sign missing body",
    run: async (m) => {
      const [k] = (await getKeyPool(1)) as [PoolKey];
      return sign(k.pair.privateKey, m, {
        v: 1,
        meta: META,
      } as never);
    },
  },
  { name: "exportPublicJwk wrong type", run: (m) => exportPublicJwk({ type: m } as never) },
  { name: "exportPrivateJwk wrong type", run: (m) => exportPrivateJwk({ type: m } as never) },
  {
    name: "exportPrivateJwk non-extractable",
    run: async (m) => {
      const [k] = (await getKeyPool(1)) as [PoolKey];
      void m;
      const handle = (k as { pair: { privateKey: object } }).pair.privateKey;
      return exportPrivateJwk({ ...handle, type: "private", extractable: false } as never);
    },
  },
];

async function outcomeOf(run: () => unknown): Promise<Outcome> {
  try {
    return { thrown: false, value: await run() };
  } catch (error) {
    return { thrown: true, error };
  }
}

/** Every string a caller could obtain from the outcome. */
function surfaces(o: Outcome): string[] {
  if (!o.thrown) return [JSON.stringify(o.value) ?? "", String(o.value)];
  const e = o.error as Error;
  const own = Object.getOwnPropertyNames(e).map((k) => {
    const v = (e as unknown as Record<string, unknown>)[k];
    return k === "stack" ? "" : `${k}=${String(v)}`;
  });
  return [e.message, e.name, String(e), JSON.stringify(e), ...own];
}

function expectNoContent(o: Outcome, marker: string): void {
  const reason = o.thrown
    ? (o.error as ProgrammerError).reason
    : ((o.value as { reason?: string } | null)?.reason ?? "");
  const text = surfaces(o).join("\n");
  expect(text).not.toContain(marker);
  const window = Math.max(reason.length + 1, 8);
  for (let i = 0; i + window <= marker.length; i++) {
    expect(text).not.toContain(marker.slice(i, i + window));
  }
}

function expectShape(o: Outcome): void {
  if (o.thrown) {
    const e = o.error;
    expect(e).toBeInstanceOf(ProgrammerError);
    const pe = e as ProgrammerError;
    expect(pe.message).toBe(`wraith-crypto: ${pe.reason}`);
    expect("cause" in pe).toBe(false);
    expect(Object.keys(pe).sort()).toEqual(["name", "reason"]);
  }
}

describe("Feature: s-crypto, Property 13: Failures never contain content", () => {
  for (const c of failureCases) {
    it(`returned failure carries no marker: ${c.name}`, async () => {
      await pbt(
        fc.asyncProperty(markerArb, async (marker) => {
          const o = await outcomeOf(() => c.run(marker));
          expect(o.thrown).toBe(false);
          const v = (o as { value: { ok: boolean; code: string; reason: string } }).value;
          expect(v.ok).toBe(false);
          expect(Object.keys(v).sort()).toEqual(["code", "ok", "reason"]);
          expect(v.code).toBe("E_SCHEMA_INVALID");
          expectNoContent(o, marker);
        }),
      );
    });
  }

  for (const c of throwCases) {
    it(`thrown ProgrammerError carries no marker: ${c.name}`, async () => {
      await pbt(
        fc.asyncProperty(markerArb, async (marker) => {
          const o = await outcomeOf(() => c.run(marker));
          expect(o.thrown).toBe(true);
          expectShape(o);
          expectNoContent(o, marker);
        }),
      );
    });
  }
});
