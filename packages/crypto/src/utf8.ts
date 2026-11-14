import { ProgrammerError } from "./errors.js";

/** Minimal view of the platform TextEncoder (the package lib has no DOM typings). */
interface Utf8Encoder {
  encode(input: string): Uint8Array;
}
declare const TextEncoder: new () => Utf8Encoder;

function hasLoneSurrogate(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
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

/** Encodes a string as UTF-8; a lone surrogate is a programmer error. */
export function utf8Encode(text: string): Uint8Array {
  if (hasLoneSurrogate(text)) throw new ProgrammerError("lone_surrogate");
  return new TextEncoder().encode(text);
}

/** Like utf8Encode but returns null instead of throwing on a lone surrogate. */
export function tryUtf8Encode(text: string): Uint8Array | null {
  if (hasLoneSurrogate(text)) return null;
  return new TextEncoder().encode(text);
}
