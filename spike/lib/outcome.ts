import type { SpikeMeta } from "../../tools/lib/spike-meta.ts";
import type { PermissionAnswer, PermissionRequest } from "./approval.ts";
import type { EnvProfile } from "./env.ts";
import type { EvidenceWriter } from "./evidence.ts";
import type { Hc } from "./hc.ts";
import type { SpikeId } from "./ids.ts";

export type ResultValue = "PASS" | "FAIL" | "PARTIAL" | "pending";

/** The observed text is redacted later, by the evidence writer. */
export interface CriterionRecord {
  id: string;
  ok: boolean;
  observed: string;
}

/** A Kiro session reused inside one batch (q3 then q23). The owner spike fills `data`. */
export interface SharedSession {
  readonly owner: SpikeId;
  readonly data: Record<string, unknown>;
}

/** Handed to every spike's `run` (design: "Runner"). */
export interface SpikeContext {
  q: SpikeId;
  meta: SpikeMeta;
  root: string;
  session: string;
  scratch: string;
  /** Null for spikes that do not use hc. */
  hc: Hc | null;
  env: (profile: EnvProfile) => Record<string, string>;
  evidence: EvidenceWriter;
  approval: (req: PermissionRequest) => Promise<PermissionAnswer>;
  shared: SharedSession | null;
  /** Prints and records the step; never performs it (R10.2). */
  humanStep(id: string, text: string): void;
  now(): Date;
  interactive: boolean;
  /** True only when the run was started with `--allow-home-profile` (Q43, HS-S6). */
  allowHomeProfile: boolean;
}

export interface SpikeOutcome {
  result: ResultValue;
  /** Required for PARTIAL and pending. */
  reason?: string;
  criteria: CriterionRecord[];
  branch?: string;
  /** Set by a spike whose result is an agent-loop stop condition (Q3 and Q3b both FAIL). */
  stop?: { reason: string };
  affects: string[];
  /** HS-S1 .. HS-S8. */
  openHumanSteps: string[];
  promptsSent: number;
  notes: string[];
}

export interface SpikeModule {
  run(ctx: SpikeContext): Promise<SpikeOutcome>;
}

/** Runner-local exit codes, not product `E_*` codes. A recorded FAIL still exits 0. */
export const EXIT = {
  OK: 0,
  INTERNAL: 1,
  PENDING: 10,
  PREFLIGHT: 20,
  BUDGET: 21,
  NEEDS_HUMAN: 22,
  CLEANUP_UNCONFIRMED: 30,
} as const;
