import fc from "fast-check";

export const OPS_PBT_RUNS = 500;

/** Wraps `fc.assert`; defaults `numRuns` to OPS_PBT_RUNS and refuses a lower value. */
export function pbt<T>(
  property: fc.IPropertyWithHooks<T> | fc.IAsyncPropertyWithHooks<T>,
  params: fc.Parameters<T> = {},
): void | Promise<void> {
  const numRuns = params.numRuns ?? OPS_PBT_RUNS;
  if (numRuns < OPS_PBT_RUNS) {
    throw new Error(`pbt: numRuns ${numRuns} is below the minimum ${OPS_PBT_RUNS}`);
  }
  return fc.assert(property as fc.IPropertyWithHooks<T>, { ...params, numRuns });
}
