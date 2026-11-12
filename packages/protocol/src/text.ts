/**
 * Text counting helpers (R20.3, R22.4). No Buffer, no DOM, no imports from the
 * rest of the package. Character limits count Unicode code points; KB limits on
 * strings count UTF-8 bytes; base64 "decoded" limits count decoded bytes.
 */
import { z } from "zod";

/** Number of Unicode code points in `s` (a surrogate pair counts as one). */
export function codePointLength(s: string): number {
  let count = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) i++;
    }
    count++;
  }
  return count;
}

/** Exact UTF-8 byte length of `s`. A lone surrogate counts as U+FFFD (3 bytes). */
function utf8Exact(s: string): number {
  let bytes = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        bytes += 4;
        i++;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

/**
 * UTF-8 byte length of `s`, or, when `limit` is given, an answer that is only
 * exact up to the limit: returns a value `> limit` if `s` is too large and a
 * value `<= limit` otherwise. Shortcuts: UTF-8 bytes >= UTF-16 length, so
 * `length > limit` is too large; each UTF-16 unit takes at most 3 bytes, so
 * `length * 3 <= limit` is small enough.
 */
export function utf8ByteLength(s: string, limit?: number): number {
  if (limit !== undefined) {
    if (s.length > limit) return s.length;
    if (s.length * 3 <= limit) return s.length * 3;
  }
  return utf8Exact(s);
}

/** Decoded byte length of a base64 string, without decoding. Padding is accounted for. */
export function base64DecodedLength(b64: string): number {
  const len = b64.length;
  if (len === 0) return 0;
  let padding = 0;
  if (b64.charCodeAt(len - 1) === 0x3d) {
    padding = 1;
    if (len > 1 && b64.charCodeAt(len - 2) === 0x3d) padding = 2;
  }
  if (padding > 0) return (len / 4) * 3 - padding;
  // Unpadded: whole groups of 4 chars give 3 bytes; a tail of 2 or 3 chars gives 1 or 2.
  const tail = len % 4;
  return Math.floor(len / 4) * 3 + (tail === 0 ? 0 : tail - 1);
}

/** Size marker carried by refinements so the gate can map them to E_PAYLOAD_TOO_LARGE. */
export const SIZE_MARKER = { wraithCode: "E_PAYLOAD_TOO_LARGE" } as const;

export interface RefinementOptions {
  /** Attach the size marker (`params: { wraithCode: "E_PAYLOAD_TOO_LARGE" }`). */
  readonly sizeMarker?: boolean;
}

function addIssue(
  ctx: z.RefinementCtx,
  message: string,
  opts: RefinementOptions | undefined,
): void {
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message,
    ...(opts?.sizeMarker ? { params: { ...SIZE_MARKER } } : {}),
  });
}

/** `superRefine` callback: at most `n` code points. Use instead of `.max(n)`. */
export function maxCodePoints(n: number, opts?: RefinementOptions) {
  return (s: string, ctx: z.RefinementCtx): void => {
    if (codePointLength(s) > n) addIssue(ctx, `must be at most ${n} characters`, opts);
  };
}

/** `superRefine` callback: at most `n` UTF-8 bytes. */
export function maxUtf8Bytes(n: number, opts?: RefinementOptions) {
  return (s: string, ctx: z.RefinementCtx): void => {
    if (utf8ByteLength(s, n) > n) addIssue(ctx, `must be at most ${n} bytes`, opts);
  };
}
