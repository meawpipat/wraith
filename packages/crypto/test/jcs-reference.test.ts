// Self-test of the independent JCS reference on hand-checked values (RFC 8785).
// **Validates: Requirements 12.1, 13.12**
import { describe, expect, it } from "vitest";
import {
  jsonStringifyOracle,
  referenceCanonicalize,
  referenceCanonicalizeBytes,
  referenceNumber,
} from "./support/jcs-reference.js";

describe("jcs-reference numbers (RFC 8785 Appendix B and section 3.2.2.3)", () => {
  const cases: ReadonlyArray<readonly [number, string]> = [
    [0, "0"],
    [-0, "0"],
    [5e-324, "5e-324"],
    [-5e-324, "-5e-324"],
    [1.7976931348623157e308, "1.7976931348623157e+308"],
    [9007199254740992, "9007199254740992"],
    [-9007199254740991, "-9007199254740991"],
    [295147905179352830000, "295147905179352830000"],
    [9.999999999999997e22, "9.999999999999997e+22"],
    [1e22, "1e+22"],
    [1e21, "1e+21"],
    [1e20, "100000000000000000000"],
    [1.0, "1"],
    [0.000001, "0.000001"],
    [1e-7, "1e-7"],
    [0.0000012, "0.0000012"],
    [1.5e-7, "1.5e-7"],
    [123.456, "123.456"],
    [0.1, "0.1"],
    [4.5, "4.5"],
    [2e-3, "0.002"],
    [333333333.3333333, "333333333.3333333"],
  ];
  for (const [input, expected] of cases) {
    it(`writes ${expected}`, () => {
      expect(referenceNumber(input)).toBe(expected);
    });
  }

  it("rejects non-finite numbers", () => {
    expect(() => referenceNumber(Number.NaN)).toThrow();
    expect(() => referenceNumber(Number.POSITIVE_INFINITY)).toThrow();
  });
});

describe("jcs-reference structure", () => {
  it("sorts members by UTF-16 code units (RFC 8785 section 3.2.3)", () => {
    const input = {
      "\u20ac": "Euro Sign",
      "\r": "Carriage Return",
      "\ufb33": "Hebrew Letter Dalet With Dagesh",
      "1": "One",
      "\u{1f600}": "Emoji: Grinning Face",
      "\u0080": "Control",
      "\u00f6": "Latin Small Letter O With Diaeresis",
    };
    const expected =
      '{"\\r":"Carriage Return","1":"One","\u0080":"Control","\u00f6":"Latin Small Letter O With Diaeresis",' +
      '"\u20ac":"Euro Sign","\u{1f600}":"Emoji: Grinning Face","\ufb33":"Hebrew Letter Dalet With Dagesh"}';
    expect(referenceCanonicalize(input)).toBe(expected);
    expect(jsonStringifyOracle(input)).toBe(expected);
  });

  it("sorts integer-like names as text, not as numbers", () => {
    const input = { b: 1, "10": 2, "2": 3, a: 4 };
    expect(referenceCanonicalize(input)).toBe('{"10":2,"2":3,"a":4,"b":1}');
    expect(jsonStringifyOracle(input)).toBe('{"10":2,"2":3,"a":4,"b":1}');
  });

  it("writes the RFC 8785 section 3.2.2 style example", () => {
    const input = {
      numbers: [333333333.3333333, 1e30, 4.5, 0.002, 1e-27],
      string: '\u20ac$\u000f\nA\'B"\\\\"/',
      literals: [null, true, false],
    };
    expect(referenceCanonicalize(input)).toBe(
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"\u20ac$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
    );
  });

  it("escapes controls in lower-case hex and leaves U+007F, U+2028, / and astral as themselves", () => {
    const text = "\u0000\u0008\u0009\u000a\u000c\u000d\u001f\u007f\u2028\u2029/\u{1f600}";
    expect(referenceCanonicalize(text)).toBe(
      '"\\u0000\\b\\t\\n\\f\\r\\u001f\u007f\u2028\u2029/\u{1f600}"',
    );
    expect(jsonStringifyOracle(text)).toBe(referenceCanonicalize(text));
  });

  it("writes empty containers and an own __proto__ member", () => {
    expect(referenceCanonicalize({})).toBe("{}");
    expect(referenceCanonicalize([])).toBe("[]");
    const withProto = JSON.parse('{"__proto__":1,"a":[]}') as unknown;
    expect(referenceCanonicalize(withProto)).toBe('{"__proto__":1,"a":[]}');
    expect(jsonStringifyOracle(withProto)).toBe('{"__proto__":1,"a":[]}');
  });

  it("encodes UTF-8 bytes", () => {
    expect(Array.from(referenceCanonicalizeBytes("a\u00f6\u20ac\u{1f600}"))).toEqual([
      0x22, 0x61, 0xc3, 0xb6, 0xe2, 0x82, 0xac, 0xf0, 0x9f, 0x98, 0x80, 0x22,
    ]);
  });

  it("rejects what has no JCS form", () => {
    for (const bad of [
      undefined,
      1n,
      Symbol("s"),
      () => 1,
      Number.NaN,
      "\ud800",
      { "\udc00": 1 },
      new Date(0),
      [undefined],
    ]) {
      expect(() => referenceCanonicalize(bad)).toThrow();
    }
  });

  it("makes the oracle refuse values outside its subset", () => {
    expect(() => jsonStringifyOracle("\ud800")).toThrow();
    expect(() => jsonStringifyOracle(Number.NaN)).toThrow();
    expect(() => jsonStringifyOracle({ a: Number.POSITIVE_INFINITY })).toThrow();
  });
});
