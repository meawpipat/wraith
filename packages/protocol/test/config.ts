import * as fc from "fast-check";

/** Minimum number of runs for every property test (P1-D6). */
export const PBT_MIN_RUNS = 500;

/**
 * Wraps `fc.assert`. Refuses a run count below `PBT_MIN_RUNS`; defaults to it.
 * All property tests go through this helper.
 */
export function pbt<Ts extends unknown[]>(
  property: fc.IProperty<Ts> | fc.IAsyncProperty<Ts>,
  params: fc.Parameters<Ts> = {},
): void | Promise<void> {
  const numRuns = params.numRuns ?? PBT_MIN_RUNS;
  if (numRuns < PBT_MIN_RUNS) {
    throw new Error(`pbt: numRuns ${numRuns} is below PBT_MIN_RUNS (${PBT_MIN_RUNS})`);
  }
  return fc.assert(property as fc.IAsyncProperty<Ts>, { ...params, numRuns });
}
