import { describe, expect, it } from "vitest";
import { GATE_LIST as TOOLS_GATE_LIST } from "../../tools/lib/spike-ids.ts";
import { GATE_LIST } from "../lib/ids.ts";

describe("gate list copies", () => {
  it("tools and spike keep the same 18 P0-D4 ids in the same order", () => {
    expect([...TOOLS_GATE_LIST]).toEqual([...GATE_LIST]);
    expect(TOOLS_GATE_LIST).toHaveLength(18);
  });
});
