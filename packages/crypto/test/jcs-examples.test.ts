import { describe, expect, it } from "vitest";
import { ProgrammerError } from "../src/errors.js";
import { canonicalize } from "../src/jcs.js";

function rejects(value: unknown, reason: string): void {
  let caught: unknown;
  try {
    canonicalize(value);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ProgrammerError);
  expect((caught as Error).message).toBe(`wraith-crypto: ${reason}`);
}

describe("canonicalize examples", () => {
  it("escapes control characters, quote and backslash", () => {
    expect(canonicalize('\b\t\n\f\r"\\')).toBe('"\\b\\t\\n\\f\\r\\"\\\\"');
    expect(canonicalize("\u001f\u0000")).toBe('"\\u001f\\u0000"');
  });

  it("keeps U+007F and slash verbatim", () => {
    expect(canonicalize("\u007f/")).toBe('"\u007f/"');
  });

  it("treats an own __proto__ as an ordinary member", () => {
    const value = JSON.parse('{"__proto__":{"a":1},"b":2}') as unknown;
    expect(canonicalize(value)).toBe('{"__proto__":{"a":1},"b":2}');
  });

  it("accepts a shared acyclic object and rejects a cycle", () => {
    const shared = { x: 1 };
    expect(canonicalize({ a: shared, b: [shared, shared] })).toBe(
      '{"a":{"x":1},"b":[{"x":1},{"x":1}]}',
    );
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    rejects(cyclic, "cyclic_value");
    const arr: unknown[] = [];
    arr.push(arr);
    rejects(arr, "cyclic_value");
  });

  it("handles 100,000 levels of nested arrays", () => {
    let value: unknown = [];
    for (let i = 0; i < 100_000; i++) value = [value];
    const text = canonicalize(value);
    expect(text.length).toBe(200_002);
    expect(text.startsWith("[[[")).toBe(true);
  });

  it("does not mutate its input", () => {
    const input = { b: [3, 2, 1], a: { z: 1, y: 2 } };
    const before = JSON.stringify(input);
    canonicalize(input);
    expect(JSON.stringify(input)).toBe(before);
    expect(Object.keys(input)).toEqual(["b", "a"]);
  });

  it("rejects accessors without invoking the getter", () => {
    let calls = 0;
    const value = {
      get a() {
        calls += 1;
        return 1;
      },
    };
    rejects(value, "non_json_value");
    expect(calls).toBe(0);
  });

  it("rejects symbol-keyed and non-enumerable properties", () => {
    rejects({ [Symbol("s")]: 1 }, "non_json_value");
    const hidden = {};
    Object.defineProperty(hidden, "h", { value: 1, enumerable: false });
    rejects(hidden, "non_json_value");
  });

  it("rejects sparse arrays and arrays with extra keys", () => {
    // biome-ignore lint/suspicious/noSparseArray: sparse array is the test input
    rejects([1, , 3], "non_json_value");
    const extra: unknown[] = [1];
    (extra as unknown as Record<string, unknown>).k = 1;
    rejects(extra, "non_json_value");
  });

  it("rejects class instances, Date, Map, Set and typed arrays", () => {
    class Foo {
      a = 1;
    }
    rejects(new Foo(), "non_json_value");
    rejects(new Date(0), "non_json_value");
    rejects(new Map(), "non_json_value");
    rejects(new Set(), "non_json_value");
    rejects(new Uint8Array(2), "non_json_value");
  });

  it("formats numbers per ECMAScript", () => {
    expect(canonicalize(1e21)).toBe("1e+21");
    expect(canonicalize(1.0)).toBe("1");
    expect(canonicalize(0.000001)).toBe("0.000001");
    expect(canonicalize(1e-7)).toBe("1e-7");
    expect(canonicalize(-0)).toBe("0");
    expect(canonicalize([-0])).toBe("[0]");
  });

  it("rejects values outside JSON with the matching reason", () => {
    rejects(Number.NaN, "non_finite_number");
    rejects(Number.POSITIVE_INFINITY, "non_finite_number");
    rejects(Number.NEGATIVE_INFINITY, "non_finite_number");
    rejects(1n, "bigint_value");
    rejects(undefined, "non_json_value");
    rejects({ a: undefined }, "non_json_value");
    rejects(() => 1, "non_json_value");
    rejects(Symbol("x"), "non_json_value");
  });

  it("rejects lone surrogates in values and property names", () => {
    rejects("\ud800", "lone_surrogate");
    rejects("a\udc00b", "lone_surrogate");
    rejects({ "\ud800": 1 }, "lone_surrogate");
    expect(canonicalize("\ud83d\ude00")).toBe('"\ud83d\ude00"');
  });

  it("orders members by UTF-16 code units", () => {
    const value = { "\uff5e": 1, "\u{1f600}": 2 };
    expect(canonicalize(value)).toBe('{"\u{1f600}":2,"\uff5e":1}');
  });

  it("serializes empty containers", () => {
    expect(canonicalize({})).toBe("{}");
    expect(canonicalize([])).toBe("[]");
    expect(canonicalize({ a: {}, b: [] })).toBe('{"a":{},"b":[]}');
  });
});
