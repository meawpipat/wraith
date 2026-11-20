import * as fc from "fast-check";
import { describe, it } from "vitest";
import type { SpikeMeta } from "../../tools/lib/spike-meta.ts";
import { cpuSeconds, increasePoints } from "../hc/q1/metrics.ts";
import { CORE_STOP_REASONS, respawnDecision } from "../hc/q6/respawn.ts";
import { OWNER_LIST, type SpikeId } from "../lib/ids.ts";
import { orderBatch, runByGate } from "../lib/order.ts";
import { pbt } from "./config.ts";

const GROUP_A: SpikeId[] = ["q2", "q13", "q12", "q1", "q6"];
const KIRO: SpikeId[] = ["q3", "q3b", "q10", "q4", "q11", "q23", "q30", "q32", "q31", "q35"];
const OWNER_RUN: ReadonlySet<string> = new Set([...KIRO, "q33", "q14"]);

function meta(id: SpikeId, over: Partial<SpikeMeta> = {}): SpikeMeta {
  return {
    id,
    group: GROUP_A.includes(id) ? "A" : "B",
    cost: "none",
    runBy: OWNER_RUN.has(id) ? "owner" : "loop",
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

const METAS: Record<string, SpikeMeta> = {};
for (const id of OWNER_LIST) METAS[id] = meta(id);
METAS.q43 = meta("q43", { agents: ["kiro"] });
METAS.q7 = meta("q7", { agents: ["kiro"] });
for (const id of KIRO) METAS[id] = meta(id, { agents: ["kiro"], depends: ["q43"] });
METAS.q23 = meta("q23", { agents: ["kiro"], depends: ["q43"], shares: "q3" });
METAS.q33 = meta("q33", { agents: ["claude"] });

const ID_LIST: SpikeId[] = [...OWNER_LIST];
const subset = fc.subarray(ID_LIST).chain((s) => fc.shuffledSubarray(s, { minLength: s.length }));

describe("Feature: s-spikes, Property 19: Run order respects dependencies and Run_By", () => {
  it("puts dependencies and shares first, Q2 first and Q6 last of Group A, and rejects a mixed Q33 batch", () => {
    pbt(
      fc.property(subset, (ids) => {
        const result = orderBatch(ids, METAS);
        const hasQ33 = ids.includes("q33");
        const mixed = hasQ33 && ids.some((id) => id !== "q33" && METAS[id]?.agents.length);
        if (mixed) {
          return result.error !== undefined && result.order.length === 0;
        }
        if (result.error !== undefined) return false;
        const { order } = result;
        if (order.length !== ids.length || new Set(order).size !== ids.length) return false;
        for (const id of order) {
          const m = METAS[id];
          const wanted = [...(m?.depends ?? []), ...(m?.shares ? [m.shares] : [])];
          for (const d of wanted) {
            if (ids.includes(d as SpikeId) && order.indexOf(d as SpikeId) > order.indexOf(id)) {
              return false;
            }
          }
        }
        const a = order.filter((id) => GROUP_A.includes(id));
        if (a.length > 0 && ids.includes("q2") && a[0] !== "q2") return false;
        if (a.length > 0 && ids.includes("q6") && a[a.length - 1] !== "q6") return false;
        return true;
      }),
    );
  });

  it("returns pending iff Run_By is owner and a stream is not a TTY", () => {
    pbt(
      fc.property(
        fc.constantFrom<"owner" | "loop">("owner", "loop"),
        fc.boolean(),
        fc.boolean(),
        (runBy, stdinTty, stdoutTty) => {
          const r = runByGate({ runBy }, { stdinTty, stdoutTty });
          const pending = runBy === "owner" && !(stdinTty && stdoutTty);
          return pending
            ? !r.go && r.result === "pending" && r.reason === "needs interactive terminal"
            : r.go;
        },
      ),
    );
  });

  it("is deterministic under input permutation of the batch for ordered pairs", () => {
    pbt(
      fc.property(fc.shuffledSubarray(["q43", "q3", "q23", "q3b", "q10"] as SpikeId[]), (ids) => {
        const { order } = orderBatch(ids, METAS);
        const pos = (x: SpikeId) => order.indexOf(x);
        if (ids.includes("q43") && ids.includes("q3") && pos("q43") > pos("q3")) return false;
        if (ids.includes("q3") && ids.includes("q23") && pos("q3") > pos("q23")) return false;
        return true;
      }),
    );
  });
});

const cs = (n: number): string => {
  const m = Math.floor(n / 6000);
  const s = Math.floor((n % 6000) / 100);
  const c = n % 100;
  return `${m}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
};

const samples = fc
  .array(fc.integer({ min: 0, max: 600_000 }), { minLength: 4, maxLength: 4 })
  .map((a) => a.sort((x, y) => x - y));
const wall = fc.integer({ min: 1, max: 3600 });

describe("Feature: s-spikes, Property 21: Metrics helpers", () => {
  it("parses M:SS.cc cputime samples to seconds", () => {
    pbt(
      fc.property(fc.integer({ min: 0, max: 600_000 }), (n) => {
        return Math.abs(cpuSeconds(cs(n)) - n / 100) < 1e-6;
      }),
    );
  });

  it("computes increasePoints as during minus baseline points, never negative", () => {
    pbt(
      fc.property(samples, wall, wall, (s, w1, w2) => {
        const base = {
          cpuStart: cpuSeconds(cs(s[0] ?? 0)),
          cpuEnd: cpuSeconds(cs(s[1] ?? 0)),
          wallSeconds: w1,
        };
        const during = {
          cpuStart: cpuSeconds(cs(s[2] ?? 0)),
          cpuEnd: cpuSeconds(cs(s[3] ?? 0)),
          wallSeconds: w2,
        };
        const want =
          ((during.cpuEnd - during.cpuStart) / w2) * 100 -
          ((base.cpuEnd - base.cpuStart) / w1) * 100;
        const got = increasePoints(base, during);
        return got >= 0 && Math.abs(got - Math.max(0, want)) < 1e-6;
      }),
    );
  });

  it("respawns exactly for holder_lost, a core stop and exited 75, never for code 0 or killed", () => {
    const reasons = fc.oneof(
      fc.constantFrom("holder_lost", "killed", "exited", ...CORE_STOP_REASONS),
      fc.string({ maxLength: 12 }),
    );
    const codes = fc.oneof(fc.constant(null), fc.constant(75), fc.integer({ min: 0, max: 255 }));
    pbt(
      fc.property(reasons, codes, (reason, code) => {
        const d = respawnDecision(reason, code);
        if (code === 0 || reason === "killed") return d === "none";
        const should =
          reason === "holder_lost" ||
          CORE_STOP_REASONS.includes(reason) ||
          (reason === "exited" && code === 75);
        return d === (should ? "respawn" : "none");
      }),
    );
  });
});
