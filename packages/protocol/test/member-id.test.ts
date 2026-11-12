import { describe, expect, it } from "vitest";
import { MemberId } from "../src/base.js";
import { MEMBER_ID_MAX_CHARS } from "../src/limits.js";

describe("MemberId", () => {
  it("accepts 1 and the maximum number of code points", () => {
    expect(MemberId.safeParse("a").success).toBe(true);
    expect(MemberId.safeParse("a".repeat(MEMBER_ID_MAX_CHARS)).success).toBe(true);
  });

  it("rejects the empty string and one code point over the maximum", () => {
    expect(MemberId.safeParse("").success).toBe(false);
    expect(MemberId.safeParse("a".repeat(MEMBER_ID_MAX_CHARS + 1)).success).toBe(false);
  });

  it("counts an astral character as one code point", () => {
    expect(MemberId.safeParse("😀".repeat(MEMBER_ID_MAX_CHARS)).success).toBe(true);
    expect(MemberId.safeParse("😀".repeat(MEMBER_ID_MAX_CHARS + 1)).success).toBe(false);
  });

  it("rejects non-string values", () => {
    for (const v of [1, null, undefined, {}, ["a"]]) {
      expect(MemberId.safeParse(v).success).toBe(false);
    }
  });
});
