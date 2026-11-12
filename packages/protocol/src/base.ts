/**
 * Base value schemas (R4, R9.3, R9.8, R15.2). Defined once and shared by every body.
 * Imports limits.ts and text.ts only. Numeric limits come from limits.ts; lengths that
 * limits.ts does not name are expressed in the regular expression itself.
 */
import { z } from "zod";
import { REQUIRES_MAX_COUNT } from "./limits.js";

/** 26-character Crockford base32 ULID. */
export const Ulid = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/);
export type Ulid = z.infer<typeof Ulid>;

/** Member identifier, 1 to 64 code points (the bound lives in the regex). */
export const MemberId = z.string().regex(/^[\s\S]{1,64}$/u);
export type MemberId = z.infer<typeof MemberId>;

/** `nodeId/paneId`. */
export const PaneRef = z.string().regex(/^[a-z0-9-]+\/[A-Za-z0-9:_-]+$/);
export type PaneRef = z.infer<typeof PaneRef>;

/** Routing target: `relay`, `devices`, or a `device:`, `node:` or `bot:` address. */
export const To = z.union([
  z.literal("relay"),
  z.literal("devices"),
  z.string().regex(/^(?:device|node|bot):/),
]);
export type To = z.infer<typeof To>;

export const PromptKind = z.enum(["task", "return", "summary"]);
export type PromptKind = z.infer<typeof PromptKind>;

export const CapTag = z.enum([
  "gpu",
  "local-files",
  "cloud",
  "autonomous",
  "git-only",
  "can-approve",
  "private",
  "untrusted",
  "no-handoff",
]);
export type CapTag = z.infer<typeof CapTag>;

export const PromptMeta = z.object({
  promptId: Ulid,
  replyTo: Ulid.nullable(),
  kind: PromptKind,
  to: Ulid,
  requires: z.array(CapTag).max(REQUIRES_MAX_COUNT).default([]),
  handoffMode: z.enum(["assign", "transfer"]).default("assign"),
});
export type PromptMeta = z.infer<typeof PromptMeta>;

/** Bot `name` (architecture §4.8 name rule; used by P1-D13). */
export const BotName = z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/);
export type BotName = z.infer<typeof BotName>;

/** Folder name used by `bot.spawn.createFolder` (R9.8). */
export const FolderName = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);
export type FolderName = z.infer<typeof FolderName>;

/** File base name for uploads (R15.2). */
export const Basename = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._ -]{0,199}$/);
export type Basename = z.infer<typeof Basename>;
