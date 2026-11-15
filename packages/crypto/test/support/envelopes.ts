// Signed-envelope test support (task 5.6; R13.4, R13.5, R13.13).
// Portable: no `node:` import; imports `src` modules directly. Declares no message shape:
// envelopes are plain records and the type list is read from MESSAGE_TYPES.
//
// fast-check arbitraries cannot be async, so signing is a separate step: `signedEnvelopeArb`
// yields an `UnsignedCase` (envelope with the protocol's placeholder `sig`, if any, plus a pool
// index) and `signCase` replaces `sig` with a real signature. `bot.tool` interim envelopes
// carry no `sig` by protocol rule; here they are signed anyway so every type exercises the
// crypto path (the crypto layer does not look at the protocol's signer table).
import { MESSAGE_TYPES, type MessageType } from "@wraith/protocol";
import {
  ENVELOPE_ARBITRARIES,
  validEnvelopeArb,
  validRawEnvelopeArb,
} from "@wraith/protocol/testing/arbitraries";
import fc from "fast-check";
import { sign } from "../../src/sign.js";
import { referenceCanonicalize } from "./jcs-reference.js";
import { getKeyPool, type PoolKey } from "./keys.js";

export type { MessageType };
export { ENVELOPE_ARBITRARIES, MESSAGE_TYPES, validEnvelopeArb, validRawEnvelopeArb };

/** Deterministic samples without a numeric `numRuns` literal in test sources. */
export function sampleMany<T>(arb: fc.Arbitrary<T>, count: number, seed: number): T[] {
  return fc.sample(arb, { numRuns: count, seed });
}

/** One deterministic sample. */
export function sampleOne<T>(arb: fc.Arbitrary<T>, seed: number): T {
  return sampleMany(arb, 1, seed)[0] as T;
}

/** Number of pool keys the envelope helpers draw from. */
export const ENVELOPE_KEY_POOL_SIZE = 3;

/** A plain JSON-like record. */
export type Rec = Record<string, unknown>;

/** A generated envelope that still carries the protocol placeholder `sig` (or none). */
export type UnsignedCase = { type: MessageType; envelope: Rec; keyIndex: number };

/** An envelope with a real signature and the key material to verify and re-sign it. */
export type SignedCase = {
  type: MessageType;
  envelope: Rec;
  key: PoolKey;
  memberId: string;
};

/** The member id copied into `sig.by` by the helpers. */
export const TEST_MEMBER_ID = "member-test";

/** Arbitrary of unsigned cases for `type`, or for any entry of MESSAGE_TYPES. */
export function signedEnvelopeArb(type?: MessageType, raw = false): fc.Arbitrary<UnsignedCase> {
  const types: readonly MessageType[] = type === undefined ? MESSAGE_TYPES : [type];
  const keyIndex = fc.integer({ min: 0, max: ENVELOPE_KEY_POOL_SIZE - 1 });
  return fc.constantFrom(...types).chain((t) =>
    fc.tuple(raw ? validRawEnvelopeArb(t) : validEnvelopeArb(t), keyIndex).map(([envelope, k]) => ({
      type: t,
      envelope: envelope as unknown as Rec,
      keyIndex: k,
    })),
  );
}

/** Replaces `sig` of the case with a real ES256 signature over `{v, meta, body}`. */
export async function signCase(c: UnsignedCase): Promise<SignedCase> {
  const key = (await getKeyPool(ENVELOPE_KEY_POOL_SIZE))[c.keyIndex] as PoolKey;
  const sig = await sign(key.pair.privateKey, TEST_MEMBER_ID, {
    v: 1,
    meta: c.envelope.meta,
    body: c.envelope.body,
  });
  return {
    type: c.type,
    envelope: { ...c.envelope, sig },
    key,
    memberId: TEST_MEMBER_ID,
  };
}

/** One sampled, really signed envelope per entry of MESSAGE_TYPES, in registry order. */
export async function signedEnvelopesForAllTypes(seed = 1): Promise<SignedCase[]> {
  const out: SignedCase[] = [];
  for (const type of MESSAGE_TYPES) {
    out.push(await signCase(sampleOne(signedEnvelopeArb(type), seed)));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Mutations of the {meta, body} tree
// ---------------------------------------------------------------------------

export const MUTATION_KINDS = [
  "changed-leaf",
  "added-member",
  "removed-member",
  "renamed-member",
  "changed-element",
  "added-element",
  "removed-element",
  "type-change",
] as const;
export type MutationKind = (typeof MUTATION_KINDS)[number];

/** The signed part of an envelope. */
export type ScopeTree = { meta: unknown; body: unknown };

export type Mutation = {
  kind: MutationKind;
  /** Path from the `{meta, body}` root, first segment is "meta" or "body". */
  path: (string | number)[];
  original: ScopeTree;
  mutated: ScopeTree;
};

type Path = (string | number)[];

function isObj(v: unknown): v is Rec {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Own-property set that is safe for `__proto__`. */
function setOwn(target: Rec, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

/** Deep copy that keeps an own `__proto__` member as an own member. */
export function cloneJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneJson);
  if (isObj(value)) {
    const out: Rec = {};
    for (const key of Object.keys(value)) {
      setOwn(out, key, cloneJson(Object.getOwnPropertyDescriptor(value, key)?.value));
    }
    return out;
  }
  return value;
}

/** Every path below the root (root itself excluded), depth-first. */
export function listPaths(tree: ScopeTree): Path[] {
  const out: Path[] = [];
  const walk = (value: unknown, path: Path) => {
    if (path.length > 0) out.push(path);
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) walk(value[i], [...path, i]);
    } else if (isObj(value)) {
      for (const k of Object.keys(value)) {
        walk(Object.getOwnPropertyDescriptor(value, k)?.value, [...path, k]);
      }
    }
  };
  walk(tree, []);
  return out;
}

function getAt(tree: unknown, path: Path): unknown {
  let cur = tree;
  for (const seg of path) {
    cur = Array.isArray(cur)
      ? cur[seg as number]
      : Object.getOwnPropertyDescriptor(cur as Rec, String(seg))?.value;
  }
  return cur;
}

function changedValue(v: unknown): unknown {
  if (typeof v === "string") return `${v}x`;
  if (typeof v === "number") return Number.isSafeInteger(v) && v < 2 ** 52 ? v + 1 : 0;
  if (typeof v === "boolean") return !v;
  if (v === null) return false;
  if (Array.isArray(v)) return [...v, null];
  return { ...(v as Rec), __changed: 1 };
}

function otherType(v: unknown): unknown {
  if (typeof v === "string") return 1;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return "x";
  if (v === null) return "null";
  if (Array.isArray(v)) return {};
  return [];
}

function freshKey(obj: Rec, base: string): string {
  let key = base;
  while (Object.hasOwn(obj, key)) key += "_";
  return key;
}

/**
 * Applies `kind` at `path` to a copy of `tree`. Returns undefined when the kind does not fit
 * the node. `seed` picks the member or element and whether an added key is `__proto__`.
 */
function applyKind(tree: ScopeTree, path: Path, kind: MutationKind, seed: number) {
  const copy = cloneJson(tree) as ScopeTree;
  const node = getAt(copy, path);
  const parent = getAt(copy, path.slice(0, -1));
  const last = path[path.length - 1] as string | number;
  const set = (value: unknown) => {
    if (Array.isArray(parent)) parent[last as number] = value;
    else setOwn(parent as Rec, String(last), value);
  };
  const leaf = !Array.isArray(node) && !isObj(node);
  switch (kind) {
    case "changed-leaf":
      if (!leaf) return undefined;
      set(changedValue(node));
      return copy;
    case "type-change":
      set(otherType(node));
      return copy;
    case "added-member": {
      if (!isObj(node)) return undefined;
      setOwn(node, seed % 3 === 0 ? "__proto__" : freshKey(node, "__added"), seed);
      return copy;
    }
    case "removed-member": {
      if (!isObj(node)) return undefined;
      const keys = Object.keys(node);
      if (keys.length === 0) return undefined;
      delete node[keys[seed % keys.length] as string];
      return copy;
    }
    case "renamed-member": {
      if (!isObj(node)) return undefined;
      const keys = Object.keys(node);
      if (keys.length === 0) return undefined;
      const from = keys[seed % keys.length] as string;
      const value = Object.getOwnPropertyDescriptor(node, from)?.value;
      delete node[from];
      setOwn(node, seed % 2 === 0 ? "__proto__" : freshKey(node, `${from}_renamed`), value);
      return copy;
    }
    case "changed-element": {
      if (!Array.isArray(node) || node.length === 0) return undefined;
      const i = seed % node.length;
      node[i] = changedValue(node[i]);
      return copy;
    }
    case "added-element":
      if (!Array.isArray(node)) return undefined;
      node.splice(seed % (node.length + 1), 0, seed);
      return copy;
    case "removed-element":
      if (!Array.isArray(node) || node.length === 0) return undefined;
      node.splice(seed % node.length, 1);
      return copy;
  }
}

function canonical(tree: ScopeTree): string {
  return referenceCanonicalize(tree);
}

/**
 * Mutation of the `{meta, body}` tree. A node is chosen by an index, then a kind; when the
 * chosen kind does not fit the node, or leaves the canonical bytes unchanged, the next kinds
 * are tried in order (`type-change` always fits), so the result always differs in canonical
 * bytes (checked with the independent reference canonicalizer).
 */
export function mutationArb(envelope: Rec): fc.Arbitrary<Mutation> {
  const original = { meta: envelope.meta, body: envelope.body } as ScopeTree;
  const paths = listPaths(original);
  const before = canonical(original);
  return fc
    .tuple(fc.nat(), fc.integer({ min: 0, max: MUTATION_KINDS.length - 1 }), fc.nat({ max: 1000 }))
    .map(([nodeIndex, kindIndex, seed]) => {
      const path = paths[nodeIndex % paths.length] as Path;
      for (let step = 0; step < MUTATION_KINDS.length; step++) {
        const kind = MUTATION_KINDS[(kindIndex + step) % MUTATION_KINDS.length] as MutationKind;
        const mutated = applyKind(original, path, kind, seed);
        if (mutated !== undefined && canonical(mutated) !== before) {
          return { kind, path, original, mutated };
        }
      }
      throw new Error("mutationArb: no kind changed the canonical bytes");
    });
}

/** The envelope with its `{meta, body}` replaced by the mutated tree; `sig` is kept. */
export function withMutation(envelope: Rec, m: Mutation): Rec {
  return { ...envelope, meta: m.mutated.meta, body: m.mutated.body };
}

// ---------------------------------------------------------------------------
// Recording proxy
// ---------------------------------------------------------------------------

/**
 * Proxy that logs which top-level members are read through get, has,
 * getOwnPropertyDescriptor and (by name) never through ownKeys. `reads()` returns the
 * distinct names in first-read order.
 */
export function recordTopLevelReads(envelope: Rec): { proxy: Rec; reads: () => string[] } {
  const seen: string[] = [];
  const note = (key: string | symbol) => {
    if (typeof key === "string" && !seen.includes(key)) seen.push(key);
  };
  const proxy = new Proxy(envelope, {
    get(target, key, receiver) {
      note(key);
      return Reflect.get(target, key, receiver);
    },
    has(target, key) {
      note(key);
      return Reflect.has(target, key);
    },
    getOwnPropertyDescriptor(target, key) {
      note(key);
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
    ownKeys(target) {
      return Reflect.ownKeys(target);
    },
  });
  return { proxy, reads: () => [...seen] };
}

// ---------------------------------------------------------------------------
// Bit flips
// ---------------------------------------------------------------------------

/** Copy of `bytes` with bit `index` flipped; `index` wraps modulo the bit length. */
export function bitFlip(bytes: Uint8Array, index: number): Uint8Array {
  if (bytes.length === 0) throw new Error("bitFlip: empty input");
  const bit = ((index % (bytes.length * 8)) + bytes.length * 8) % (bytes.length * 8);
  const out = bytes.slice();
  out[bit >> 3] = (out[bit >> 3] as number) ^ (1 << (bit & 7));
  return out;
}

/** Arbitrary of bit indexes for `length` bytes. */
export function bitIndexArb(length: number): fc.Arbitrary<number> {
  return fc.integer({ min: 0, max: Math.max(0, length * 8 - 1) });
}
