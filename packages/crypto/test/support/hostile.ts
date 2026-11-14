// Hostile-value builders and arbitraries shared by Properties 5 and 12 (R3.8, R6.10, R13.10).
// Portable: no `node:` import and no import from `src` (the oracle here is independent of the code under test).
import fc from "fast-check";

// ---------------------------------------------------------------------------------------------
// Strings with lone surrogates
// ---------------------------------------------------------------------------------------------

/** Lone surrogate strings: a lone high, a lone low, a reversed pair, and one embedded in text. */
export const LONE_SURROGATE_STRINGS: readonly string[] = [
  "\ud800",
  "\udbff",
  "\udc00",
  "\udfff",
  "\udc00\ud800",
  "a\ud800b",
  "\ud800\ud800",
  "x\udc00",
];

/** True when `s` has an unpaired UTF-16 surrogate. */
export function hasLoneSurrogate(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        i++;
      } else {
        return true;
      }
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return true;
    }
  }
  return false;
}

/** Strings that always contain a lone surrogate (usable as values and as property names). */
export const loneSurrogateStringArb: fc.Arbitrary<string> = fc.constantFrom(
  ...LONE_SURROGATE_STRINGS,
);

// ---------------------------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------------------------

/** An object whose own enumerable accessor `trap` throws on read; `plain` is an ordinary member. */
export function throwingGetterObject(): Record<string, unknown> {
  const o: Record<string, unknown> = { plain: 1 };
  Object.defineProperty(o, "trap", {
    enumerable: true,
    configurable: true,
    get(): never {
      throw new Error("hostile getter");
    },
  });
  return o;
}

/** A getter that counts invocations, to show a consumer never ran it. */
export function countingGetterObject(): { value: Record<string, unknown>; reads: () => number } {
  let reads = 0;
  const o: Record<string, unknown> = {};
  Object.defineProperty(o, "g", {
    enumerable: true,
    configurable: true,
    get(): number {
      reads++;
      return 1;
    },
  });
  return { value: o, reads: () => reads };
}

export const PROXY_TRAPS = [
  "get",
  "ownKeys",
  "getPrototypeOf",
  "has",
  "getOwnPropertyDescriptor",
] as const;
export type ProxyTrap = (typeof PROXY_TRAPS)[number];

/** A proxy over `target` whose `trap` throws; the other traps fall through to the target. */
export function throwingProxy(trap: ProxyTrap, target: object = {}): object {
  const handler: ProxyHandler<object> = {};
  handler[trap] = (): never => {
    throw new Error(`hostile ${trap} trap`);
  };
  return new Proxy(target, handler);
}

/** A proxy whose every listed trap throws. */
export function fullyHostileProxy(target: object = {}): object {
  const handler: ProxyHandler<object> = {};
  for (const trap of PROXY_TRAPS) {
    handler[trap] = (): never => {
      throw new Error(`hostile ${trap} trap`);
    };
  }
  return new Proxy(target, handler);
}

/** An object that references itself. */
export function cyclicObject(): Record<string, unknown> {
  const o: Record<string, unknown> = { a: 1 };
  o.self = o;
  return o;
}

/** An array that contains itself. */
export function cyclicArray(): unknown[] {
  const a: unknown[] = [1];
  a.push(a);
  return a;
}

/** A cycle through two objects and an array: a -> b -> [a]. */
export function indirectCycle(): Record<string, unknown> {
  const a: Record<string, unknown> = {};
  const list: unknown[] = [a];
  const b: Record<string, unknown> = { list };
  a.b = b;
  return a;
}

/** A shared sub-object used twice (a DAG). It is NOT a cycle and is legal JSON. */
export function dagNotCycle(): { value: Record<string, unknown>; shared: Record<string, unknown> } {
  const shared: Record<string, unknown> = { n: 1, s: "x" };
  const value: Record<string, unknown> = { left: shared, right: shared, list: [shared, shared] };
  return { value, shared };
}

/** A diamond of arrays (also a DAG, not a cycle). */
export function dagArrays(): unknown[] {
  const shared: unknown[] = [1, 2];
  return [shared, [shared], shared];
}

export class HostileInstance {
  public readonly a = 1;
  public b = "b";
}

/** Very deep nesting, built iteratively (never recursive). Depth 0 is the bare leaf. */
export function deepNesting(
  depth: number,
  kind: "array" | "object" = "array",
  leaf: unknown = 0,
): unknown {
  let current: unknown = leaf;
  for (let i = 0; i < depth; i++) {
    current = kind === "array" ? [current] : { k: current };
  }
  return current;
}

/** Deeply nested structure that ends in a cycle back to the outermost container. */
export function deepCycle(depth: number): unknown {
  const root: unknown[] = [];
  let current: unknown[] = root;
  for (let i = 0; i < depth; i++) {
    const next: unknown[] = [];
    current.push(next);
    current = next;
  }
  current.push(root);
  return root;
}

/** Object with a null prototype (a plain record for JSON purposes). */
export function nullPrototypeObject(
  members: Record<string, unknown> = { a: 1 },
): Record<string, unknown> {
  const o = Object.create(null) as Record<string, unknown>;
  for (const k of Object.keys(members)) {
    o[k] = members[k];
  }
  return o;
}

/** Object whose prototype is another object (not Object.prototype and not null). */
export function foreignPrototypeObject(): object {
  const proto = { inherited: true };
  const o = Object.create(proto) as Record<string, unknown>;
  o.own = 1;
  return o;
}

/** Plain object with a symbol-keyed own property. */
export function symbolKeyedObject(): Record<string | symbol, unknown> {
  return { a: 1, [Symbol("k")]: 2 };
}

/** Plain object with a non-enumerable own property. */
export function nonEnumerableObject(): Record<string, unknown> {
  const o: Record<string, unknown> = { a: 1 };
  Object.defineProperty(o, "hidden", {
    value: 2,
    enumerable: false,
    configurable: true,
    writable: true,
  });
  return o;
}

/** Array with a hole at `index`. */
export function sparseArray(length = 3, index = 1): unknown[] {
  const a: unknown[] = [];
  for (let i = 0; i < length; i++) {
    a.push(i);
  }
  delete a[index];
  return a;
}

/** Array with an extra own (non-index) property. */
export function arrayWithExtraKey(): unknown[] {
  const a: unknown[] = [1, 2];
  (a as unknown as Record<string, unknown>).extra = true;
  return a;
}

/** Array with a foreign prototype. */
export function arrayWithForeignPrototype(): unknown[] {
  const a: unknown[] = [1, 2];
  Object.setPrototypeOf(a, { custom: true });
  return a;
}

// ---------------------------------------------------------------------------------------------
// Catalogue of hostile values and their arbitraries
// ---------------------------------------------------------------------------------------------

/** Hostile leaves: every value is a Non_JSON_Value on its own (no containers). */
export function nonJsonLeaves(): unknown[] {
  return [
    undefined,
    () => 1,
    function named() {
      return 2;
    },
    class K {},
    Symbol("s"),
    Symbol.for("registered"),
    1n,
    -(2n ** 70n),
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    new Date(0),
    new Date(Number.NaN),
    new Map([["a", 1]]),
    new Set([1]),
    new Uint8Array([1, 2]),
    new Float64Array([1.5]),
    new ArrayBuffer(2),
    new Number(1),
    new String("s"),
    new Boolean(true),
    Object(1n),
    Object(Symbol("boxed")),
    new HostileInstance(),
    /re/u,
    new Error("e"),
    Promise.resolve(1),
    new WeakMap(),
    foreignPrototypeObject(),
    ...LONE_SURROGATE_STRINGS,
  ];
}

/** Hostile containers (objects that must be rejected or must make verification fail). */
export function hostileContainers(): unknown[] {
  return [
    throwingGetterObject(),
    ...PROXY_TRAPS.map((t) => throwingProxy(t)),
    ...PROXY_TRAPS.map((t) => throwingProxy(t, [])),
    fullyHostileProxy(),
    cyclicObject(),
    cyclicArray(),
    indirectCycle(),
    deepCycle(50),
    symbolKeyedObject(),
    nonEnumerableObject(),
    sparseArray(),
    arrayWithExtraKey(),
    arrayWithForeignPrototype(),
    { [LONE_SURROGATE_STRINGS[0] as string]: 1 },
    { nested: { list: [1, undefined] } },
    { nested: { value: 1n } },
  ];
}

const ANYTHING = fc.anything({
  withBigInt: true,
  withDate: true,
  withMap: true,
  withSet: true,
  withTypedArray: true,
  withSparseArray: true,
  withNullPrototype: true,
  withBoxedValues: true,
  withObjectString: true,
});

function isProxyLike(v: unknown): boolean {
  // Containers that fast-check itself would trip over when it inspects a generated value.
  return typeof v === "object" && v !== null && !isPlainInspectable(v);
}

function isPlainInspectable(v: object): boolean {
  try {
    Object.getPrototypeOf(v);
    Reflect.ownKeys(v);
    "x" in v;
    (v as Record<string, unknown>).x;
    Object.getOwnPropertyDescriptor(v, "x");
    return true;
  } catch {
    return false;
  }
}

const SAFE_CONTAINER_INDEXES: readonly number[] = hostileContainers()
  .map((v, i) => (isProxyLike(v) ? -1 : i))
  .filter((i) => i >= 0);

/**
 * Factories for every hostile value, proxies with throwing traps included. fast-check inspects each
 * generated value (it probes for a clone method through `in` and `get`), which a throwing proxy would
 * break inside the library, so these arbitraries yield thunks; call the thunk inside the property.
 */
export const hostileThunkArb: fc.Arbitrary<() => unknown> = fc.oneof(
  fc.nat(nonJsonLeaves().length - 1).map((i) => () => nonJsonLeaves()[i]),
  fc.nat(hostileContainers().length - 1).map((i) => () => hostileContainers()[i]),
  fc.integer({ min: 1, max: 5000 }).map((d) => () => deepNesting(d, "array", Symbol("leaf"))),
  fc.integer({ min: 1, max: 5000 }).map((d) => () => deepNesting(d, "object", 1n)),
);

/** Very deep but otherwise valid JSON (arrays or objects): a verifier must still answer, not overflow. */
export const deepValidThunkArb: fc.Arbitrary<() => unknown> = fc
  .tuple(fc.integer({ min: 1, max: 20000 }), fc.constantFrom<"array" | "object">("array", "object"))
  .map(
    ([d, kind]) =>
      () =>
        deepNesting(d, kind),
  );

/** Thunks over hostile values and over `fc.anything` with every exotic option enabled (Property 12). */
export const anyHostileOrAnythingThunkArb: fc.Arbitrary<() => unknown> = fc.oneof(
  hostileThunkArb,
  deepValidThunkArb,
  ANYTHING.map((v) => () => v),
);

/**
 * Hostile values that are safe for fast-check to hold directly: every hostile leaf and container except
 * the throwing proxies (use the thunk arbitraries for those).
 */
export const hostileValueArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.nat(nonJsonLeaves().length - 1).map((i) => nonJsonLeaves()[i]),
  fc.constantFrom(...SAFE_CONTAINER_INDEXES).map((i) => hostileContainers()[i]),
  fc.integer({ min: 1, max: 5000 }).map((d) => deepNesting(d, "array", Symbol("leaf"))),
  fc.integer({ min: 1, max: 5000 }).map((d) => deepNesting(d, "object", 1n)),
);

/** Safe hostile values (no throwing proxies) or any exotic `fc.anything` value. */
export const anyHostileOrAnythingArb: fc.Arbitrary<unknown> = fc.oneof(hostileValueArb, ANYTHING);

// ---------------------------------------------------------------------------------------------
// Substitution of one position of a JSON value by a Non_JSON_Value (Property 5)
// ---------------------------------------------------------------------------------------------

/** Replace a position by a reference to its own parent (a cyclic reference). */
export const CYCLE_REFERENCE: unique symbol = Symbol("cycle-reference");
/** Replace an array element by a hole. */
export const SPARSE_HOLE: unique symbol = Symbol("sparse-hole");
/** Replace a member by an accessor property whose getter throws. */
export const ACCESSOR_PROPERTY: unique symbol = Symbol("accessor-property");

export type Substitution = unknown;

/** Substitutions that substituteNonJson understands in addition to concrete values. */
export const SUBSTITUTION_SENTINELS: readonly symbol[] = [
  CYCLE_REFERENCE,
  SPARSE_HOLE,
  ACCESSOR_PROPERTY,
];

/** Arbitrary for the `hostile` argument of substituteNonJson: concrete leaves plus the sentinels. */
export const substitutionArb: fc.Arbitrary<Substitution> = fc.oneof(
  fc.nat(nonJsonLeaves().length - 1).map((i) => nonJsonLeaves()[i]),
  fc.constantFrom<Substitution>(...SUBSTITUTION_SENTINELS),
);

export interface SubstituteResult {
  /** The JSON value with one position replaced; the input is never mutated. */
  value: unknown;
  /** True when the result is hostile according to the independent scan below. */
  hostile: boolean;
  /** What was replaced: an object property value, an array element, a property name, or the root. */
  position: "value" | "element" | "name" | "root";
}

type Container = Record<string, unknown> | unknown[];
interface Slot {
  parent: Container;
  key: string | number;
  kind: "value" | "element" | "name";
}

function isContainer(v: unknown): v is Container {
  return typeof v === "object" && v !== null;
}

/** Iterative structural copy of a JSON value, collecting every slot of the copy. */
function cloneJson(value: unknown): { root: unknown; slots: Slot[] } {
  const slots: Slot[] = [];
  if (!isContainer(value)) {
    return { root: value, slots };
  }
  const makeEmpty = (v: Container): Container => (Array.isArray(v) ? [] : {});
  const root = makeEmpty(value);
  const stack: Array<{ src: Container; dst: Container }> = [{ src: value, dst: root }];
  for (let frame = stack.pop(); frame !== undefined; frame = stack.pop()) {
    const { src, dst } = frame;
    if (Array.isArray(src)) {
      const out = dst as unknown[];
      for (let i = 0; i < src.length; i++) {
        const item = src[i];
        if (isContainer(item)) {
          const copy = makeEmpty(item);
          out[i] = copy;
          stack.push({ src: item, dst: copy });
        } else {
          out[i] = item;
        }
        slots.push({ parent: out, key: i, kind: "element" });
      }
    } else {
      const out = dst as Record<string, unknown>;
      for (const k of Object.keys(src)) {
        const item = (src as Record<string, unknown>)[k];
        if (isContainer(item)) {
          const copy = makeEmpty(item);
          Object.defineProperty(out, k, {
            value: copy,
            enumerable: true,
            configurable: true,
            writable: true,
          });
          stack.push({ src: item, dst: copy });
        } else {
          Object.defineProperty(out, k, {
            value: item,
            enumerable: true,
            configurable: true,
            writable: true,
          });
        }
        slots.push({ parent: out, key: k, kind: "value" });
        slots.push({ parent: out, key: k, kind: "name" });
      }
    }
  }
  return { root, slots };
}

function throwingAccessorDescriptor(): PropertyDescriptor {
  return {
    enumerable: true,
    configurable: true,
    get(): never {
      throw new Error("hostile accessor");
    },
  };
}

/** Build the root replacement for a sentinel used where there is no slot (the value is a primitive). */
function rootFor(hostile: Substitution): unknown {
  if (hostile === CYCLE_REFERENCE) {
    return cyclicObject();
  }
  if (hostile === SPARSE_HOLE) {
    return sparseArray();
  }
  if (hostile === ACCESSOR_PROPERTY) {
    return throwingGetterObject();
  }
  return hostile;
}

/**
 * Replace one position of the JSON value `json` by a Non_JSON_Value. `choice` is any non-negative
 * integer (typically an `fc.nat()`); the slot is `choice % slotCount`. Slots are every object member
 * value, every array element and every object property name. A name slot ignores `hostile` and renames
 * the member to a lone surrogate string. A value without any slot (a primitive, empty container) is
 * replaced at the root.
 */
export function substituteNonJson(
  json: unknown,
  choice: number,
  hostile: Substitution,
): SubstituteResult {
  const { root, slots } = cloneJson(json);
  if (slots.length === 0) {
    const value = rootFor(hostile);
    return { value, hostile: scanHostile(value), position: "root" };
  }
  const slot = slots[Math.abs(Math.trunc(choice)) % slots.length] as Slot;
  const { parent, key, kind } = slot;
  if (kind === "name") {
    const obj = parent as Record<string, unknown>;
    const oldKey = key as string;
    const bad = typeof hostile === "string" && hasLoneSurrogate(hostile) ? hostile : "\ud800";
    const member = Object.getOwnPropertyDescriptor(obj, oldKey) as PropertyDescriptor;
    delete obj[oldKey];
    Object.defineProperty(obj, bad, member);
  } else if (hostile === CYCLE_REFERENCE) {
    (parent as Record<string | number, unknown>)[key] = parent;
  } else if (hostile === SPARSE_HOLE) {
    if (Array.isArray(parent)) {
      delete parent[key as number];
    } else {
      delete (parent as Record<string, unknown>)[key as string];
      (parent as Record<string, unknown>)[key as string] = undefined;
    }
  } else if (hostile === ACCESSOR_PROPERTY) {
    Object.defineProperty(parent, key, throwingAccessorDescriptor());
  } else {
    (parent as Record<string | number, unknown>)[key] = hostile;
  }
  return { value: root, hostile: scanHostile(root), position: kind === "name" ? "name" : kind };
}

// ---------------------------------------------------------------------------------------------
// Independent oracle: is this value a Non_JSON_Value anywhere? (never throws)
// ---------------------------------------------------------------------------------------------

/** True when `value` is, or contains anywhere, something that is not a JSON_Value. Never throws. */
export function scanHostile(value: unknown): boolean {
  try {
    return scan(value);
  } catch {
    return true;
  }
}

function scalarIsHostile(v: unknown): boolean {
  switch (typeof v) {
    case "string":
      return hasLoneSurrogate(v);
    case "number":
      return !Number.isFinite(v);
    case "boolean":
      return false;
    case "object":
      return false;
    default:
      return true; // undefined, function, symbol, bigint
  }
}

interface ScanFrame {
  obj: object;
  keys: Array<string | symbol>;
  index: number;
}

function enter(obj: object): ScanFrame | undefined {
  const proto = Object.getPrototypeOf(obj) as unknown;
  const keys = Reflect.ownKeys(obj);
  // Probe the `has`, `get` and `getOwnPropertyDescriptor` traps like JSON.stringify does; a throwing trap makes the value hostile.
  Reflect.has(obj, "toJSON");
  Reflect.get(obj, "toJSON");
  Reflect.getOwnPropertyDescriptor(obj, "toJSON");
  if (Array.isArray(obj)) {
    if (proto !== Array.prototype) {
      return undefined;
    }
    // Own keys must be exactly the indices 0..n-1 plus `length`: no holes, no extra keys.
    if (keys.length !== obj.length + 1) {
      return undefined;
    }
    for (let i = 0; i < obj.length; i++) {
      if (!Object.hasOwn(obj, i)) {
        return undefined;
      }
    }
  } else if (proto !== Object.prototype && proto !== null) {
    return undefined;
  }
  return { obj, keys, index: 0 };
}

function scan(root: unknown): boolean {
  if (!isContainer(root)) {
    return scalarIsHostile(root);
  }
  const first = enter(root);
  if (first === undefined) {
    return true;
  }
  const path = new Set<object>([root]);
  const stack: ScanFrame[] = [first];
  while (stack.length > 0) {
    const frame = stack[stack.length - 1] as ScanFrame;
    const key = frame.keys[frame.index++];
    if (key === undefined) {
      path.delete(frame.obj);
      stack.pop();
      continue;
    }
    if (typeof key === "symbol") {
      return true;
    }
    const desc = Object.getOwnPropertyDescriptor(frame.obj, key) as PropertyDescriptor;
    if (key === "length" && Array.isArray(frame.obj)) {
      continue;
    }
    if (!desc.enumerable || !("value" in desc)) {
      return true;
    }
    if (!Array.isArray(frame.obj) && hasLoneSurrogate(key)) {
      return true;
    }
    const v = desc.value as unknown;
    if (isContainer(v)) {
      if (path.has(v)) {
        return true;
      }
      const next = enter(v);
      if (next === undefined) {
        return true;
      }
      path.add(v);
      stack.push(next);
    } else if (scalarIsHostile(v)) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// R3.8 inputs
// ---------------------------------------------------------------------------------------------

export interface HostileVerifyInput {
  name: string;
  /** Which argument of verify the value is meant for. */
  slot: "scope" | "signature" | "key";
  value: unknown;
}

function scopeWith(meta: unknown, body: unknown): Record<string, unknown> {
  return { v: 1, meta, body };
}

const VALID_META = { id: "m1", t: "ping", ts: 0 };

function cyclicScope(): Record<string, unknown> {
  const scope = scopeWith({ ...VALID_META }, {});
  (scope.body as Record<string, unknown>).back = scope;
  return scope;
}

/** The R3.8 inputs. Values are rebuilt on every access so no test can leak mutation into another. */
export function hostileVerifyInputs(): HostileVerifyInput[] {
  const b64 = (n: number): string => "A".repeat(Math.ceil((n * 4) / 3));
  return [
    { name: "undefined scope", slot: "scope", value: undefined },
    { name: "null scope", slot: "scope", value: null },
    { name: "number scope", slot: "scope", value: 42 },
    { name: "string scope", slot: "scope", value: "scope" },
    { name: "empty object scope", slot: "scope", value: {} },
    { name: "array scope", slot: "scope", value: [] },
    { name: "cyclic object scope", slot: "scope", value: cyclicObject() },
    { name: "cyclic scope (body points to scope)", slot: "scope", value: cyclicScope() },
    { name: "scope with meta missing", slot: "scope", value: { v: 1, body: {} } },
    { name: "scope with a bigint", slot: "scope", value: scopeWith({ ...VALID_META }, { n: 1n }) },
    {
      name: "scope with NaN",
      slot: "scope",
      value: scopeWith({ ...VALID_META }, { n: Number.NaN }),
    },
    {
      name: "scope with undefined member",
      slot: "scope",
      value: scopeWith({ ...VALID_META }, { n: undefined }),
    },
    {
      name: "scope with throwing getter",
      slot: "scope",
      value: scopeWith({ ...VALID_META }, throwingGetterObject()),
    },
    { name: "scope that is a throwing proxy", slot: "scope", value: throwingProxy("get") },
    { name: "non-string signature (number)", slot: "signature", value: 1 },
    { name: "non-string signature (object)", slot: "signature", value: { alg: "ES256" } },
    { name: "signature of 63 decoded bytes", slot: "signature", value: b64(63) },
    { name: "signature of 65 decoded bytes", slot: "signature", value: b64(65) },
    { name: "padded signature", slot: "signature", value: `${b64(64)}==` },
    {
      name: "public key with d",
      slot: "key",
      value: { kty: "EC", crv: "P-256", x: b64(32), y: b64(32), d: b64(32) },
    },
    {
      name: "key on another curve",
      slot: "key",
      value: { kty: "EC", crv: "P-384", x: b64(48), y: b64(48) },
    },
    { name: "key with a missing x", slot: "key", value: { kty: "EC", crv: "P-256", y: b64(32) } },
    { name: "key that is null", slot: "key", value: null },
  ];
}

/** The same list as a constant, for tests that never mutate their inputs. */
export const HOSTILE_VERIFY_INPUTS: readonly HostileVerifyInput[] = hostileVerifyInputs();
