/**
 * The single message registry (architecture §6.2). One `MessageDef` per `meta.type`; every
 * derived map (MessageType, BODY, SIGNER, MESSAGE_META) is a projection of REGISTRY in
 * message-types.ts, so the key sets cannot drift apart.
 *
 * SUBSET: this file holds only the first eight types (ping, pong, ack, user.message,
 * bot.post, bot.tool, node.configure, node.configured). Tasks 11.1 and 11.2 complete it.
 * Adding a type means adding one entry here and nothing else: the types in this file and in
 * message-types.ts are derived from `REGISTRY`, not from a hand-written list.
 *
 * Cap decisions (which device cap may send a type) are made by the Verifier from §12.2.
 * Mixed rows such as "owner or device" resolve to `device` here. No cap-matrix logic lives
 * in this package.
 */
import type { ZodTypeAny } from "zod";
import { BotPostBody, BotToolBody, UserMessageBody } from "./bodies/chat.js";
import { AckBody, PingBody, PongBody } from "./bodies/connection.js";
import { NodeConfigureBody, NodeConfiguredBody } from "./bodies/node.js";

/** Routes of §6.2 as string literals. D device, N node, R relay, G gateway. */
export type Direction =
  | "D/N↔R"
  | "R↔N/G"
  | "D/N→R"
  | "D→R→N"
  | "N→R→D"
  | "N→R"
  | "R→D"
  | "R→N"
  | "D→R"
  | "D↔R↔N"
  | "N↔R↔D";

/** Exactly five signer kinds (R1.8). */
export type Signer = "device" | "owner" | "node" | "none" | "challenge";

/** Ids of named cross-field checks (envelope.ts). Extended as checks are wired in. */
export type CheckId =
  | "persist-match"
  | "device-target-not-persisted"
  | "to-rule"
  | "bot-tool-sig-match"
  | "takecontrol-window"
  | "nudge-mentions"
  | "rewind-files-hash"
  | "room-name";

/** Addressing rule for `meta.to`, enforced by the envelope `to-rule` check. */
export type ToRule = { readonly kind: "relay" } | { readonly prefix: "device:" };

/** Status-dependent persist/signer rule (only `bot.tool`). */
export type StatusRule = {
  /** Body field holding the status. */
  readonly field: string;
  /** Statuses that take the static `persist` and `signer` of the entry. */
  readonly final: readonly string[];
  /** Statuses that take `interim` instead. */
  readonly interimStatuses: readonly string[];
  readonly interim: { readonly persist: boolean; readonly signer: Signer };
};

export type MessageDef = {
  readonly body: ZodTypeAny;
  readonly direction: Direction;
  /** Static value; for status-dependent types it holds the final-status value. */
  readonly persist: boolean;
  /** Static value; for status-dependent types it holds the final-status value. */
  readonly signer: Signer;
  readonly to?: ToRule;
  readonly byStatus?: StatusRule;
  readonly checks?: readonly CheckId[];
};

export const REGISTRY = {
  ping: { body: PingBody, direction: "D/N↔R", persist: false, signer: "none" },
  pong: { body: PongBody, direction: "D/N↔R", persist: false, signer: "none" },
  ack: { body: AckBody, direction: "R↔N/G", persist: false, signer: "none" },
  "user.message": {
    body: UserMessageBody,
    direction: "D→R→N",
    persist: true,
    signer: "device",
  },
  "bot.post": { body: BotPostBody, direction: "N→R→D", persist: true, signer: "node" },
  // Static values are the final-status values; interim statuses are unsigned and not stored.
  "bot.tool": {
    body: BotToolBody,
    direction: "N→R→D",
    persist: true,
    signer: "node",
    byStatus: {
      field: "status",
      final: ["completed", "failed"],
      interimStatuses: ["pending", "in_progress"],
      interim: { persist: false, signer: "none" },
    },
  },
  "node.configure": {
    body: NodeConfigureBody,
    direction: "D→R→N",
    persist: true,
    signer: "device",
  },
  "node.configured": {
    body: NodeConfiguredBody,
    direction: "N→R→D",
    persist: true,
    signer: "node",
  },
} as const satisfies Record<string, MessageDef>;
