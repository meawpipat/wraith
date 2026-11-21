import * as fc from "fast-check";
import { describe, it } from "vitest";
import {
  CLAUDE_ASKING_MODES,
  CLAUDE_PERMISSION_PROMPTS,
  UNSAFE_TOKENS,
} from "../../tools/lib/unsafe-tokens.ts";
import {
  assertSafeClaudeLaunch,
  buildClaudeLaunch,
  type ClaudeLaunchView,
  READ_ONLY_CLAUDE_TOOLS,
} from "../lib/claude-launch.ts";
import { pbt } from "./config.ts";
import { makeFakeClaudeSdk } from "./support/fake-claude-sdk.ts";

// Feature: s-spikes, Property 22: Unsafe Claude launch options are refused
// **Validates: Requirements 7.11, 15.6, 16.3**

const LITERALS: readonly string[] = [
  ...UNSAFE_TOKENS.argvFlags,
  ...UNSAFE_TOKENS.envNames,
  ...UNSAFE_TOKENS.settingsValues,
].map((e) => e.literal);

const word = fc.stringMatching(/^[a-z][a-z/]{0,10}$/);
const tool = fc.oneof(
  fc.constantFrom(...READ_ONLY_CLAUDE_TOOLS),
  fc.constantFrom("Write", "Bash", "Edit", "*", "Read*", "Task"),
  word,
);
const mode = fc.oneof(
  fc.constantFrom(...CLAUDE_ASKING_MODES),
  fc.constantFrom("plan", "auto", "x", "manuals", ""),
);
const prompts = fc.constantFrom<string | undefined>(undefined, undefined, "host", "none", "x", "");
const settings = fc.constantFrom<unknown>(undefined, undefined, null, "", "/s.json", {});

const options: fc.Arbitrary<ClaudeLaunchView> = fc
  .record({
    settingSources: fc.oneof(fc.constant([]), fc.array(word, { maxLength: 2 })),
    permMode: mode,
    permPrompts: prompts,
    allowedTools: fc.option(fc.array(tool, { maxLength: 4 }), { nil: undefined }),
    allowRules: fc.oneof(fc.constant([]), fc.array(word, { maxLength: 2 })),
    settings,
    cwd: fc.oneof(
      word,
      fc.tuple(word, fc.constantFrom(...LITERALS)).map(([w, l]) => `/${w}/${l}`),
    ),
  })
  .map((r) => {
    const o: { -readonly [K in keyof ClaudeLaunchView]: ClaudeLaunchView[K] } = {
      settingSources: r.settingSources,
      permMode: r.permMode,
      allowRules: r.allowRules,
      cwd: r.cwd,
      askOwner: () => {},
    };
    if (r.permPrompts !== undefined) o.permPrompts = r.permPrompts;
    if (r.allowedTools !== undefined) o.allowedTools = r.allowedTools;
    if (r.settings !== undefined) o.settings = r.settings;
    return o;
  });

function expectedUnsafe(o: ClaudeLaunchView): boolean {
  return (
    o.settingSources.length > 0 ||
    !CLAUDE_ASKING_MODES.some((m) => m === o.permMode) ||
    (o.permPrompts !== undefined && o.permPrompts !== CLAUDE_PERMISSION_PROMPTS) ||
    o.allowRules.length > 0 ||
    (o.allowedTools ?? []).some((t) => t.includes("*") || !READ_ONLY_CLAUDE_TOOLS.includes(t)) ||
    (o.settings !== undefined && o.settings !== null) ||
    LITERALS.some((l) => (o.cwd ?? "").includes(l))
  );
}

function throws(o: ClaudeLaunchView): boolean {
  try {
    assertSafeClaudeLaunch(o);
    return false;
  } catch {
    return true;
  }
}

describe("Feature: s-spikes, Property 22: Unsafe Claude launch options are refused", () => {
  it("throws iff a listed condition holds", () => {
    pbt(fc.property(options, (o) => throws(o) === expectedUnsafe(o)));
  });

  it("never throws for safe fields, and the fake SDK sees a safe object from buildClaudeLaunch", () => {
    pbt(
      fc.property(
        word,
        fc.option(fc.subarray([...READ_ONLY_CLAUDE_TOOLS]), { nil: undefined }),
        (cwd, tools) => {
          const base = buildClaudeLaunch({ cwd: `/${cwd}`, askOwner: () => {} });
          const { allowedTools: _a, ...rest } = base;
          const safe: ClaudeLaunchView =
            tools === undefined ? rest : { ...rest, allowedTools: tools };
          if (throws(safe)) return false;
          const sdk = makeFakeClaudeSdk();
          sdk.query(base);
          const seen = sdk.received[0];
          return seen === base && seen !== undefined && !throws(seen);
        },
      ),
    );
  });
});
