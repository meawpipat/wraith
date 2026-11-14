import * as fc from "fast-check";

/** Number of runs for every property test of @wraith/crypto (P0-D3). */
export const CRYPTO_PBT_RUNS = 1000;

/**
 * Wraps `fc.assert`. Refuses a run count below `CRYPTO_PBT_RUNS`; defaults to it.
 * All property tests go through this helper.
 */
export function pbt<Ts extends unknown[]>(
  property: fc.IProperty<Ts> | fc.IAsyncProperty<Ts>,
  params: fc.Parameters<Ts> = {},
): void | Promise<void> {
  const numRuns = params.numRuns ?? CRYPTO_PBT_RUNS;
  if (numRuns < CRYPTO_PBT_RUNS) {
    throw new Error(`pbt: numRuns ${numRuns} is below CRYPTO_PBT_RUNS (${CRYPTO_PBT_RUNS})`);
  }
  return fc.assert(property as fc.IAsyncProperty<Ts>, { ...params, numRuns });
}
