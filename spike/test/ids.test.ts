import { describe, expect, it } from "vitest";
import { GATE_LIST, locate, OWNER_LIST } from "../lib/ids.ts";
import { EXIT } from "../lib/outcome.ts";

describe("spike ids", () => {
  it("has 19 distinct ids in OWNER_LIST", () => {
    expect(OWNER_LIST).toHaveLength(19);
    expect(new Set(OWNER_LIST).size).toBe(19);
  });

  it("keeps q14 out of GATE_LIST (18 ids)", () => {
    expect(GATE_LIST).toHaveLength(18);
    expect(GATE_LIST).not.toContain("q14");
    expect(OWNER_LIST).toContain("q14");
    for (const id of GATE_LIST) expect(OWNER_LIST).toContain(id);
  });

  it("locates spikes under their group folder", () => {
    expect(locate("q3b").dir).toBe("kiro");
    expect(locate("q3b").script).toBe("spike/kiro/q3b/q3b.ts");
    expect(locate("q33").evidenceRoot.startsWith("spike/agents/q33/")).toBe(true);
    expect(locate("q35").dir).toBe("agents");
    expect(locate("q2").evidenceRoot.startsWith("spike/hc/q2/")).toBe(true);
    expect(locate("q30").dir).toBe("kiro");
  });

  it("ends every evidence root in /evidence", () => {
    for (const id of OWNER_LIST) expect(locate(id).evidenceRoot.endsWith("/evidence")).toBe(true);
  });
});

describe("exit codes", () => {
  it("match the design numbers", () => {
    expect(EXIT).toEqual({
      OK: 0,
      INTERNAL: 1,
      PENDING: 10,
      PREFLIGHT: 20,
      BUDGET: 21,
      NEEDS_HUMAN: 22,
      CLEANUP_UNCONFIRMED: 30,
    });
  });
});
