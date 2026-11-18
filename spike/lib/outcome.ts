export type ResultValue = "PASS" | "FAIL" | "PARTIAL" | "pending";

/** The observed text is redacted later, by the evidence writer. */
export interface CriterionRecord {
  id: string;
  ok: boolean;
  observed: string;
}

/**
 * Handed to every spike's `run`. Later tasks add the evidence writer, the hc wrapper,
 * the approval client and `humanStep`; the shape is open until then.
 */
export interface SpikeContext {
  readonly [key: string]: unknown;
}

export interface SpikeOutcome {
  result: ResultValue;
  /** Required for PARTIAL and pending. */
  reason?: string;
  criteria: CriterionRecord[];
  branch?: string;
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
