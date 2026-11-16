import * as fc from "fast-check";

/** Number of runs for every property test of @wraith/tools. */
export const OPS_PBT_RUNS = 500;

/**
 * Wraps `fc.assert`. Refuses a run count below `OPS_PBT_RUNS`; defaults to it.
 * All property tests go through this helper.
 */
export function pbt<Ts extends unknown[]>(
  property: fc.IProperty<Ts> | fc.IAsyncProperty<Ts>,
  params: fc.Parameters<Ts> = {},
): void | Promise<void> {
  const numRuns = params.numRuns ?? OPS_PBT_RUNS;
  if (numRuns < OPS_PBT_RUNS) {
    throw new Error(`pbt: numRuns ${numRuns} is below OPS_PBT_RUNS (${OPS_PBT_RUNS})`);
  }
  return fc.assert(property as fc.IAsyncProperty<Ts>, { ...params, numRuns });
}
