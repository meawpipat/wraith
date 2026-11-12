/**
 * Example tests for gate precedence in `parseRaw` (size, then JSON, then version, then schema).
 * **Validates: Requirements 5.2, 5.3, 5.8, 24.5**
 */
import { describe, expect, it } from "vitest";
import { ENVELOPE_MAX_BYTES } from "../src/limits.ts";
import { parseRaw } from "../src/parse.ts";

const ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

const pingValue = (): Record<string, unknown> => ({
  v: 1,
  meta: { id: ID, ts: 1700000000000, space: "space-1", type: "ping", to: "relay", persist: false },
  body: { t: 1700000000000 },
});

const encode = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, "utf8"));

describe("parseRaw size gate", () => {
  it("rejects an oversize non-JSON string before JSON parsing", () => {
    const raw = "x".repeat(ENVELOPE_MAX_BYTES + 1);
    expect(parseRaw(raw)).toEqual({ ok: false, code: "E_PAYLOAD_TOO_LARGE" });
  });

  it("rejects an oversize non-JSON Uint8Array before JSON parsing", () => {
    const raw = new Uint8Array(ENVELOPE_MAX_BYTES + 1).fill(0x78);
    expect(parseRaw(raw)).toEqual({ ok: false, code: "E_PAYLOAD_TOO_LARGE" });
  });

  it("rejects an oversize frame even with a wrong version", () => {
    const raw = JSON.stringify({ v: 2, pad: "x".repeat(ENVELOPE_MAX_BYTES) });
    expect(parseRaw(raw)).toEqual({ ok: false, code: "E_PAYLOAD_TOO_LARGE" });
  });

  it("passes the size gate at exactly ENVELOPE_MAX_BYTES", () => {
    const base = JSON.stringify({ v: 2, pad: "" });
    const raw = JSON.stringify({ v: 2, pad: "x".repeat(ENVELOPE_MAX_BYTES - base.length) });
    expect(raw.length).toBe(ENVELOPE_MAX_BYTES);
    expect(parseRaw(raw)).toEqual({ ok: false, code: "E_UNSUPPORTED_VERSION" });
    expect(parseRaw(encode(raw))).toEqual({ ok: false, code: "E_UNSUPPORTED_VERSION" });
  });

  it("rejects when characters are under the limit but UTF-8 bytes are over", () => {
    // "é" is 2 bytes in UTF-8, so this has ENVELOPE_MAX_BYTES / 2 + 1 characters.
    const raw = "é".repeat(ENVELOPE_MAX_BYTES / 2 + 1);
    expect(raw.length).toBeLessThanOrEqual(ENVELOPE_MAX_BYTES);
    expect(parseRaw(raw)).toEqual({ ok: false, code: "E_PAYLOAD_TOO_LARGE" });
  });
});

describe("parseRaw version gate", () => {
  const garbage = { meta: "garbage", body: 42, sig: [], relay: null };

  for (const [label, frame] of [
    ["2", { v: 2, ...garbage }],
    ['"1"', { v: "1", ...garbage }],
    ["missing", { ...garbage }],
    ["null", { v: null, ...garbage }],
  ] as const) {
    it(`returns E_UNSUPPORTED_VERSION for v ${label} before other checks`, () => {
      expect(parseRaw(JSON.stringify(frame))).toEqual({
        ok: false,
        code: "E_UNSUPPORTED_VERSION",
      });
    });
  }
});

describe("parseRaw JSON gate", () => {
  for (const [label, raw] of [
    ["invalid JSON", "{not json"],
    ["empty string", ""],
    ["a JSON array", "[1,2,3]"],
    ["null", "null"],
    ["a number", "42"],
    ["a string", '"hello"'],
    ["a boolean", "true"],
  ] as const) {
    it(`returns E_SCHEMA_INVALID for ${label}`, () => {
      expect(parseRaw(raw)).toEqual({ ok: false, code: "E_SCHEMA_INVALID" });
    });
  }

  it("returns E_SCHEMA_INVALID for invalid UTF-8 bytes", () => {
    expect(parseRaw(new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]))).toEqual({
      ok: false,
      code: "E_SCHEMA_INVALID",
    });
  });

  it("never throws on odd inputs", () => {
    const odd: unknown[] = [
      "",
      new Uint8Array(0),
      "\u0000",
      "\ud800",
      "{}",
      "[]",
      new Uint8Array([0xc0, 0x80]),
      undefined,
      null,
      42,
      {},
    ];
    for (const input of odd) {
      expect(() => parseRaw(input as string)).not.toThrow();
    }
  });
});

describe("parseRaw success", () => {
  it("parses a valid ping with signed equal to the raw {v, meta, body}", () => {
    const value = pingValue();
    const result = parseRaw(JSON.stringify(value));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.signed).toEqual({ v: 1, meta: value.meta, body: value.body });
    expect(Object.keys(result.signed).sort()).toEqual(["body", "meta", "v"]);
  });

  it("keeps a body field in signed that the typed parse strips", () => {
    const value = pingValue();
    value.body = { t: 1700000000000, extra: "unsigned-looking" };
    const result = parseRaw(encode(JSON.stringify(value)));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.signed.body).toEqual({ t: 1700000000000, extra: "unsigned-looking" });
    expect(result.envelope.body).toEqual({ t: 1700000000000 });
  });
});
