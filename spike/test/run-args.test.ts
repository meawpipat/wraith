import { describe, expect, it } from "vitest";
import type { SpikeMeta } from "../../tools/lib/spike-meta.ts";
import { OWNER_LIST } from "../lib/ids.ts";
import { EXIT } from "../lib/outcome.ts";
import { defaultRunIo, main, parseArgs, type RunIo } from "../run.ts";

const ownerMeta: SpikeMeta = {
  id: "q2",
  group: "A",
  cost: "none",
  runBy: "owner",
  agents: [],
  maxPrompts: 0,
  maxWallSeconds: 60,
  estimateCredits: null,
  claudePrompts: 0,
  human: [],
  depends: [],
  shares: null,
  allowAlways: "never",
  assumption: "",
};

function testIo(lines: string[]): RunIo {
  return {
    ...defaultRunIo(),
    stdinIsTTY: false,
    stdoutIsTTY: false,
    out: (l) => {
      lines.push(l);
    },
    err: (l) => {
      lines.push(l);
    },
    readMeta: () => ({ ok: true, meta: ownerMeta }),
    load: () => Promise.reject(new Error("no spike may load")),
    rootPrefix: "/nonexistent-wraith-test-root/hcw",
  };
}

describe("parseArgs", () => {
  it("reads ids, flags and subcommands", () => {
    expect(parseArgs(["q3", "Q4", "q3"])).toEqual({
      ids: ["q3", "q4"],
      observeDefault: false,
      allowHomeProfile: false,
      rest: [],
    });
    expect(parseArgs(["q14", "--observe-default"])).toMatchObject({
      ids: ["q14"],
      observeDefault: true,
    });
    expect(parseArgs(["budget", "show"])).toMatchObject({ subcommand: "budget", rest: ["show"] });
    expect(parseArgs(["list"])).toMatchObject({ subcommand: "list", ids: [] });
  });

  it("refuses unknown ids by listing the known ones", () => {
    const r = parseArgs(["nope"]);
    expect("error" in r && OWNER_LIST.every((id) => r.error.includes(id))).toBe(true);
  });

  it("refuses --observe-default for anything but q14", () => {
    expect("error" in parseArgs(["q2", "--observe-default"])).toBe(true);
  });
});

describe("parseArgs --allow-home-profile", () => {
  const refused = { error: "--allow-home-profile is only for the Kiro profile spikes" };

  it("is accepted when every id is a Kiro profile spike", () => {
    expect(parseArgs(["q43", "--allow-home-profile"])).toMatchObject({
      ids: ["q43"],
      allowHomeProfile: true,
    });
    expect(parseArgs(["q3", "q23", "--allow-home-profile"])).toMatchObject({
      ids: ["q3", "q23"],
      allowHomeProfile: true,
    });
    expect(parseArgs(["q10", "--allow-home-profile"])).toMatchObject({ allowHomeProfile: true });
    expect(parseArgs(["q43"])).toMatchObject({ allowHomeProfile: false });
  });

  it("is refused when any id is not a Kiro profile spike", () => {
    expect(parseArgs(["q2", "--allow-home-profile"])).toEqual(refused);
    expect(parseArgs(["q3", "q2", "--allow-home-profile"])).toEqual(refused);
    expect(parseArgs(["q14", "--allow-home-profile"])).toEqual(refused);
  });

  it("still refuses an unknown flag", () => {
    expect("error" in parseArgs(["q43", "--allow-everything"])).toBe(true);
  });
});

describe("main", () => {
  it("exits 1 on an unknown id and starts nothing", async () => {
    const lines: string[] = [];
    expect(await main(["nope"], testIo(lines))).toBe(EXIT.INTERNAL);
    expect(lines.join("\n")).toContain("q43");
  });

  it("lists all 19 ids", async () => {
    const lines: string[] = [];
    expect(await main(["list"], testIo(lines))).toBe(EXIT.OK);
    expect(lines).toHaveLength(19);
  });

  it("ends pending for an owner spike without a terminal", async () => {
    const lines: string[] = [];
    expect(await main(["q2"], testIo(lines))).toBe(EXIT.PENDING);
    expect(lines.join("\n")).toContain("needs interactive terminal");
  });
});
