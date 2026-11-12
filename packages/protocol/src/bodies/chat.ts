/**
 * Chat bodies: `user.message`, `bot.post`, `bot.tool` (architecture §6.2). Schemas use the
 * zod default (strip), never `.strict()`. Limits come from limits.ts.
 */
import { z } from "zod";
import {
  BOT_TOOL_OUTPUT_MAX_BYTES,
  MEDIA_PER_MESSAGE_MAX_COUNT,
  USER_MESSAGE_TEXT_MAX_CHARS,
} from "../limits.js";
import { Attachment, Diff, Location, MediaRef, ToolKind } from "../shapes.js";
import { maxCodePoints, maxUtf8Bytes } from "../text.js";

/**
 * `user.message`. `text` is at most USER_MESSAGE_TEXT_MAX_CHARS code points. `via: "voice"`
 * marks a confirmed voice transcript (display only on Full devices).
 *
 * Verifier: for cap `watch`, `text` must be in `roster.quickMessages` (at most
 * WATCH_QUICK_MESSAGE_MAX_CHARS) or `via` is "voice" (at most
 * WATCH_VOICE_TRANSCRIPT_MAX_CHARS); `media` is not allowed for `watch`, only in bot chats,
 * and each `mediaId` must belong to the signer (`E_MEDIA_DENIED`). `meta.mentions` is
 * enforced by the relay for bot chats. None of these are checked here.
 */
export const UserMessageBody = z.object({
  text: z.string().superRefine(maxCodePoints(USER_MESSAGE_TEXT_MAX_CHARS)),
  by: z.enum(["phone", "desktop", "watch", "pane-unverified"]),
  attachments: z.array(Attachment).optional(),
  media: z.array(MediaRef).max(MEDIA_PER_MESSAGE_MAX_COUNT).optional(),
  via: z.literal("voice").optional(),
});
export type UserMessageBody = z.infer<typeof UserMessageBody>;

/** `bot.post`: summary posted by a bot through `wraith_post`. */
export const BotPostBody = z.object({ text: z.string() });
export type BotPostBody = z.infer<typeof BotPostBody>;

/** Tool call status, per ACP. */
export const ToolStatus = z.enum(["pending", "in_progress", "completed", "failed"]);
export type ToolStatus = z.infer<typeof ToolStatus>;

/**
 * `bot.tool`. `output` is at most BOT_TOOL_OUTPUT_MAX_BYTES of UTF-8.
 *
 * Verifier: only the final statuses (`completed`, `failed`) are node-signed and stored;
 * `pending` and `in_progress` are unsigned and not persisted. Redaction of `output` is the
 * node's job, not this package's.
 */
export const BotToolBody = z.object({
  toolCallId: z.string(),
  title: z.string(),
  kind: ToolKind,
  status: ToolStatus,
  diffs: z.array(Diff).optional(),
  locations: z.array(Location).optional(),
  output: z.string().superRefine(maxUtf8Bytes(BOT_TOOL_OUTPUT_MAX_BYTES)).optional(),
});
export type BotToolBody = z.infer<typeof BotToolBody>;
