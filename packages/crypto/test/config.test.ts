import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CRYPTO_PBT_RUNS, pbt } from "./config.js";

describe("test/config", () => {
  it("fixes the run count at 1000", () => {
    expect(CRYPTO_PBT_RUNS).toBe(1000);
  });

  it("refuses a numRuns below the constant", () => {
    expect(() =>
      pbt(
        fc.property(fc.nat(), () => true),
        { numRuns: CRYPTO_PBT_RUNS - 1 },
      ),
    ).toThrow();
  });

  it("runs at least 1000 times by default", () => {
    let runs = 0;
    pbt(
      fc.property(fc.nat(), () => {
        runs += 1;
        return true;
      }),
    );
    expect(runs).toBeGreaterThanOrEqual(1000);
  });
});
