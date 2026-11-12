/**
 * Envelope, strict Meta and EnvelopeOf (R2, R3.5 to R3.7, R6.3, R8.12).
 *
 * Imports message-types.ts and errors.ts; neither imports this file.
 * Failures are `{ ok: false, code, path }`. `path` holds field names, array indexes, or `*`
 * for free-form record keys only. Zod message text and body values are never forwarded
 * (R2.7, R18.8).
 */
import { z } from "zod";
import { MemberId, PromptMeta, To, Ulid } from "./base.js";
import type { ErrorCode } from "./errors.js";
import { MENTIONS_PER_MESSAGE_MAX_COUNT } from "./limits.js";
import { BODY, MESSAGE_TYPES, type MessageType, persistOf, signerOf } from "./message-types.js";
import type { CheckId } from "./registry.js";

/** Strict envelope metadata (R2.3): an unknown field is a schema failure. */
export const Meta = z
  .object({
    id: Ulid,
    ts: z.number().int().positive(),
    space: z.string(),
    room: z.string().optional(),
    bot: Ulid.optional(),
    node: z.string().optional(),
    epoch: z.number().int().nonnegative().optional(),
    type: z.enum(MESSAGE_TYPES),
    to: To,
    persist: z.boolean(),
    prompt: PromptMeta.optional(),
    mentions: z.array(Ulid).max(MENTIONS_PER_MESSAGE_MAX_COUNT).optional(),
    leaseEpoch: z.number().int().optional(),
  })
  .strict();
export type Meta = z.infer<typeof Meta>;

/** Signature over the signature scope (R3.5). */
export const Sig = z.object({
  by: MemberId,
  alg: z.literal("ES256"),
  value: z.string(),
});
export type Sig = z.infer<typeof Sig>;

/**
 * Fields added by the relay (R3.7).
 *
 * Receivers SHALL NOT use `relay.*` for security decisions (SI-4). `relay.from` is for
 * routing and denial-of-service limits only (R3.6).
 */
export const RelayFields = z.object({
  seq: z.number().int().optional(),
  recvTs: z.number().int(),
  root: Ulid.optional(),
  forwardDepth: z.number().int().nonnegative().optional(),
  budgetLeft: z.number().int().nonnegative().optional(),
  from: MemberId.optional(),
});
export type RelayFields = z.infer<typeof RelayFields>;

/** Base envelope: `body` is untyped here; `EnvelopeOf(type)` narrows it. */
export const Envelope = z.object({
  v: z.literal(1),
  meta: Meta,
  body: z.unknown(),
  sig: Sig.optional(),
  relay: RelayFields.optional(),
});

/** Envelope of one message type: `meta.type` is the literal and `body` is `BODY[type]`. */
type EnvelopeFor<T extends MessageType> = {
  v: 1;
  meta: Omit<Meta, "type"> & { type: T };
  body: z.infer<(typeof BODY)[T]>;
  sig?: Sig | undefined;
  relay?: RelayFields | undefined;
};
export type Envelope<T extends MessageType = MessageType> = T extends MessageType
  ? EnvelopeFor<T>
  : never;

// ---------------------------------------------------------------------------
// Cross-field checks (R2.11). A named table: task 11.3 only appends rows.
// ---------------------------------------------------------------------------

export type CheckInput = {
  readonly type: MessageType;
  readonly meta: Meta;
  readonly body: unknown;
  readonly sig: Sig | undefined;
};

/** A failed check reports the path of the offending field (field names only). */
export type CrossFieldCheck = {
  readonly id: CheckId;
  readonly requirement: string;
  readonly check: (input: CheckInput) => readonly (readonly string[])[];
};

const DEVICE_PREFIX = "device:";

export const CROSS_FIELD_CHECKS: readonly CrossFieldCheck[] = [
  {
    id: "persist-match",
    requirement: "R6.3",
    check: ({ type, meta, body }) =>
      persistOf(type, body) === meta.persist ? [] : [["meta", "persist"]],
  },
  {
    id: "device-target-not-persisted",
    requirement: "R2.8",
    check: ({ meta }) =>
      meta.to.startsWith(DEVICE_PREFIX) && meta.persist ? [["meta", "persist"]] : [],
  },
  {
    id: "bot-tool-sig-match",
    requirement: "R8.12",
    check: ({ type, body, sig }) => {
      if (type !== "bot.tool") return [];
      const signed = signerOf(type, body) === "node";
      return signed === (sig !== undefined) ? [] : [["sig"]];
    },
  },
];

function runChecks(input: CheckInput): (readonly string[])[] {
  const failures: (readonly string[])[] = [];
  for (const entry of CROSS_FIELD_CHECKS) failures.push(...entry.check(input));
  return failures;
}

// ---------------------------------------------------------------------------
// Issue mapping and path sanitising
// ---------------------------------------------------------------------------

type SchemaLike = {
  _def: {
    typeName?: string;
    innerType?: SchemaLike;
    schema?: SchemaLike;
    type?: SchemaLike;
    valueType?: SchemaLike;
    in?: SchemaLike;
    getter?: () => SchemaLike;
    options?: SchemaLike[] | Map<unknown, SchemaLike>;
    items?: SchemaLike[];
    left?: SchemaLike;
    right?: SchemaLike;
    shape?: () => Record<string, SchemaLike>;
  };
};

/** Peel wrappers (optional, default, effects, ...) off a schema. */
function unwrap(schema: SchemaLike): SchemaLike {
  let current = schema;
  for (;;) {
    const def = current._def;
    const next =
      def.typeName === "ZodEffects"
        ? def.schema
        : def.typeName === "ZodLazy"
          ? def.getter?.()
          : def.typeName === "ZodPipeline"
            ? def.in
            : def.typeName === "ZodOptional" ||
                def.typeName === "ZodNullable" ||
                def.typeName === "ZodDefault" ||
                def.typeName === "ZodCatch" ||
                def.typeName === "ZodReadonly"
              ? def.innerType
              : def.typeName === "ZodBranded"
                ? def.type
                : undefined;
    if (next === undefined) return current;
    current = next;
  }
}

/** Expand unions and intersections to their member schemas. */
function expand(schema: SchemaLike): SchemaLike[] {
  const inner = unwrap(schema);
  const def = inner._def;
  if (def.typeName === "ZodUnion" || def.typeName === "ZodDiscriminatedUnion") {
    const options = def.options;
    const list = options instanceof Map ? [...options.values()] : (options ?? []);
    return list.flatMap(expand);
  }
  if (def.typeName === "ZodIntersection" && def.left && def.right) {
    return [...expand(def.left), ...expand(def.right)];
  }
  return [inner];
}

/**
 * Keep only segments provable as field names (of an object schema) or array indexes.
 * Anything else (record keys, unknown segments) becomes `*`, so content never leaks.
 */
function sanitizePath(root: z.ZodTypeAny, path: readonly (string | number)[]): string[] {
  let candidates: SchemaLike[] = expand(root as unknown as SchemaLike);
  const out: string[] = [];
  for (const segment of path) {
    const next: SchemaLike[] = [];
    let label = "*";
    for (const candidate of candidates) {
      const def = candidate._def;
      if (typeof segment === "number") {
        if (def.typeName === "ZodArray" && def.type) {
          label = String(segment);
          next.push(...expand(def.type));
        } else if (def.typeName === "ZodTuple" && def.items) {
          const item = def.items[segment];
          if (item) {
            label = String(segment);
            next.push(...expand(item));
          }
        }
      } else if (def.typeName === "ZodObject" && def.shape) {
        const shape = def.shape();
        const field = Object.hasOwn(shape, segment) ? shape[segment] : undefined;
        if (field) {
          label = segment;
          next.push(...expand(field));
        }
      } else if (def.typeName === "ZodRecord" && def.valueType) {
        next.push(...expand(def.valueType));
      }
    }
    out.push(label);
    candidates = next;
  }
  return out;
}

export type Failure = { ok: false; code: ErrorCode; path: readonly string[] };

/**
 * Map zod issues to a failure. A refinement issue carrying `params.wraithCode`
 * `E_PAYLOAD_TOO_LARGE` maps to that code; every other issue maps to `E_SCHEMA_INVALID`.
 * The first issue decides the path. Message text is never read.
 */
export function mapIssues(
  issues: readonly z.ZodIssue[],
  root: z.ZodTypeAny,
  prefix: readonly string[] = [],
): Failure {
  const first = issues[0];
  const marked = issues.find(
    (i) => i.code === z.ZodIssueCode.custom && i.params?.wraithCode === "E_PAYLOAD_TOO_LARGE",
  );
  const code: ErrorCode = marked ? "E_PAYLOAD_TOO_LARGE" : "E_SCHEMA_INVALID";
  const chosen = marked ?? first;
  const path = chosen ? [...prefix, ...sanitizePath(root, chosen.path)] : [...prefix];
  return { ok: false, code, path };
}

// ---------------------------------------------------------------------------
// EnvelopeOf and parseEnvelopeValue
// ---------------------------------------------------------------------------

const envelopeOfCache = new Map<MessageType, z.ZodTypeAny>();

/**
 * Schema for one message type: `meta.type` is the literal, `body` is `BODY[type]`, and the
 * cross-field checks run after the structural parse. Memoised per type.
 */
export function EnvelopeOf<T extends MessageType>(
  type: T,
): z.ZodType<Envelope<T>, z.ZodTypeDef, unknown> {
  const cached = envelopeOfCache.get(type);
  if (cached) return cached as z.ZodType<Envelope<T>, z.ZodTypeDef, unknown>;
  const schema = z
    .object({
      v: z.literal(1),
      meta: Meta.extend({ type: z.literal(type) }),
      body: BODY[type],
      sig: Sig.optional(),
      relay: RelayFields.optional(),
    })
    .superRefine((value, ctx) => {
      const failures = runChecks({
        type,
        meta: value.meta as Meta,
        body: value.body,
        sig: value.sig,
      });
      for (const path of failures) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "cross-field", path: [...path] });
      }
    });
  envelopeOfCache.set(type, schema);
  return schema as unknown as z.ZodType<Envelope<T>, z.ZodTypeDef, unknown>;
}

export type ParseEnvelopeResult = { ok: true; envelope: Envelope } | Failure;

/**
 * Parse an already-decoded JSON value: base envelope, then `BODY[meta.type]`, then the
 * cross-field checks. Same verdict as `EnvelopeOf(type)`. An unknown `meta.type` fails the
 * Meta parse with `E_SCHEMA_INVALID` (R2.10). Never throws.
 */
export function parseEnvelopeValue(value: unknown): ParseEnvelopeResult {
  const base = Envelope.safeParse(value);
  if (!base.success) return mapIssues(base.error.issues, Envelope);
  const { v, meta, sig, relay } = base.data;
  const type = meta.type;
  const body = BODY[type].safeParse(base.data.body);
  if (!body.success) return mapIssues(body.error.issues, BODY[type], ["body"]);
  const failures = runChecks({ type, meta, body: body.data, sig });
  const firstFailure = failures[0];
  if (firstFailure) return { ok: false, code: "E_SCHEMA_INVALID", path: [...firstFailure] };
  const envelope = {
    v,
    meta,
    body: body.data,
    ...(sig !== undefined ? { sig } : {}),
    ...(relay !== undefined ? { relay } : {}),
  } as Envelope;
  return { ok: true, envelope };
}
