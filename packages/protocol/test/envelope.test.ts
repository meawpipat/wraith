/**
 * Focused example tests for the envelope failure paths (R2, R6.3, R8.12, R18.8).
 * **Validates: Requirements 2.3, 2.7, 2.8, 2.10, 6.3, 8.12**
 */
import { describe, expect, it } from "vitest";
import { parseEnvelopeValue } from "../src/envelope.ts";

const ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const SIG = { by: "node-1", alg: "ES256", value: "c2lnbmF0dXJl" };

function env(
  type: string,
  body: unknown,
  metaOver: Record<string, unknown> = {},
  sig?: unknown,
): Record<string, unknown> {
  return {
    v: 1,
    meta: {
      id: ID,
      ts: 1700000000000,
      space: "space-1",
      type,
      to: "devices",
      persist: true,
      ...metaOver,
    },
    body,
    ...(sig !== undefined ? { sig } : {}),
  };
}

const post = (metaOver: Record<string, unknown> = {}) =>
  env("bot.post", { text: "hi" }, metaOver, SIG);

const tool = (status: string, metaOver: Record<string, unknown>, sig?: unknown) =>
  env("bot.tool", { toolCallId: "t1", title: "x", kind: "read", status }, metaOver, sig);

function failure(value: unknown) {
  const result = parseEnvelopeValue(value);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected failure");
  return result;
}

describe("parseEnvelopeValue failure paths", () => {
  it("accepts a valid bot.post", () => {
    expect(parseEnvelopeValue(post()).ok).toBe(true);
  });

  it("rejects an extra Meta field", () => {
    expect(failure(post({ extra: 1 })).code).toBe("E_SCHEMA_INVALID");
  });

  it("rejects an unknown meta.type", () => {
    expect(failure(env("no.such.type", {}, {}, SIG)).code).toBe("E_SCHEMA_INVALID");
  });

  it("rejects a persist mismatch with a field-name-only path", () => {
    const result = failure(post({ persist: false }));
    expect(result.code).toBe("E_SCHEMA_INVALID");
    expect(result.path).toEqual(["meta", "persist"]);
  });

  it("rejects a device: target with persist true", () => {
    const result = failure(post({ to: "device:abc", persist: true }));
    expect(result.code).toBe("E_SCHEMA_INVALID");
  });

  it("rejects bot.tool completed without a sig", () => {
    expect(failure(tool("completed", { persist: true })).code).toBe("E_SCHEMA_INVALID");
  });

  it("rejects bot.tool in_progress with a sig", () => {
    expect(failure(tool("in_progress", { persist: false }, SIG)).code).toBe("E_SCHEMA_INVALID");
  });

  it("accepts bot.tool in_progress without sig and persist false", () => {
    expect(parseEnvelopeValue(tool("in_progress", { persist: false })).ok).toBe(true);
  });

  it("accepts bot.tool completed with sig and persist true", () => {
    expect(parseEnvelopeValue(tool("completed", { persist: true }, SIG)).ok).toBe(true);
  });

  it("never puts a body value in the failure result", () => {
    const secret = "SECRET-sk-live-0123456789";
    const result = parseEnvelopeValue(env("bot.post", { text: { [secret]: secret } }, {}, SIG));
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(secret);

    const keyed = parseEnvelopeValue(
      env("bot.tool", { toolCallId: secret, title: "x", kind: secret, status: "pending" }, {}, SIG),
    );
    expect(keyed.ok).toBe(false);
    expect(JSON.stringify(keyed)).not.toContain(secret);
  });
});
