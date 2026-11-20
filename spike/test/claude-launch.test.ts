import { describe, expect, it } from "vitest";
import { UNSAFE_TOKENS } from "../../tools/lib/unsafe-tokens.ts";
import {
  assertSafeClaudeLaunch,
  buildClaudeLaunch,
  type ClaudeLaunchView,
} from "../lib/claude-launch.ts";
import { makeFakeClaudeSdk } from "./support/fake-claude-sdk.ts";

const safe = (): ClaudeLaunchView => buildClaudeLaunch({ cwd: "/tmp/scratch", askOwner: () => {} });

describe("claude launch options", () => {
  it("passes the object built to the fake SDK and it is safe", () => {
    const sdk = makeFakeClaudeSdk();
    const built = safe();
    sdk.query(built);
    expect(sdk.received[0]).toBe(built);
    expect(() => assertSafeClaudeLaunch(sdk.received[0] as ClaudeLaunchView)).not.toThrow();
  });

  it("accepts an absent tools list", () => {
    const { allowedTools: _t, ...rest } = safe();
    expect(() => assertSafeClaudeLaunch(rest)).not.toThrow();
  });

  it("refuses each unsafe field", () => {
    const base = safe();
    const bad: ClaudeLaunchView[] = [
      { ...base, settingSources: ["user"] },
      { ...base, permMode: "plan" },
      { ...base, allowRules: ["Bash(ls)"] },
      { ...base, allowedTools: ["Write"] },
      { ...base, allowedTools: ["Read*"] },
      { ...base, settings: "/some/settings.json" },
      { ...base, settings: {} },
    ];
    for (const o of bad) expect(() => assertSafeClaudeLaunch(o)).toThrow(/^spike-claude-unsafe: /);
  });

  it("refuses an SI token in the serialised options", () => {
    const literal = UNSAFE_TOKENS.argvFlags[0]?.literal ?? "";
    expect(literal).not.toBe("");
    expect(() => assertSafeClaudeLaunch({ ...safe(), cwd: `/tmp/${literal}` })).toThrow();
  });
});
