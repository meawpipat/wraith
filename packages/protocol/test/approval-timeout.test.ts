/**
 * Example tests for node.configure.approvalTimeoutMin through the envelope parse (P1-D15).
 * **Validates: Requirements 14.1, 14.2, 24.6**
 */
import { describe, expect, it } from "vitest";
import { parseEnvelopeValue } from "../src/envelope.ts";

function configure(body: Record<string, unknown>): unknown {
  return {
    v: 1,
    meta: {
      id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      ts: 1700000000000,
      space: "space-1",
      type: "node.configure",
      to: "node:laptop",
      persist: true,
    },
    body,
    sig: { by: "device-1", alg: "ES256", value: "c2lnbmF0dXJl" },
  };
}

const withTimeout = (approvalTimeoutMin: unknown) =>
  parseEnvelopeValue(configure({ node: "laptop", approvalTimeoutMin }));

describe("node.configure approvalTimeoutMin", () => {
  it.each([0, 241, -1, 1.5, "60"])("rejects %j with E_SCHEMA_INVALID", (value) => {
    const result = withTimeout(value);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("E_SCHEMA_INVALID");
  });

  it.each([1, 240])("accepts boundary value %d", (value) => {
    expect(withTimeout(value).ok).toBe(true);
  });

  it("accepts a node.configure without approvalTimeoutMin", () => {
    expect(parseEnvelopeValue(configure({ node: "laptop" })).ok).toBe(true);
  });
});
