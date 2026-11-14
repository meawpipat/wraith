// Sanity checks of the JSON value arbitrary (task 3.3; supports Property 3).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CRYPTO_PBT_RUNS } from "./config.js";
import {
  deepFreeze,
  type JsonValue,
  jsonValueArb,
  permutedJsonArb,
  permuteInsertionOrder,
} from "./support/json-arbitrary.js";

function wellFormed(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const n = s.charCodeAt(i + 1);
      if (!(n >= 0xdc00 && n <= 0xdfff)) return false;
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return false;
    }
  }
  return true;
}

/** Structural equality where -0 equals 0 (JSON text cannot carry -0). */
function same(a: unknown, b: unknown): boolean {
  if (typeof a === "number" || typeof b === "number") return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((x, i) => same(x, b[i]))
    );
  }
  if (typeof a === "object" && a !== null && typeof b === "object" && b !== null) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return (
      ka.length === kb.length &&
      ka.every(
        (k) =>
          Object.hasOwn(b, k) &&
          same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
      )
    );
  }
  return a === b;
}

function walk(v: JsonValue, visit: (x: JsonValue, isKey: boolean) => void): void {
  const stack: JsonValue[] = [v];
  while (stack.length > 0) {
    const cur = stack.pop() as JsonValue;
    visit(cur, false);
    if (Array.isArray(cur)) stack.push(...cur);
    else if (typeof cur === "object" && cur !== null) {
      for (const k of Object.keys(cur)) {
        visit(k, true);
        stack.push(cur[k] as JsonValue);
      }
    }
  }
}

const SAMPLES = CRYPTO_PBT_RUNS;
const sample = (): JsonValue[] => fc.sample(jsonValueArb(), { numRuns: SAMPLES, seed: 42 });

describe("json-arbitrary", () => {
  it("generates values equal to their JSON round trip (except -0), with no lone surrogates", () => {
    for (const v of sample()) {
      expect(same(JSON.parse(JSON.stringify(v)), v)).toBe(true);
      walk(v, (x) => {
        if (typeof x === "string") expect(wellFormed(x)).toBe(true);
        if (typeof x === "number") expect(Number.isFinite(x)).toBe(true);
      });
    }
  });

  it("produces the edge cases", () => {
    const strings: string[] = [];
    const numbers: number[] = [];
    let empties = 0;
    let nested = 0;
    for (const v of sample()) {
      walk(v, (x) => {
        if (typeof x === "string") strings.push(x);
        else if (typeof x === "number") numbers.push(x);
        else if (Array.isArray(x) && x.length === 0) empties++;
        else if (typeof x === "object" && x !== null && Object.keys(x).length === 0) empties++;
      });
      if (Array.isArray(v) && v.some((x) => typeof x === "object" && x !== null)) nested++;
    }
    const all = strings.join("");
    expect([...all].some((ch) => ch.charCodeAt(0) < 0x20)).toBe(true);
    expect(all.includes("\ud7ff")).toBe(true);
    expect(all.includes("\ue000")).toBe(true);
    expect(all.includes("\uff5e")).toBe(true);
    expect(/[\ud800-\udbff][\udc00-\udfff]/.test(all)).toBe(true);
    expect(numbers.some((n) => Object.is(n, -0))).toBe(true);
    expect(numbers.some((n) => n !== 0 && Math.abs(n) < 2.2250738585072014e-308)).toBe(true);
    expect(numbers.some((n) => Math.abs(n) >= 1e21)).toBe(true);
    expect(numbers.some((n) => n !== 0 && Math.abs(n) < 1e-6 && Math.abs(n) >= 1e-8)).toBe(true);
    expect(numbers.some((n) => Math.abs(n) > 2 ** 53 && Number.isInteger(n))).toBe(true);
    expect(empties).toBeGreaterThan(0);
    expect(nested).toBeGreaterThan(0);
  });

  it("permutes insertion order without changing content, and deep-freezes", () => {
    let reordered = 0;
    const pairs = fc.sample(permutedJsonArb(), { numRuns: SAMPLES, seed: 7 });
    for (const { original, permuted, seed } of pairs) {
      expect(same(permuted, original)).toBe(true);
      expect(permuteInsertionOrder(original, seed)).toStrictEqual(permuted);
      if (JSON.stringify(permuted) !== JSON.stringify(original)) reordered++;
    }
    expect(reordered).toBeGreaterThan(0);
    const frozen = deepFreeze({ a: [{ b: 1 }], c: { d: [] as number[] } });
    expect(Object.isFrozen(frozen.a[0])).toBe(true);
    expect(Object.isFrozen(frozen.c.d)).toBe(true);
  });
});
