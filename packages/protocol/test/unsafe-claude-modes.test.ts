/**
 * Feature: s-protocol, P-SI2-1: Claude permission modes are an allow-list, and the prompts flag
 * must be `host`. Flag names are built from fragments, so this file spells no token; unknown mode
 * names are arbitrary letters, tested only against the allow-list.
 */
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  CLAUDE_ASKING_MODES,
  CLAUDE_CODE_CHECKED_MIN,
  CLAUDE_PERMISSION_PROMPTS,
  findUnsafeToken,
  isClaudeAskingMode,
  UNSAFE_TOKENS,
} from "../src/unsafe.ts";
import { PBT_MIN_RUNS, pbt } from "./config.ts";

const MODE_FLAG = ["--permission", "mode"].join("-");
const PROMPTS_FLAG = ["--permission", "prompts"].join("-");
const SDK_KEY = ["permission", "Mode"].join("");

const word = fc.stringMatching(/^[a-z][a-zA-Z]{0,11}$/);
const notAsking = word.filter((w) => !CLAUDE_ASKING_MODES.some((m) => m === w));
const notHost = word.filter((w) => w !== CLAUDE_PERMISSION_PROMPTS);
const sep = fc.constantFrom(" ", "  ", "\t", "=");
const quote = fc.constantFrom("", '"', "'");

function pattern(id: string): string {
  const p = UNSAFE_TOKENS.patterns.find((x) => x.id === id);
  if (p === undefined) throw new Error(`no pattern ${id}`);
  return p.source;
}

describe("P-SI2-1: Claude asking modes", () => {
  it("the allow-list is manual and default, and the pattern sources spell the same list", () => {
    expect([...CLAUDE_ASKING_MODES].sort()).toEqual(["default", "manual"]);
    for (const id of [
      "claude-permission-mode-not-asking",
      "claude-cli-permission-mode-not-asking",
    ]) {
      const alt = /\(\?:([A-Za-z|]+)\)/.exec(pattern(id))?.[1];
      expect(alt?.split("|").sort(), id).toEqual([...CLAUDE_ASKING_MODES].sort());
    }
    expect(CLAUDE_CODE_CHECKED_MIN).toBe("2.1.323");
    expect(CLAUDE_PERMISSION_PROMPTS).toBe("host");
  });

  it("isClaudeAskingMode accepts only the listed names", () => {
    for (const m of CLAUDE_ASKING_MODES) expect(isClaudeAskingMode(m)).toBe(true);
    for (const v of ["", "Manual", "manual ", "plan", null, undefined, 1, {}]) {
      expect(isClaudeAskingMode(v)).toBe(false);
    }
  });

  it("the CLI flag is unsafe for every value outside the list, and safe for the listed ones", () => {
    pbt(
      fc.property(notAsking, sep, quote, (v, s, q) => {
        expect(findUnsafeToken(`claude ${MODE_FLAG}${s}${q}${v}`)?.group).toBe("patterns");
      }),
      { numRuns: PBT_MIN_RUNS },
    );
    for (const m of CLAUDE_ASKING_MODES) {
      expect(findUnsafeToken(`claude ${MODE_FLAG} ${m} --resume x`)).toBeNull();
      expect(findUnsafeToken(`${MODE_FLAG}=${m}`)).toBeNull();
    }
  });

  it("the SDK option form is unsafe for every value outside the list, and safe for the listed ones", () => {
    pbt(
      fc.property(notAsking, (v) => {
        expect(findUnsafeToken(`{ ${SDK_KEY}: "${v}" }`)?.group).toBe("patterns");
        expect(findUnsafeToken(`${SDK_KEY}='${v}'`)?.group).toBe("patterns");
      }),
      { numRuns: PBT_MIN_RUNS },
    );
    for (const m of CLAUDE_ASKING_MODES) {
      expect(findUnsafeToken(`{ ${SDK_KEY}: "${m}" }`)).toBeNull();
    }
  });

  it("an unknown mode name is refused even when it only starts with a listed one", () => {
    for (const v of ["manuals", "default2", "manual-x", "defaults"]) {
      expect(findUnsafeToken(`${MODE_FLAG} ${v}`)?.group, v).toBe("patterns");
    }
  });
});

describe("P-SI2-1: the prompts flag must be host", () => {
  it("any other value is unsafe, host is safe", () => {
    pbt(
      fc.property(notHost, sep, quote, (v, s, q) => {
        expect(findUnsafeToken(`claude ${PROMPTS_FLAG}${s}${q}${v}`)?.group).toBe("patterns");
      }),
      { numRuns: PBT_MIN_RUNS },
    );
    expect(findUnsafeToken(`claude ${PROMPTS_FLAG} ${CLAUDE_PERMISSION_PROMPTS}`)).toBeNull();
    expect(findUnsafeToken(`${PROMPTS_FLAG}=${CLAUDE_PERMISSION_PROMPTS}`)).toBeNull();
    expect(findUnsafeToken(`${PROMPTS_FLAG}=${CLAUDE_PERMISSION_PROMPTS}x`)?.group).toBe(
      "patterns",
    );
  });

  it("the flag name in backticks, with no value after it, is not a token", () => {
    expect(findUnsafeToken(`\`${PROMPTS_FLAG}\` is checked`)).toBeNull();
    expect(findUnsafeToken(`\`${MODE_FLAG}\`, \`${PROMPTS_FLAG}\`.`)).toBeNull();
  });
});
