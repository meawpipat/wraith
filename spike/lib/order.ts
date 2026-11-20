import type { SpikeMeta } from "../../tools/lib/spike-meta.ts";
import { locate, type SpikeId } from "./ids.ts";
import type { ResultValue } from "./outcome.ts";

export interface Stage {
  id: 0 | 1 | 2 | 3 | 4 | 5 | "any";
  runBy: "loop" | "owner";
  ids: SpikeId[];
}

/** The "Run order" table of the requirements (R12). Q35 is listed in stage 4 (Kiro part) and 5 (Claude part). */
export const STAGES: readonly Stage[] = [
  { id: 1, runBy: "loop", ids: ["q2", "q13", "q12", "q1", "q6"] },
  { id: 2, runBy: "loop", ids: ["q7", "q43"] },
  { id: 3, runBy: "owner", ids: ["q3", "q3b", "q10", "q4", "q11", "q23"] },
  { id: 4, runBy: "owner", ids: ["q30", "q32", "q31", "q35"] },
  { id: 5, runBy: "owner", ids: ["q33", "q35"] },
  { id: "any", runBy: "owner", ids: ["q14"] },
];

/** Position of the first stage entry of each id: the tie-break of `orderBatch`. */
const RANK: ReadonlyMap<string, number> = (() => {
  const rank = new Map<string, number>();
  let n = 0;
  for (const stage of STAGES) {
    for (const id of stage.ids) {
      if (!rank.has(id)) rank.set(id, n);
      n += 1;
    }
  }
  return rank;
})();

function rankOf(id: string): number {
  return RANK.get(id) ?? Number.MAX_SAFE_INTEGER;
}

function isAgentSpike(id: SpikeId, metas: Record<string, SpikeMeta>): boolean {
  const m = metas[id];
  if (m) return m.agents.length > 0;
  return locate(id).dir !== "hc";
}

export interface OrderResult {
  order: SpikeId[];
  warnings: string[];
  /** Set when the batch is refused (Q33 together with other Agent_Spikes); `order` is then empty. */
  error?: string;
}

/**
 * Topological order over `depends` and `shares` (only ids in the batch count),
 * the stage table as the tie-break. A dependency missing from the batch gives a
 * warning. Q33 runs on its own budget day, so a batch with other Agent_Spikes is refused.
 */
export function orderBatch(ids: readonly SpikeId[], metas: Record<string, SpikeMeta>): OrderResult {
  const unique = [...new Set(ids)];
  const warnings: string[] = [];

  if (unique.includes("q33")) {
    const others = unique.filter((id) => id !== "q33" && isAgentSpike(id, metas));
    if (others.length > 0) {
      return {
        order: [],
        warnings,
        error: `q33 runs on its own budget day and cannot share a batch with ${others.join(", ")}`,
      };
    }
  }

  const inBatch = new Set<string>(unique);
  const deps = new Map<string, Set<string>>();
  for (const id of unique) {
    const m = metas[id];
    const wanted = new Set<string>();
    if (m) {
      for (const d of m.depends) wanted.add(d);
      if (m.shares) wanted.add(m.shares);
    }
    const present = new Set<string>();
    for (const d of wanted) {
      if (d === id) continue;
      if (inBatch.has(d)) present.add(d);
      else warnings.push(`${id} depends on ${d}, which is not in this batch`);
    }
    deps.set(id, present);
  }

  const remaining = new Set<SpikeId>(unique);
  const done = new Set<string>();
  const order: SpikeId[] = [];
  while (remaining.size > 0) {
    const ready = [...remaining].filter((id) =>
      [...(deps.get(id) ?? [])].every((d) => done.has(d)),
    );
    const pool = ready.length > 0 ? ready : [...remaining];
    if (ready.length === 0) {
      warnings.push(
        `dependency cycle among ${[...remaining].join(", ")}; falling back to stage order`,
      );
    }
    pool.sort((a, b) => rankOf(a) - rankOf(b));
    const next = pool[0] as SpikeId;
    remaining.delete(next);
    done.add(next);
    order.push(next);
  }
  return { order, warnings };
}

export type RunByGateResult =
  | { go: true }
  | { go: false; result: "pending"; reason: "needs interactive terminal" };

/** An owner spike needs a terminal on both streams; otherwise it ends `pending`. */
export function runByGate(
  m: Pick<SpikeMeta, "runBy">,
  io: { stdinTty: boolean; stdoutTty: boolean },
): RunByGateResult {
  if (m.runBy === "owner" && !(io.stdinTty && io.stdoutTty)) {
    return { go: false, result: "pending", reason: "needs interactive terminal" };
  }
  return { go: true };
}

/** A line to print before a dependent starts when its dependency did not pass (R12.8). */
export function dependencyNote(dep: SpikeId, depResult: ResultValue | null): string | null {
  if (depResult === null || depResult === "PASS") return null;
  if (depResult === "pending") return `${dep} is pending: its answer is not recorded yet`;
  if (dep === "q43") {
    return `q43 ${depResult}: launch without the agent argument and select the agent after initialize`;
  }
  return `${dep} ${depResult}: follow the branch recorded for ${dep}`;
}
