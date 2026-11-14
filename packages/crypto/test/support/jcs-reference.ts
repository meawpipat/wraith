/**
 * Independent JCS (RFC 8785) reference and JSON.stringify oracle.
 *
 * Test-side only. Imports nothing from `src` and nothing from `node:`, so it
 * runs unchanged in the Workers project. It is written with a different method
 * from `src/jcs.ts` on purpose:
 *  - recursion over `Object.entries` with a sort (the implementation is iterative);
 *  - escaping by iterating code points with a lookup table;
 *  - number text built by searching for the shortest `toPrecision(k)` that
 *    round-trips, then applying the ECMAScript `Number::toString` layout rules
 *    (it never calls `String(n)` or `JSON.stringify` on a number).
 *
 * Limits: it is slow and recursive, so use it on modest depths only. It shares
 * the engine's string comparison and `Number` parsing with the implementation.
 */

/** A JSON value as the reference accepts it. */
export type RefJson =
  | null
  | boolean
  | number
  | string
  | readonly RefJson[]
  | { readonly [key: string]: RefJson };

/** UTF-16 code unit order (what `<` does on strings), never locale-aware. */
function compareUtf16(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const SHORT_ESCAPES: ReadonlyMap<number, string> = new Map([
  [0x08, "\\b"],
  [0x09, "\\t"],
  [0x0a, "\\n"],
  [0x0c, "\\f"],
  [0x0d, "\\r"],
  [0x22, '\\"'],
  [0x5c, "\\\\"],
]);

/** Lookup table for U+0000..U+001F, plus quote and backslash handled via SHORT_ESCAPES. */
const CONTROL_TABLE: readonly string[] = (() => {
  const table: string[] = [];
  for (let c = 0; c < 0x20; c++) {
    table.push(SHORT_ESCAPES.get(c) ?? `\\u${"0000".concat(c.toString(16)).slice(-4)}`);
  }
  return table;
})();

/** RFC 8785 section 3.2.2.2 string form. Throws on a lone surrogate. */
export function referenceQuote(text: string): string {
  let out = '"';
  for (const ch of text) {
    // `for..of` yields a lone surrogate as a one-unit string.
    const cp = ch.codePointAt(0) as number;
    if (cp >= 0xd800 && cp <= 0xdfff) {
      throw new Error("jcs-reference: lone surrogate");
    }
    if (cp < 0x20) {
      out += CONTROL_TABLE[cp] as string;
    } else if (cp === 0x22 || cp === 0x5c) {
      out += SHORT_ESCAPES.get(cp) as string;
    } else {
      out += ch;
    }
  }
  return `${out}"`;
}

/** Significant digits of a toPrecision string (no sign, point, exponent, leading zeros). */
function significantDigits(text: string): string {
  const eAt = text.indexOf("e");
  const mantissa = (eAt === -1 ? text : text.slice(0, eAt)).replace(".", "");
  return mantissa.replace(/^0+/, "");
}

/**
 * `toPrecision(k)` rounds an exact tie upward, but Number::toString picks the
 * even digit when two k-digit strings are equally close. `toPrecision(100)` is
 * the exact expansion of a double, so a tie shows as a remainder of "5000...".
 */
function breakTieToEven(abs: number, raw: string, k: number): string {
  const rest = significantDigits(abs.toPrecision(100)).slice(k);
  const last = raw.length - 1 - (raw.includes("e") ? raw.length - raw.indexOf("e") : 0);
  const lastDigit = Number(raw[last]);
  if (/^50*$/.test(rest) && lastDigit % 2 === 1) {
    return raw.slice(0, last) + String(lastDigit - 1) + raw.slice(last + 1);
  }
  return raw;
}

/**
 * Number text per ECMAScript Number::toString, built from the shortest
 * `toPrecision(k)` that parses back to the same double.
 * Throws on NaN and the infinities.
 */
export function referenceNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error("jcs-reference: non-finite number");
  }
  if (value === 0) {
    return "0"; // also -0
  }
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);

  let raw = "";
  for (let k = 1; k <= 17; k++) {
    raw = abs.toPrecision(k);
    if (Number(raw) === abs) {
      raw = breakTieToEven(abs, raw, k);
      break;
    }
  }

  // Decompose `raw` into a digit string and n, where value = 0.DIGITS * 10^n
  // in the spec's sense: digits x 10^(n - k).
  const eAt = raw.indexOf("e");
  const mantissa = eAt === -1 ? raw : raw.slice(0, eAt);
  const exp10 = eAt === -1 ? 0 : Number(raw.slice(eAt + 1));
  const dot = mantissa.indexOf(".");
  const pointPos = dot === -1 ? mantissa.length : dot;
  const allDigits = mantissa.replace(".", "");
  let lead = 0;
  while (lead < allDigits.length - 1 && allDigits[lead] === "0") {
    lead++;
  }
  let digits = allDigits.slice(lead);
  const n = pointPos - lead + exp10;
  while (digits.length > 1 && digits.endsWith("0")) {
    digits = digits.slice(0, -1);
  }
  const k = digits.length;

  let body: string;
  if (k <= n && n <= 21) {
    body = digits + "0".repeat(n - k);
  } else if (0 < n && n <= 21) {
    body = `${digits.slice(0, n)}.${digits.slice(n)}`;
  } else if (-6 < n && n <= 0) {
    body = `0.${"0".repeat(-n)}${digits}`;
  } else {
    const e = n - 1;
    const expText = `e${e < 0 ? "-" : "+"}${Math.abs(e)}`;
    body = k === 1 ? `${digits}${expText}` : `${digits[0]}.${digits.slice(1)}${expText}`;
  }
  return sign + body;
}

function isPlainRecord(value: object): value is Record<string, unknown> {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Canonical JSON text per RFC 8785, by plain recursion.
 * Throws a plain Error on anything outside I-JSON (undefined, bigint, symbol,
 * function, NaN, Infinity, lone surrogates, non-plain objects).
 */
export function referenceCanonicalize(value: unknown): string {
  if (value === null) {
    return "null";
  }
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
      return referenceQuote(value);
    case "number":
      return referenceNumber(value);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((item) => referenceCanonicalize(item)).join(",")}]`;
      }
      if (!isPlainRecord(value)) {
        throw new Error("jcs-reference: non-plain object");
      }
      const members = Object.entries(value).sort((a, b) => compareUtf16(a[0], b[0]));
      return `{${members.map(([key, item]) => `${referenceQuote(key)}:${referenceCanonicalize(item)}`).join(",")}}`;
    }
    default:
      throw new Error(`jcs-reference: unsupported ${typeof value}`);
  }
}

/** UTF-8 bytes of `referenceCanonicalize(value)`, via code points (no TextEncoder). */
export function referenceCanonicalizeBytes(value: unknown): Uint8Array {
  const bytes: number[] = [];
  for (const ch of referenceCanonicalize(value)) {
    const cp = ch.codePointAt(0) as number;
    if (cp < 0x80) {
      bytes.push(cp);
    } else if (cp < 0x800) {
      bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    } else if (cp < 0x10000) {
      bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      bytes.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    }
  }
  return Uint8Array.from(bytes);
}

function hasLoneSurrogate(text: string): boolean {
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    if (cp >= 0xd800 && cp <= 0xdfff) {
      return true;
    }
  }
  return false;
}

/**
 * `JSON.stringify` oracle for the subset where JSON.stringify text equals the
 * JCS text: well-formed strings (JSON.stringify escapes lone surrogates, JCS
 * rejects them) and finite numbers (JSON.stringify writes `null` for them).
 * Outside the subset this function throws instead of answering.
 *
 * Object members are put in UTF-16 sorted order and every leaf and property
 * name is written by `JSON.stringify`. Containers are joined here rather than
 * by rebuilding an object, because a rebuilt object would reorder
 * integer-like names ("10" before "2" before "a") and would break on an own
 * `__proto__` member; the member order here is exactly the UTF-16 sort.
 */
export function jsonStringifyOracle(value: unknown): string {
  if (value === null) {
    return "null";
  }
  switch (typeof value) {
    case "boolean":
      return JSON.stringify(value);
    case "string":
      if (hasLoneSurrogate(value)) {
        throw new Error("jcs-reference: oracle subset excludes lone surrogates");
      }
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) {
        throw new Error("jcs-reference: oracle subset excludes non-finite numbers");
      }
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((item) => jsonStringifyOracle(item)).join(",")}]`;
      }
      if (!isPlainRecord(value)) {
        throw new Error("jcs-reference: non-plain object");
      }
      const members = Object.entries(value).sort((a, b) => compareUtf16(a[0], b[0]));
      return `{${members.map(([key, item]) => `${jsonStringifyOracle(key)}:${jsonStringifyOracle(item)}`).join(",")}}`;
    }
    default:
      throw new Error(`jcs-reference: unsupported ${typeof value}`);
  }
}
