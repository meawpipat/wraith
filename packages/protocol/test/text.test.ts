import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  base64DecodedLength,
  codePointLength,
  maxCodePoints,
  maxUtf8Bytes,
  SIZE_MARKER,
  utf8ByteLength,
} from "../src/text.ts";

const enc = new TextEncoder();
const LONE_HIGH = "\ud800";
const LONE_LOW = "\udc00";
const ASTRAL = "\u{1F600}"; // 2 UTF-16 units, 4 UTF-8 bytes, 1 code point

describe("codePointLength", () => {
  it("counts ASCII, multi-byte and astral characters", () => {
    expect(codePointLength("")).toBe(0);
    expect(codePointLength("abc")).toBe(3);
    expect(codePointLength("é€")).toBe(2);
    expect(codePointLength(ASTRAL)).toBe(1);
    expect(codePointLength(`a${ASTRAL}b${ASTRAL}`)).toBe(4);
  });

  it("counts each lone surrogate as one code point", () => {
    expect(codePointLength(LONE_HIGH)).toBe(1);
    expect(codePointLength(LONE_LOW)).toBe(1);
    expect(codePointLength(LONE_LOW + LONE_HIGH)).toBe(2);
    expect(codePointLength(`${LONE_HIGH}a`)).toBe(2);
    expect(codePointLength(`${LONE_HIGH}${ASTRAL}`)).toBe(2);
  });
});

describe("utf8ByteLength", () => {
  it("matches TextEncoder for well-formed strings without a limit", () => {
    for (const s of [
      "",
      "abc",
      "é",
      "€",
      ASTRAL,
      `a é €${ASTRAL}z`,
      "\u007f\u0080\u07ff\u0800\uffff",
    ]) {
      expect(utf8ByteLength(s)).toBe(enc.encode(s).length);
    }
  });

  it("counts lone surrogates as 3 bytes (U+FFFD)", () => {
    expect(utf8ByteLength(LONE_HIGH)).toBe(3);
    expect(utf8ByteLength(LONE_LOW)).toBe(3);
    expect(utf8ByteLength(`${LONE_HIGH}a`)).toBe(4);
    expect(utf8ByteLength(`${LONE_HIGH}${LONE_HIGH}`)).toBe(6);
    expect(utf8ByteLength(`${LONE_HIGH}${ASTRAL}`)).toBe(7);
    expect(utf8ByteLength(`${LONE_HIGH}`)).toBe(enc.encode(LONE_HIGH).length);
  });

  it("with a limit: length > limit is reported as too large", () => {
    expect(utf8ByteLength("abcd", 3)).toBeGreaterThan(3);
    expect(utf8ByteLength("é".repeat(4), 3)).toBeGreaterThan(3);
  });

  it("with a limit: length * 3 <= limit is reported as within the limit", () => {
    expect(utf8ByteLength("abc", 9)).toBeLessThanOrEqual(9);
    expect(utf8ByteLength("€€€", 9)).toBeLessThanOrEqual(9);
    expect(utf8ByteLength("", 0)).toBeLessThanOrEqual(0);
    // worst case: every unit is 3 bytes
    expect(utf8ByteLength("€€€", 9)).toBe(9);
  });

  it("with a limit: between the shortcuts the answer is exact on both sides", () => {
    // length 4, limit 10: 4 <= 10 and 12 > 10 -> exact path
    expect(utf8ByteLength("€€€€", 10)).toBe(12); // too large
    expect(utf8ByteLength("€€€€", 12)).toBeLessThanOrEqual(12);
    expect(utf8ByteLength("€€€a", 10)).toBe(10); // exactly at the limit
    expect(utf8ByteLength("€€€a", 10)).toBeLessThanOrEqual(10);
    expect(utf8ByteLength("€€€a", 9)).toBeGreaterThan(9);
    expect(utf8ByteLength("aaaa", 4)).toBeLessThanOrEqual(4); // length == limit, ASCII
    expect(utf8ByteLength(ASTRAL, 4)).toBeLessThanOrEqual(4); // 2 units, 4 bytes
    expect(utf8ByteLength(ASTRAL, 3)).toBeGreaterThan(3);
    expect(utf8ByteLength(LONE_HIGH, 3)).toBeLessThanOrEqual(3);
    expect(utf8ByteLength(LONE_HIGH, 2)).toBeGreaterThan(2);
  });

  it("with a limit: verdict agrees with the exact length over a small sweep", () => {
    const parts = ["a", "é", "€", ASTRAL, LONE_HIGH, LONE_LOW];
    const strings: string[] = [""];
    for (const a of parts) {
      strings.push(a);
      for (const b of parts) {
        strings.push(a + b);
        for (const c of parts) strings.push(a + b + c);
      }
    }
    for (const s of strings) {
      const exact = utf8ByteLength(s);
      for (let limit = 0; limit <= exact + 3; limit++) {
        expect(utf8ByteLength(s, limit) > limit).toBe(exact > limit);
      }
    }
  });
});

describe("base64DecodedLength", () => {
  it("handles the empty string and unpadded whole groups", () => {
    expect(base64DecodedLength("")).toBe(0);
    expect(base64DecodedLength("AAAA")).toBe(3);
    expect(base64DecodedLength("AAAAAAAA")).toBe(6);
  });

  it("handles single and double padding", () => {
    expect(base64DecodedLength("AAA=")).toBe(2);
    expect(base64DecodedLength("AA==")).toBe(1);
    expect(base64DecodedLength("AAAAAAA=")).toBe(5);
    expect(base64DecodedLength("AAAAAA==")).toBe(4);
  });

  it("handles unpadded tails of 2 and 3 characters", () => {
    expect(base64DecodedLength("AA")).toBe(1);
    expect(base64DecodedLength("AAA")).toBe(2);
    expect(base64DecodedLength("AAAAAA")).toBe(4);
    expect(base64DecodedLength("AAAAAAA")).toBe(5);
  });

  it("agrees with the byte count of real encodings", () => {
    for (let n = 0; n <= 20; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => i * 7);
      const padded = btoa(String.fromCharCode(...bytes));
      expect(base64DecodedLength(padded)).toBe(n);
      expect(base64DecodedLength(padded.replace(/=+$/, ""))).toBe(n);
    }
  });
});

function run(schema: z.ZodTypeAny, value: unknown) {
  return schema.safeParse(value);
}

describe("maxCodePoints", () => {
  const schema = z.string().superRefine(maxCodePoints(3));

  it("accepts up to n code points, counting astral characters as one", () => {
    expect(run(schema, "").success).toBe(true);
    expect(run(schema, "abc").success).toBe(true);
    expect(run(schema, `${ASTRAL}${ASTRAL}${ASTRAL}`).success).toBe(true);
  });

  it("rejects more than n code points", () => {
    const r = run(schema, `${ASTRAL}${ASTRAL}${ASTRAL}x`);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues).toHaveLength(1);
      expect(r.error.issues[0]?.code).toBe("custom");
      expect(r.error.issues[0]?.message).toBe("must be at most 3 characters");
    }
  });

  it("carries no params without the size marker", () => {
    const r = run(schema, "abcd");
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]).not.toHaveProperty("params");
  });

  it("carries the size marker when requested", () => {
    const marked = z.string().superRefine(maxCodePoints(3, { sizeMarker: true }));
    expect(run(marked, "abc").success).toBe(true);
    const r = run(marked, "abcd");
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]).toMatchObject({ params: { wraithCode: "E_PAYLOAD_TOO_LARGE" } });
    }
  });
});

describe("maxUtf8Bytes", () => {
  const schema = z.string().superRefine(maxUtf8Bytes(6));

  it("accepts strings of at most n bytes", () => {
    expect(run(schema, "").success).toBe(true);
    expect(run(schema, "abcdef").success).toBe(true);
    expect(run(schema, "€€").success).toBe(true); // exactly 6
    expect(run(schema, `${ASTRAL}a`).success).toBe(true); // 5
  });

  it("rejects strings above n bytes", () => {
    const r = run(schema, "€€a");
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues).toHaveLength(1);
      expect(r.error.issues[0]?.message).toBe("must be at most 6 bytes");
    }
    expect(run(schema, "abcdefg").success).toBe(false); // length shortcut
    expect(run(schema, `${ASTRAL}aaa`).success).toBe(false); // 7 bytes, length 5
  });

  it("counts lone surrogates as 3 bytes", () => {
    const s = z.string().superRefine(maxUtf8Bytes(3));
    expect(run(s, LONE_HIGH).success).toBe(true);
    expect(run(s, `${LONE_HIGH}a`).success).toBe(false);
  });

  it("carries the size marker only when requested", () => {
    const plain = run(schema, "abcdefg");
    expect(plain.success).toBe(false);
    if (!plain.success) expect(plain.error.issues[0]).not.toHaveProperty("params");

    const marked = z.string().superRefine(maxUtf8Bytes(6, { sizeMarker: true }));
    const r = run(marked, "abcdefg");
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]).toMatchObject({ params: { ...SIZE_MARKER } });
  });
});
