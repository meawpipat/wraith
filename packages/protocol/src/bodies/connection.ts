/**
 * Connection bodies: `ping`, `pong`, `ack` (architecture §6.2). Schemas use the zod default
 * (strip), never `.strict()`.
 */
import { z } from "zod";
import { Ulid } from "../base.js";

/** `ping`: `{ t }`, sent by devices and nodes every 15 s. */
export const PingBody = z.object({ t: z.number().int() });
export type PingBody = z.infer<typeof PingBody>;

/** `pong`: `{ t }`, the auto-response to `ping` (echoes the same `t`). */
export const PongBody = z.object({ t: z.number().int() });
export type PongBody = z.infer<typeof PongBody>;

/** `ack`: relay <-> node/device acknowledgement of message `id`, with an optional `seq`. */
export const AckBody = z.object({ id: Ulid, seq: z.number().int().optional() });
export type AckBody = z.infer<typeof AckBody>;
