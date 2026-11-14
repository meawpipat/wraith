// JSON value generators for the JCS properties (Property 3, R13.12, R6.3 to R6.5).
// Portable: no `node:` import, and nothing imported from `src`.
import fc from "fast-check";

/** A JSON value as produced by `JSON.parse` (numbers may include -0, which JSON text cannot carry). */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

/** Single characters that stress UTF-16 ordering and escaping. */
const EDGE_CHARS: readonly string[] = [
  "\u0000",
  "\u0001",
  "\u0008",
  "\u0009",
  "\u000a",
  "\u000c",
  "\u000d",
  "\u001f",
  " ",
  '"',
  "\\",
  "/",
  "\u007f",
  "\u2028",
  "\u2029",
  "\ud7ff",
  "\ue000",
  "\uff5e",
  "\ufffd",
  "\uffff",
  "\u{10000}",
  "\u{1f600}",
  "\u{10ffff}",
];

/** One well-formed character: an edge character, a control character, a BMP or an astral code point. */
const charArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 4, arbitrary: fc.constantFrom(...EDGE_CHARS) },
  { weight: 2, arbitrary: fc.integer({ min: 0, max: 0x1f }).map((c) => String.fromCharCode(c)) },
  { weight: 3, arbitrary: fc.integer({ min: 0x20, max: 0x7e }).map((c) => String.fromCharCode(c)) },
  {
    weight: 2,
    arbitrary: fc
      .integer({ min: 0x80, max: 0xffff })
      .filter((c) => c < 0xd800 || c > 0xdfff)
      .map((c) => String.fromCharCode(c)),
  },
  {
    weight: 2,
    arbitrary: fc.integer({ min: 0x10000, max: 0x10ffff }).map((c) => String.fromCodePoint(c)),
  },
);

/** Well-formed string (never a lone surrogate). */
export const wellFormedStringArb: fc.Arbitrary<string> = fc
  .array(charArb, { maxLength: 8 })
  .map((parts) => parts.join(""));

/** Object member name: short, drawn from the edge alphabet. */
export const keyArb: fc.Arbitrary<string> = fc
  .array(charArb, { minLength: 0, maxLength: 4 })
  .map((parts) => parts.join(""));

/** Numbers whose ECMAScript text form changes shape (exponent switch points, -0, subnormals). */
const BOUNDARY_NUMBERS: readonly number[] = [
  0,
  -0,
  1,
  -1,
  0.1,
  1e21,
  1e21 - 1e5,
  9.999999999999999e20,
  1.0000000000000001e21,
  123456789012345680000,
  1e-6,
  1e-7,
  9.99999999999999e-7,
  1.5e-7,
  4.5e-7,
  5e-324,
  -5e-324,
  2.2250738585072014e-308,
  2.225073858507201e-308,
  Number.MAX_VALUE,
  -Number.MAX_VALUE,
  Number.MIN_VALUE,
  Number.MAX_SAFE_INTEGER,
  2 ** 53,
  2 ** 53 + 2,
];

/** Integers beyond 2^53, as numbers. */
const bigIntegerArb: fc.Arbitrary<number> = fc
  .bigInt({ min: 2n ** 53n, max: 2n ** 90n })
  .chain((n) => fc.boolean().map((neg) => Number(neg ? -n : n)));

/** Finite doubles biased towards the Property 3 edge cases. */
export const jsonNumberArb: fc.Arbitrary<number> = fc.oneof(
  { weight: 3, arbitrary: fc.double({ noNaN: true, noDefaultInfinity: true }) },
  { weight: 2, arbitrary: fc.constantFrom(...BOUNDARY_NUMBERS) },
  { weight: 1, arbitrary: bigIntegerArb },
  { weight: 1, arbitrary: fc.double({ min: -1e-300, max: 1e-300, noNaN: true }) },
  { weight: 1, arbitrary: fc.double({ min: 1e20, max: 1e22, noNaN: true }) },
  { weight: 1, arbitrary: fc.double({ min: 1e-8, max: 1e-6, noNaN: true }) },
  { weight: 1, arbitrary: fc.integer() },
);

const leafArb: fc.Arbitrary<JsonValue> = fc.oneof(
  fc.constant(null),
  fc.boolean(),
  jsonNumberArb,
  wellFormedStringArb,
);

/** Build an object whose own members are defined (never through `__proto__` setters). */
function buildObject(entries: readonly (readonly [string, JsonValue])[]): {
  [key: string]: JsonValue;
} {
  const out: { [key: string]: JsonValue } = {};
  for (const [k, v] of entries) {
    Object.defineProperty(out, k, {
      value: v,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out;
}

/** Options of {@link jsonValueArb}. */
export interface JsonValueOptions {
  /** Maximum nesting depth of arrays and objects (default 4). */
  readonly maxDepth?: number;
}

/**
 * JSON values: null, booleans, doubles (including -0), well-formed strings, and depth-limited
 * arrays and objects (empty ones included). Keys are unique within an object.
 */
export function jsonValueArb(options: JsonValueOptions = {}): fc.Arbitrary<JsonValue> {
  const maxDepth = options.maxDepth ?? 4;
  return fc.letrec<{ value: JsonValue; array: JsonValue[]; object: { [key: string]: JsonValue } }>(
    (tie) => ({
      value: fc.oneof(
        { maxDepth, depthSize: "small" },
        leafArb,
        tie("array"),
        tie("object"),
      ) as fc.Arbitrary<JsonValue>,
      array: fc.array(tie("value"), { maxLength: 5 }),
      object: fc
        .uniqueArray(fc.tuple(keyArb, tie("value")), {
          maxLength: 5,
          selector: (entry) => entry[0],
        })
        .map((entries) => buildObject(entries)),
    }),
  ).value;
}

/** Deterministic 32-bit generator (mulberry32), so a shuffle depends only on the seed. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Rebuild `value` with the members of every object inserted in a different order, chosen by `seed`.
 * Arrays keep their order. Not recursive: depth is bounded only by memory.
 * (Integer-like keys are always enumerated first by the engine; that cannot be changed here.)
 */
export function permuteInsertionOrder(value: JsonValue, seed: number): JsonValue {
  const rng = makeRng(seed);
  type Frame = { src: JsonValue; assign: (v: JsonValue) => void };
  let result: JsonValue = null;
  const stack: Frame[] = [
    {
      src: value,
      assign: (v) => {
        result = v;
      },
    },
  ];
  while (stack.length > 0) {
    const { src, assign } = stack.pop() as Frame;
    if (Array.isArray(src)) {
      const copy: JsonValue[] = new Array(src.length).fill(null);
      assign(copy);
      src.forEach((item, i) => {
        stack.push({
          src: item,
          assign: (v) => {
            copy[i] = v;
          },
        });
      });
    } else if (typeof src === "object" && src !== null) {
      const keys = Object.keys(src);
      for (let i = keys.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const tmp = keys[i] as string;
        keys[i] = keys[j] as string;
        keys[j] = tmp;
      }
      const copy: { [key: string]: JsonValue } = {};
      assign(copy);
      for (const k of keys) {
        Object.defineProperty(copy, k, {
          value: null,
          enumerable: true,
          writable: true,
          configurable: true,
        });
        stack.push({
          src: src[k] as JsonValue,
          assign: (v) => {
            copy[k] = v;
          },
        });
      }
    } else {
      assign(src);
    }
  }
  return result;
}

/** A value together with a copy whose object members were inserted in another order. */
export interface PermutedJson {
  readonly original: JsonValue;
  readonly permuted: JsonValue;
  readonly seed: number;
}

/** Pairs of structurally equal values that differ in insertion order (canonical text must match). */
export function permutedJsonArb(options: JsonValueOptions = {}): fc.Arbitrary<PermutedJson> {
  return fc
    .tuple(jsonValueArb(options), fc.integer({ min: 0, max: 0xffffffff }))
    .map(([original, seed]) => ({
      original,
      permuted: permuteInsertionOrder(original, seed),
      seed,
    }));
}

/** Freeze a value and everything reachable from it (iterative). Returns the same value. */
export function deepFreeze<T>(value: T): T {
  const seen = new Set<object>();
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const cur = stack.pop();
    if ((typeof cur !== "object" && typeof cur !== "function") || cur === null) continue;
    if (seen.has(cur)) continue;
    seen.add(cur);
    Object.freeze(cur);
    for (const key of Reflect.ownKeys(cur)) {
      const desc = Object.getOwnPropertyDescriptor(cur, key);
      if (desc && "value" in desc) stack.push(desc.value);
    }
  }
  return value;
}
