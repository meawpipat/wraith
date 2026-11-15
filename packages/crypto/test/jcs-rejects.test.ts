// Feature: s-crypto, Property 5: JCS rejects every Non_JSON_Value at any depth
// **Validates: Requirements 3.5, 6.6, 6.7, 6.9, 6.10, 7.6, 9.7**
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ProgrammerError } from "../src/errors.js";
import { canonicalize, canonicalizeBytes } from "../src/jcs.js";
import { requestHash } from "../src/request-hash.js";
import { scopeBytes } from "../src/scope-bytes.js";
import { sign } from "../src/sign.js";
import { pbt } from "./config.js";
import {
  dagNotCycle,
  deepNesting,
  deepValidThunkArb,
  hostileContainers,
  nonJsonLeaves,
  scanHostile,
  substituteNonJson,
  substitutionArb,
} from "./support/hostile.js";
import { jsonValueArb } from "./support/json-arbitrary.js";
import { getKeyPool, type PoolKey } from "./support/keys.js";

const STABLE_REASONS: readonly string[] = [
  "non_json_value",
  "non_finite_number",
  "bigint_value",
  "lone_surrogate",
  "cyclic_value",
];

const MESSAGE_SHAPE = /^wraith-crypto: [a-z_]+$/u;

/** Run `fn`; return what it threw (undefined when it returned). */
function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return undefined;
}

function expectStableProgrammerError(e: unknown): void {
  expect(e).toBeInstanceOf(ProgrammerError);
  const err = e as ProgrammerError;
  expect(STABLE_REASONS).toContain(err.reason);
  expect(err.message).toMatch(MESSAGE_SHAPE);
  expect(err.message).toBe(`wraith-crypto: ${err.reason}`);
}

/** Structural fingerprint that never invokes getters or traps on plain data; cycles are numbered. */
function fingerprint(root: unknown): string {
  const ids = new Map<object, number>();
  const parts: string[] = [];
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const v = stack.pop();
    if (typeof v === "object" && v !== null) {
      const seen = ids.get(v);
      if (seen !== undefined) {
        parts.push(`@${seen}`);
        continue;
      }
      ids.set(v, ids.size);
      parts.push(Array.isArray(v) ? `[${v.length}` : "{");
      for (const k of Reflect.ownKeys(v).reverse()) {
        const d = Object.getOwnPropertyDescriptor(v, k) as PropertyDescriptor;
        if ("value" in d) {
          stack.push(d.value);
        } else {
          stack.push("<accessor>");
        }
        stack.push(`key:${String(k)}:${d.enumerable}`);
      }
    } else {
      parts.push(`${typeof v}:${String(v)}`);
    }
  }
  return parts.join("|");
}

// Indexes into hostileContainers() (see support/hostile.ts: 0 getter, 1-5 proxies over {} with the traps
// get/ownKeys/getPrototypeOf/has/getOwnPropertyDescriptor, 6-10 the same over [], 11 fully hostile proxy).
//
// Design reading (design.md, "Hard or impossible as written", accepted by the owner): proxies cannot be
// detected in portable JavaScript, and a trap that never fires cannot change the produced bytes. src/jcs.ts
// never reaches the get/has/getOwnPropertyDescriptor traps of an EMPTY target, so those values serialize
// like the empty object or array. They are excluded from the "throws ProgrammerError" property.
const UNREACHABLE_TRAP_CASES: ReadonlyMap<number, string> = new Map([
  [1, "{}"],
  [4, "{}"],
  [5, "{}"],
  [9, "[]"],
  [10, "[]"],
]);
// A trap that src DOES reach (ownKeys, getPrototypeOf, and the array `length` read through `get`) throws a
// raw Error inside canonicalize; canonicalize converts it to ProgrammerError("non_json_value").
const RAW_ERROR_TRAP_CASES: readonly number[] = [2, 3, 6, 7, 8, 11];

const EXCLUDED = new Set<number>(UNREACHABLE_TRAP_CASES.keys());
const CHECKED_CONTAINER_INDEXES: readonly number[] = hostileContainers()
  .map((_, i) => i)
  .filter((i) => !EXCLUDED.has(i));

/** Hostile thunks for which canonicalize must throw a stable ProgrammerError. */
const rejectedThunkArb: fc.Arbitrary<() => unknown> = fc.oneof(
  fc.nat(nonJsonLeaves().length - 1).map((i) => () => nonJsonLeaves()[i]),
  fc.constantFrom(...CHECKED_CONTAINER_INDEXES).map((i) => () => hostileContainers()[i]),
  fc.integer({ min: 1, max: 5000 }).map((d) => () => deepNesting(d, "array", Symbol("leaf"))),
  fc.integer({ min: 1, max: 5000 }).map((d) => () => deepNesting(d, "object", 1n)),
);

describe("Property 5: JCS rejects every Non_JSON_Value at any depth", () => {
  it("substituted values: oracle-hostile throws a stable ProgrammerError, clean does not", {
    timeout: 120_000,
  }, () => {
    pbt(
      fc.property(jsonValueArb(), fc.nat(), substitutionArb, (json, choice, hostile) => {
        const { value, hostile: isHostile } = substituteNonJson(json, choice, hostile);
        expect(isHostile).toBe(scanHostile(value));
        const before = fingerprint(value);
        const e1 = thrownBy(() => canonicalize(value));
        const e2 = thrownBy(() => canonicalizeBytes(value));
        if (isHostile) {
          expectStableProgrammerError(e1);
          expectStableProgrammerError(e2);
        } else {
          expect(e1).toBeUndefined();
          expect(e2).toBeUndefined();
        }
        expect(fingerprint(value)).toBe(before);
      }),
    );
  });

  it("every hostile thunk value throws ProgrammerError (no hang, no overflow)", {
    timeout: 120_000,
  }, () => {
    pbt(
      fc.property(rejectedThunkArb, (thunk) => {
        const value = thunk();
        const e1 = thrownBy(() => canonicalize(value));
        const e2 = thrownBy(() => canonicalizeBytes(value));
        expectStableProgrammerError(e1);
        expectStableProgrammerError(e2);
      }),
    );
  });

  it("proxies over an empty target whose trap src never reaches: same output as the empty value, or ProgrammerError, never another error", () => {
    for (const [index, expected] of UNREACHABLE_TRAP_CASES) {
      for (const run of [canonicalize, (v: unknown) => canonicalizeBytes(v)]) {
        const e = thrownBy(() => run(hostileContainers()[index]));
        if (e !== undefined) {
          expectStableProgrammerError(e);
        } else {
          expect(canonicalize(hostileContainers()[index])).toBe(expected);
        }
      }
    }
  });

  it("proxies whose ownKeys/getPrototypeOf/get trap src reaches: ProgrammerError non_json_value, no cause, no trap text", () => {
    for (const index of RAW_ERROR_TRAP_CASES) {
      for (const run of [canonicalize, (v: unknown) => canonicalizeBytes(v)]) {
        const e = thrownBy(() => run(hostileContainers()[index]));
        expect(e).toBeInstanceOf(ProgrammerError);
        expect((e as ProgrammerError).reason).toBe("non_json_value");
        expect(Object.hasOwn(e as object, "cause")).toBe(false);
        expect((e as Error).message).toBe("wraith-crypto: non_json_value");
      }
    }
  });

  it("a DAG (shared sub-object) is not a cycle and does not throw", () => {
    pbt(
      fc.property(fc.constant(null), () => {
        const { value } = dagNotCycle();
        expect(() => canonicalize(value)).not.toThrow();
        expect(() => canonicalizeBytes(value)).not.toThrow();
      }),
    );
  });

  it("very deep valid nesting never overflows the stack", { timeout: 120_000 }, () => {
    pbt(
      fc.property(deepValidThunkArb, (thunk) => {
        const value = thunk();
        for (const run of [() => canonicalize(value), () => canonicalizeBytes(value)]) {
          const e = thrownBy(run);
          expect(e).not.toBeInstanceOf(RangeError);
        }
      }),
    );
  });
});

/** Run `fn`; return what it rejected with (undefined when it resolved). */
async function rejectedBy(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (e) {
    return e;
  }
  return undefined;
}
describe("Property 5 (scope clauses): scopeBytes, sign and requestHash reject Non_JSON_Value and missing body", () => {
  it("a Non_JSON_Value in meta or body makes all three throw ProgrammerError; a clean scope does not", {
    timeout: 120_000,
  }, async () => {
    const [{ pair }] = (await getKeyPool(1)) as [PoolKey];
    await pbt(
      fc.asyncProperty(
        jsonValueArb(),
        fc.nat(),
        substitutionArb,
        fc.boolean(),
        async (json, choice, hostile, inMeta) => {
          const { value, hostile: isHostile } = substituteNonJson(json, choice, hostile);
          const scope = (
            inMeta
              ? { v: 1, meta: { type: "t", extra: value }, body: {} }
              : { v: 1, meta: { type: "t" }, body: value }
          ) as never;
          const before = fingerprint(scope);
          const e1 = thrownBy(() => scopeBytes(scope));
          const e2 = await rejectedBy(() => sign(pair.privateKey, "m", scope));
          const e3 = await rejectedBy(() => requestHash(scope));
          if (isHostile && !inMeta && value === undefined) {
            // a top-level undefined body is the missing-body case
            for (const e of [e1, e2, e3]) {
              expect(e).toBeInstanceOf(ProgrammerError);
              expect((e as ProgrammerError).reason).toBe("missing_body");
            }
          } else if (isHostile) {
            for (const e of [e1, e2, e3]) expectStableProgrammerError(e);
          } else {
            for (const e of [e1, e2, e3]) expect(e).toBeUndefined();
          }
          expect(fingerprint(scope)).toBe(before);
        },
      ),
    );
  });
  it("a scope without body (absent or undefined) makes all three throw ProgrammerError missing_body", {
    timeout: 120_000,
  }, async () => {
    const [{ pair }] = (await getKeyPool(1)) as [PoolKey];
    await pbt(
      fc.asyncProperty(jsonValueArb(), fc.boolean(), async (meta, explicitUndefined) => {
        const scope = (
          explicitUndefined ? { v: 1, meta, body: undefined } : { v: 1, meta }
        ) as never;
        const errors = [
          thrownBy(() => scopeBytes(scope)),
          await rejectedBy(() => sign(pair.privateKey, "m", scope)),
          await rejectedBy(() => requestHash(scope)),
        ];
        for (const e of errors) {
          expect(e).toBeInstanceOf(ProgrammerError);
          expect((e as ProgrammerError).reason).toBe("missing_body");
          expect((e as ProgrammerError).message).toMatch(MESSAGE_SHAPE);
        }
      }),
    );
  });
});
