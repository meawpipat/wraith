/**
 * Maps derived from the one REGISTRY (registry.ts). All maps are typed
 * `Record<MessageType, ...>` and are projections of the registry, so their key sets are
 * identical by construction. Adding a registry entry is the only change needed.
 */
import {
  type CheckId,
  type Direction,
  type MessageDef,
  REGISTRY,
  type Signer,
  type StatusRule,
  type ToRule,
} from "./registry.js";

export type MessageType = keyof typeof REGISTRY;

/** Tuple of all type strings, for `z.enum`. */
export const MESSAGE_TYPES = Object.keys(REGISTRY) as unknown as readonly [
  MessageType,
  ...MessageType[],
];

/** Project one `MessageDef` field out of a registry, keeping per-key precision. */
export function project<R extends Record<string, MessageDef>, K extends keyof MessageDef>(
  registry: R,
  key: K,
): { [T in keyof R]: R[T][K] } {
  const out: Record<string, unknown> = {};
  for (const type of Object.keys(registry)) {
    out[type] = (registry[type] as MessageDef)[key];
  }
  return out as { [T in keyof R]: R[T][K] };
}

export const BODY: { [T in MessageType]: (typeof REGISTRY)[T]["body"] } = project(REGISTRY, "body");

/** Static signer per type; for `bot.tool` this is the final-status value. */
export const SIGNER: Record<MessageType, Signer> = project(REGISTRY, "signer");

export type MessageMeta = {
  readonly direction: Direction;
  readonly persist: boolean;
  readonly to?: ToRule;
  readonly byStatus?: StatusRule;
  readonly checks?: readonly CheckId[];
};

const DIRECTION = project(REGISTRY, "direction");
const PERSIST = project(REGISTRY, "persist");

function buildMeta(type: MessageType): MessageMeta {
  const def: MessageDef = REGISTRY[type];
  return {
    direction: DIRECTION[type],
    persist: PERSIST[type],
    ...(def.to !== undefined ? { to: def.to } : {}),
    ...(def.byStatus !== undefined ? { byStatus: def.byStatus } : {}),
    ...(def.checks !== undefined ? { checks: def.checks } : {}),
  };
}

export const MESSAGE_META: Record<MessageType, MessageMeta> = Object.fromEntries(
  MESSAGE_TYPES.map((type) => [type, buildMeta(type)]),
) as Record<MessageType, MessageMeta>;

/**
 * Resolve a status-dependent rule. Returns `undefined` when the body has no recognised
 * status. Never throws.
 */
function resolveByStatus(rule: StatusRule, body: unknown): "final" | "interim" | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const status = (body as Record<string, unknown>)[rule.field];
  if (typeof status !== "string") return undefined;
  if (rule.final.includes(status)) return "final";
  if (rule.interimStatuses.includes(status)) return "interim";
  return undefined;
}

/**
 * Whether a message of `type` with this `body` is persisted. `undefined` for a
 * status-dependent type whose body has no recognised status. Never throws.
 */
export function persistOf(type: MessageType, body?: unknown): boolean | undefined {
  const meta = MESSAGE_META[type];
  if (meta === undefined) return undefined;
  if (meta.byStatus === undefined) return meta.persist;
  const which = resolveByStatus(meta.byStatus, body);
  if (which === undefined) return undefined;
  return which === "final" ? meta.persist : meta.byStatus.interim.persist;
}

/**
 * Who signs a message of `type` with this `body`. `undefined` for a status-dependent type
 * whose body has no recognised status. Never throws.
 */
export function signerOf(type: MessageType, body?: unknown): Signer | undefined {
  const meta = MESSAGE_META[type];
  if (meta === undefined) return undefined;
  if (meta.byStatus === undefined) return SIGNER[type];
  const which = resolveByStatus(meta.byStatus, body);
  if (which === undefined) return undefined;
  return which === "final" ? SIGNER[type] : meta.byStatus.interim.signer;
}
