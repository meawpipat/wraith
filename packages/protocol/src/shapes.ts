/**
 * Supporting shapes (R17), part 1. Each shape is defined once here and imported by every body
 * that uses it (R17.7). Limits come from limits.ts, text helpers from text.ts, base values
 * from base.ts. No numeric limit is repeated as a literal.
 */
import { z } from "zod";
import { Basename, Ulid } from "./base.js";
import {
  ATTACHMENT_TEXT_MAX_BYTES,
  MEDIA_NAME_MAX_CHARS,
  MEDIA_THUMB_MAX_BYTES,
} from "./limits.js";
import { base64DecodedLength, maxCodePoints, maxUtf8Bytes, SIZE_MARKER } from "./text.js";

/** Text attachment (R17.2). `text` is at most 8 KB of UTF-8; over the limit maps to E_PAYLOAD_TOO_LARGE. */
export const Attachment = z.object({
  name: z.string(),
  mime: z.string(),
  text: z.string().superRefine(maxUtf8Bytes(ATTACHMENT_TEXT_MAX_BYTES, { sizeMarker: true })),
  truncated: z.boolean(),
});
export type Attachment = z.infer<typeof Attachment>;

/**
 * Media reference (R15.1). `name` is a plain file name: the Basename pattern admits no
 * path separator, and the code point bound comes from MEDIA_NAME_MAX_CHARS. No field holds a
 * filesystem path.
 */
export const MediaRef = z.object({
  mediaId: Ulid,
  node: z.string(),
  name: Basename.superRefine(maxCodePoints(MEDIA_NAME_MAX_CHARS)),
  mime: z.string(),
  bytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  w: z.number().int().positive().optional(),
  h: z.number().int().positive().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  /** Base64 WebP, at most MEDIA_THUMB_MAX_BYTES decoded, or null. */
  thumb: z
    .string()
    .regex(/^[A-Za-z0-9+/]*={0,2}$/)
    .superRefine((s, ctx) => {
      if (base64DecodedLength(s) > MEDIA_THUMB_MAX_BYTES) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `must be at most ${MEDIA_THUMB_MAX_BYTES} bytes decoded`,
          params: { ...SIZE_MARKER },
        });
      }
    })
    .nullable(),
  origin: z.enum(["bot", "device"]),
});
export type MediaRef = z.infer<typeof MediaRef>;

/** Tool kind, per ACP (architecture §6.2). */
export const ToolKind = z.enum([
  "read",
  "edit",
  "delete",
  "move",
  "search",
  "execute",
  "think",
  "fetch",
  "other",
]);
export type ToolKind = z.infer<typeof ToolKind>;

/**
 * PROVISIONAL (design decision 1): `acp-lite` is a stub, so `Location` and `Diff` are written
 * from the ACP tool-call types and must be reviewed against them when S-sprite-acp exists.
 * ACP `ToolCallLocation`: `{ path, line? }`.
 */
export const Location = z.object({
  path: z.string(),
  line: z.number().int().nonnegative().nullish(),
});
export type Location = z.infer<typeof Location>;

/** PROVISIONAL (see Location). ACP diff content: `{ path, oldText?, newText }`. */
export const Diff = z.object({
  path: z.string(),
  oldText: z.string().nullish(),
  newText: z.string(),
});
export type Diff = z.infer<typeof Diff>;
