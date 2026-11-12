import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { PBT_MIN_RUNS, pbt } from "./config.ts";

describe("test setup", () => {
  it("pins the PBT run count at 500", () => {
    expect(PBT_MIN_RUNS).toBe(500);
  });

  it("refuses a run count below the minimum", () => {
    const prop = fc.property(fc.integer(), () => true);
    expect(() => pbt(prop, { numRuns: PBT_MIN_RUNS - 1 })).toThrow(/PBT_MIN_RUNS/);
  });

  it("runs a zod round trip through pbt", () => {
    const schema = z.number().int();
    pbt(fc.property(fc.integer(), (n) => schema.safeParse(n).success));
  });
});
