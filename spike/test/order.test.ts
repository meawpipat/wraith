import { describe, expect, it } from "vitest";
import type { SpikeMeta } from "../../tools/lib/spike-meta.ts";
import { GATE_LIST, OWNER_LIST, type SpikeId } from "../lib/ids.ts";
import { dependencyNote, orderBatch, runByGate, STAGES } from "../lib/order.ts";

function meta(id: string, over: Partial<SpikeMeta> = {}): SpikeMeta {
  return {
    id,
    group: "B",
    cost: "none",
    runBy: "loop",
    agents: [],
    maxPrompts: 0,
    maxWallSeconds: 60,
    estimateCredits: null,
    claudePrompts: 0,
    human: [],
    depends: [],
    shares: null,
    allowAlways: "never",
    assumption: "",
    ...over,
  };
}

const KIRO = ["q3", "q3b", "q10", "q4", "q11", "q23"];
const metas: Record<string, SpikeMeta> = {};
for (const id of OWNER_LIST) metas[id] = meta(id);
for (const id of KIRO) metas[id] = meta(id, { agents: ["kiro"], depends: ["q43"] });
metas.q43 = meta("q43", { agents: ["kiro"] });
metas.q7 = meta("q7", { agents: ["kiro"] });
metas.q23 = meta("q23", { agents: ["kiro"], depends: ["q43"], shares: "q3" });
metas.q33 = meta("q33", { agents: ["claude"] });

describe("STAGES", () => {
  it("lists the stage order of the requirements", () => {
    const flat = STAGES.flatMap((s) => s.ids);
    expect(STAGES[0]?.ids).toEqual(["q2", "q13", "q12", "q1", "q6"]);
    expect(STAGES[1]?.ids).toEqual(["q7", "q43"]);
    expect(STAGES[2]?.ids).toEqual(["q3", "q3b", "q10", "q4", "q11", "q23"]);
    expect(STAGES[3]?.ids).toEqual(["q30", "q32", "q31", "q35"]);
    expect(STAGES[4]?.ids).toEqual(["q33", "q35"]);
    expect(STAGES[5]).toMatchObject({ id: "any", ids: ["q14"] });
    expect(new Set(flat)).toEqual(new Set(OWNER_LIST));
  });
});

describe("orderBatch", () => {
  it("orders the whole gate list: stage 1 first, Q6 last of Group A", () => {
    const { order, warnings } = orderBatch(GATE_LIST.filter((id) => id !== "q33").reverse(), metas);
    expect(warnings).toEqual([]);
    expect(order.slice(0, 5)).toEqual(["q2", "q13", "q12", "q1", "q6"]);
    expect(order.indexOf("q43")).toBeLessThan(order.indexOf("q3"));
  });

  it("puts Q23 after Q3 and Q43 before them", () => {
    const { order } = orderBatch(["q23", "q3", "q43"], metas);
    expect(order).toEqual(["q43", "q3", "q23"]);
  });

  it("puts Q14 last as an any-time spike without blocking others", () => {
    const { order } = orderBatch(["q14", "q2", "q6"], metas);
    expect(order).toEqual(["q2", "q6", "q14"]);
  });

  it("warns about a dependency missing from the batch", () => {
    const { order, warnings } = orderBatch(["q3"], metas);
    expect(order).toEqual(["q3"]);
    expect(warnings).toEqual(["q3 depends on q43, which is not in this batch"]);
  });

  it("rejects q33 together with other Agent_Spikes, but not with Group A", () => {
    const bad = orderBatch(["q33", "q3"], metas);
    expect(bad.order).toEqual([]);
    expect(bad.error).toContain("q33");
    expect(orderBatch(["q33"], metas).order).toEqual(["q33"]);
    expect(orderBatch(["q33", "q2"], metas).error).toBeUndefined();
  });

  it("does not loop on a dependency cycle", () => {
    const cyc = { a: meta("q1", { depends: ["q2"] }), b: meta("q2", { depends: ["q1"] }) };
    const { order, warnings } = orderBatch(["q1", "q2"], { q1: cyc.a, q2: cyc.b });
    expect(order).toHaveLength(2);
    expect(warnings.some((w) => w.includes("cycle"))).toBe(true);
  });
});

describe("runByGate", () => {
  it("makes an owner spike pending without a TTY on either stream", () => {
    const m = meta("q3", { runBy: "owner" });
    const pending = { go: false, result: "pending", reason: "needs interactive terminal" };
    expect(runByGate(m, { stdinTty: false, stdoutTty: true })).toEqual(pending);
    expect(runByGate(m, { stdinTty: true, stdoutTty: false })).toEqual(pending);
    expect(runByGate(m, { stdinTty: true, stdoutTty: true })).toEqual({ go: true });
  });

  it("lets a loop spike run without a TTY", () => {
    expect(runByGate(meta("q2"), { stdinTty: false, stdoutTty: false })).toEqual({ go: true });
  });
});

describe("dependencyNote", () => {
  it("is silent for PASS and unknown results", () => {
    expect(dependencyNote("q43", "PASS")).toBeNull();
    expect(dependencyNote("q43", null)).toBeNull();
  });

  it("explains the Q43 FAIL branch", () => {
    const note = dependencyNote("q43", "FAIL");
    expect(note).toContain("q43 FAIL");
    expect(note).toContain("after initialize");
  });

  it("notes a PARTIAL dependency and a pending one", () => {
    expect(dependencyNote("q3" as SpikeId, "PARTIAL")).toContain("q3 PARTIAL");
    expect(dependencyNote("q3" as SpikeId, "pending")).toContain("pending");
  });
});
