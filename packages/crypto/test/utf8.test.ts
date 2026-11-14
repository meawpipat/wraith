// Feature: s-crypto, Property 2: UTF-8 encoder rejects what has no UTF-8 form
// **Validates: Requirements 4.6**
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ProgrammerError } from "../src/errors.js";
import { tryUtf8Encode, utf8Encode } from "../src/utf8.js";
import { pbt } from "./config.js";

interface PlatformEncoder {
  encode(input: string): Uint8Array;
}
declare const TextEncoder: new () => PlatformEncoder;

/** Well-formed strings: code points only (never lone surrogates), incl. astral, U+0000, U+FFFD. */
const wellFormed = fc.oneof(
  fc.string({ unit: "binary" }),
  fc
    .array(
      fc.oneof(
        fc.constant("\u0000"),
        fc.constant("\uFFFD"),
        fc.constant("\u{10FFFF}"),
        fc
          .integer({ min: 0, max: 0x10ffff })
          .filter((c) => c < 0xd800 || c > 0xdfff)
          .map((c) => String.fromCodePoint(c)),
      ),
    )
    .map((parts) => parts.join("")),
);

const loneHigh = fc.integer({ min: 0xd800, max: 0xdbff }).map((c) => String.fromCharCode(c));
const loneLow = fc.integer({ min: 0xdc00, max: 0xdfff }).map((c) => String.fromCharCode(c));
const reversedPair = fc.tuple(loneLow, loneHigh).map(([lo, hi]) => lo + hi);

// Context uses CJK ideographs only so no input character can occur in the fixed error message.
const context = fc.string({
  unit: fc.integer({ min: 0x4e00, max: 0x9fff }).map((c) => String.fromCharCode(c)),
});

/** A string with a lone surrogate (or reversed low+high pair) injected at an arbitrary position. */
const withLoneSurrogate = fc
  .tuple(context, context, fc.oneof(loneHigh, loneLow, reversedPair))
  .map(([a, b, bad]) => ({ text: a + bad + b, a, b, bad }));

describe("Property 2: UTF-8 encoder rejects what has no UTF-8 form", () => {
  it("well-formed strings encode exactly like the platform TextEncoder", () => {
    pbt(
      fc.property(wellFormed, (s) => {
        const expected = new TextEncoder().encode(s);
        expect(Array.from(utf8Encode(s))).toEqual(Array.from(expected));
        const t = tryUtf8Encode(s);
        expect(t).not.toBeNull();
        expect(Array.from(t as Uint8Array)).toEqual(Array.from(expected));
      }),
    );
  });

  it("a lone surrogate throws lone_surrogate, try returns null, message leaks nothing", () => {
    pbt(
      fc.property(withLoneSurrogate, ({ text, a, b, bad }) => {
        let thrown: unknown;
        try {
          utf8Encode(text);
        } catch (e) {
          thrown = e;
        }
        expect(thrown).toBeInstanceOf(ProgrammerError);
        const err = thrown as ProgrammerError;
        expect(err.reason).toBe("lone_surrogate");
        for (const frag of [text, a, b, bad, ...bad]) {
          if (frag.length > 0) expect(err.message.includes(frag)).toBe(false);
        }
        expect(tryUtf8Encode(text)).toBeNull();
      }),
    );
  });

  it("U+FFFD is never substituted: a lone surrogate never yields EF BF BD output", () => {
    expect(() => utf8Encode("\uD800")).toThrow(ProgrammerError);
    expect(() => utf8Encode("\uDC00\uD800")).toThrow(ProgrammerError);
    expect(tryUtf8Encode("a\uDC00")).toBeNull();
    // A genuine U+FFFD is fine and encodes to EF BF BD.
    expect(Array.from(utf8Encode("\uFFFD"))).toEqual([0xef, 0xbf, 0xbd]);
  });
});
