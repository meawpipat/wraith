// Sanity checks that each hostile builder produces what it claims (task 3.4).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  ACCESSOR_PROPERTY,
  anyHostileOrAnythingArb,
  anyHostileOrAnythingThunkArb,
  arrayWithExtraKey,
  CYCLE_REFERENCE,
  countingGetterObject,
  cyclicArray,
  cyclicObject,
  dagNotCycle,
  deepCycle,
  deepNesting,
  deepValidThunkArb,
  HOSTILE_VERIFY_INPUTS,
  HostileInstance,
  hasLoneSurrogate,
  hostileContainers,
  hostileThunkArb,
  hostileValueArb,
  indirectCycle,
  loneSurrogateStringArb,
  nonJsonLeaves,
  PROXY_TRAPS,
  SPARSE_HOLE,
  scanHostile,
  sparseArray,
  substituteNonJson,
  throwingGetterObject,
  throwingProxy,
} from "./support/hostile.js";

function reach(root: unknown, path: Array<string | number>): unknown {
  let cur = root;
  for (const k of path) {
    cur = (cur as Record<string | number, unknown>)[k];
  }
  return cur;
}

describe("hostile builders", () => {
  it("throwing getter really throws on access", () => {
    const o = throwingGetterObject();
    expect(() => o.trap).toThrow("hostile getter");
    expect(o.plain).toBe(1);
  });

  it("counting getter counts reads", () => {
    const { value, reads } = countingGetterObject();
    expect(reads()).toBe(0);
    expect(value.g).toBe(1);
    expect(reads()).toBe(1);
  });

  it("each proxy trap throws on its operation", () => {
    const ops: Record<(typeof PROXY_TRAPS)[number], (p: object) => unknown> = {
      get: (p) => (p as Record<string, unknown>).x,
      ownKeys: (p) => Reflect.ownKeys(p),
      getPrototypeOf: (p) => Object.getPrototypeOf(p),
      has: (p) => "x" in p,
      getOwnPropertyDescriptor: (p) => Object.getOwnPropertyDescriptor(p, "x"),
    };
    for (const trap of PROXY_TRAPS) {
      const p = throwingProxy(trap);
      expect(() => ops[trap](p), trap).toThrow(`hostile ${trap} trap`);
    }
  });

  it("cycles are cycles and the DAG is not", () => {
    const o = cyclicObject();
    expect(o.self).toBe(o);
    const a = cyclicArray();
    expect(a[1]).toBe(a);
    const ic = indirectCycle();
    expect(reach(ic, ["b", "list", 0])).toBe(ic);
    expect(() => JSON.stringify(o)).toThrow();
    expect(() => JSON.stringify(a)).toThrow();
    expect(() => JSON.stringify(ic)).toThrow();
    expect(scanHostile(o)).toBe(true);
    expect(scanHostile(a)).toBe(true);
    expect(scanHostile(ic)).toBe(true);
    expect(scanHostile(deepCycle(20))).toBe(true);

    const { value, shared } = dagNotCycle();
    expect(value.left).toBe(shared);
    expect(value.right).toBe(shared);
    expect(() => JSON.stringify(value)).not.toThrow();
    expect(scanHostile(value)).toBe(false);
  });

  it("deep nesting is built iteratively to the requested depth", () => {
    const depth = 100_000;
    let cur = deepNesting(depth, "array", "leaf");
    let seen = 0;
    while (Array.isArray(cur)) {
      cur = cur[0];
      seen++;
    }
    expect(seen).toBe(depth);
    expect(cur).toBe("leaf");
    expect(deepNesting(0, "object", 7)).toBe(7);
    expect(deepNesting(2, "object", 7)).toEqual({ k: { k: 7 } });
  });

  it("exotic values have the claimed shapes", () => {
    const holes = sparseArray(3, 1);
    expect(holes.length).toBe(3);
    expect(1 in holes).toBe(false);
    expect(Object.keys(arrayWithExtraKey())).toContain("extra");
    expect(new HostileInstance()).toBeInstanceOf(HostileInstance);
    const leaves = nonJsonLeaves();
    expect(leaves.some((v) => typeof v === "bigint")).toBe(true);
    expect(leaves.some((v) => typeof v === "symbol")).toBe(true);
    expect(leaves.some((v) => v instanceof Date)).toBe(true);
    expect(leaves.some((v) => v instanceof Map)).toBe(true);
    expect(leaves.some((v) => v instanceof Set)).toBe(true);
    expect(leaves.some((v) => v instanceof Uint8Array)).toBe(true);
    expect(leaves.some((v) => typeof v === "function")).toBe(true);
    expect(leaves.some((v) => Number.isNaN(v))).toBe(true);
    expect(leaves.some((v) => v === Number.NEGATIVE_INFINITY)).toBe(true);
    expect(leaves.some((v) => v === undefined)).toBe(true);
    expect(leaves.some((v) => typeof v === "object" && v instanceof Number)).toBe(true);
    expect(leaves.some((v) => typeof v === "string" && hasLoneSurrogate(v))).toBe(true);
  });

  it("every leaf and container is hostile by the independent scan", () => {
    for (const v of nonJsonLeaves()) {
      expect(scanHostile(v), String(typeof v)).toBe(true);
    }
    hostileContainers().forEach((v, i) => {
      expect(scanHostile(v), `container ${i}`).toBe(true);
    });
  });

  it("scanHostile accepts ordinary JSON", () => {
    expect(scanHostile({ a: [1, "x", null, true, { b: -0.5 }], c: "é" })).toBe(false);
    expect(scanHostile(Object.create(null))).toBe(false);
  });

  it("hasLoneSurrogate separates paired from lone", () => {
    expect(hasLoneSurrogate("\ud83d\ude00")).toBe(false);
    expect(hasLoneSurrogate("\ud83d")).toBe(true);
    expect(hasLoneSurrogate("\ude00\ud83d")).toBe(true);
  });

  it("arbitraries produce what they claim", () => {
    for (const s of fc.sample(loneSurrogateStringArb, 20)) {
      expect(hasLoneSurrogate(s)).toBe(true);
    }
    for (const v of fc.sample(hostileValueArb, 50)) {
      expect(scanHostile(v)).toBe(true);
    }
    expect(fc.sample(anyHostileOrAnythingArb, 20)).toHaveLength(20);
    for (const make of fc.sample(hostileThunkArb, 50)) {
      expect(scanHostile(make())).toBe(true);
    }
    for (const make of fc.sample(deepValidThunkArb, 5)) {
      expect(scanHostile(make())).toBe(false);
    }
    expect(fc.sample(anyHostileOrAnythingThunkArb, 20)).toHaveLength(20);
  });
});

describe("substituteNonJson", () => {
  const json = { a: [1, { b: "x" }], c: null, d: "s" };

  it("replaces exactly one position, keeps the input intact and reports hostile", () => {
    const before = JSON.stringify(json);
    for (let choice = 0; choice < 12; choice++) {
      for (const hostile of [
        undefined,
        1n,
        Number.NaN,
        new Date(0),
        () => 1,
        CYCLE_REFERENCE,
        SPARSE_HOLE,
        ACCESSOR_PROPERTY,
      ]) {
        const r = substituteNonJson(json, choice, hostile);
        expect(r.hostile).toBe(true);
        expect(r.value === json).toBe(false);
        expect(JSON.stringify(json)).toBe(before);
      }
    }
  });

  it("a value slot holds the substituted value", () => {
    const seen = new Set<string>();
    for (let choice = 0; choice < 20; choice++) {
      const r = substituteNonJson({ k: 1 }, choice, 1n);
      seen.add(r.position);
      if (r.position === "value") {
        expect((r.value as { k: unknown }).k).toBe(1n);
      }
      if (r.position === "name") {
        expect(Object.keys(r.value as object).some(hasLoneSurrogate)).toBe(true);
      }
    }
    expect(seen).toEqual(new Set(["value", "name"]));
  });

  it("sentinels build a cycle, a hole and an accessor", () => {
    const cyc = substituteNonJson([1], 0, CYCLE_REFERENCE).value as unknown[];
    expect(cyc[0]).toBe(cyc);
    const hole = substituteNonJson([1, 2], 0, SPARSE_HOLE).value as unknown[];
    expect(0 in hole).toBe(false);
    const acc = substituteNonJson([1], 0, ACCESSOR_PROPERTY).value as unknown[];
    expect(() => acc[0]).toThrow();
  });

  it("a primitive root is replaced at the root", () => {
    const r = substituteNonJson(5, 3, Number.NaN);
    expect(r.position).toBe("root");
    expect(r.hostile).toBe(true);
  });
});

describe("HOSTILE_VERIFY_INPUTS", () => {
  it("lists the R3.8 inputs", () => {
    const names = HOSTILE_VERIFY_INPUTS.map((i) => i.name);
    expect(new Set(names).size).toBe(names.length);
    const scopes = HOSTILE_VERIFY_INPUTS.filter((i) => i.slot === "scope").map((i) => i.value);
    expect(scopes).toContain(undefined);
    expect(scopes).toContain(null);
    expect(scopes.some((v) => typeof v === "number")).toBe(true);
    expect(scopes.some((v) => typeof v === "string")).toBe(true);
    expect(scopes.some((v) => Array.isArray(v))).toBe(true);
    expect(scopes.some((v) => scanHostile(v))).toBe(true);
    expect(HOSTILE_VERIFY_INPUTS.some((i) => i.slot === "signature")).toBe(true);
    expect(HOSTILE_VERIFY_INPUTS.some((i) => i.slot === "key")).toBe(true);
  });
});
