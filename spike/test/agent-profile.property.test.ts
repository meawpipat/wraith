import * as fc from "fast-check";
import { describe, it } from "vitest";
import { findUnsafeToken, UNSAFE_TOKENS } from "../../tools/lib/unsafe-tokens.ts";
import {
  assertSafeProfile,
  buildKiroProfile,
  type ProfileOptions,
  READ_ONLY_TOOLS,
} from "../lib/agent-profile.ts";
import { pbt } from "./config.ts";

/** Every unsafe literal and pattern sample, read from the shared catalogue at test time. */
const SI_LITERALS: string[] = [
  ...UNSAFE_TOKENS.argvFlags.map((t) => t.literal),
  ...UNSAFE_TOKENS.envNames.map((t) => t.literal),
  ...UNSAFE_TOKENS.settingsValues.map((t) => t.literal),
  ...UNSAFE_TOKENS.patterns.flatMap((t) => [...t.samples]),
];

const WRITE_TOOLS = ["fs_write", "execute_bash", "shell", "write", "use_aws"];

const clean = (s: string): boolean => findUnsafeToken(s) === null;
const text = fc.string({ maxLength: 40 }).filter(clean);

const qArb = fc.oneof(
  fc.constantFrom("q3", "q3b", "q31", "q32", "q43", "q7"),
  fc.stringMatching(/^[a-z0-9]{1,8}$/),
);

const optionsArb: fc.Arbitrary<ProfileOptions> = fc
  .record(
    {
      q: qArb,
      prompt: text,
      hook: fc.record({ command: text, matcher: text }),
      writeAllowedPaths: fc.array(text, { maxLength: 3 }),
    },
    { requiredKeys: ["q", "prompt"] },
  )
  .filter((o) => clean(JSON.stringify(o)));

const wildcardArb = fc.constantFrom("*", "fs_*", "*_read", "@*");

describe("Feature: s-spikes, Property 18: Agent profiles contain only read-only pre-approved tools and no SI tokens", () => {
  /** **Validates: Requirements 7.9, 7.10, 7.11, 8.5** */
  it("a built profile passes assertSafeProfile and pre-approves only read-only tools", () => {
    pbt(
      fc.property(optionsArb, (o) => {
        const p = buildKiroProfile(o);
        assertSafeProfile(p);
        const allowed = p.allowedTools as string[];
        for (const t of allowed) {
          if (!READ_ONLY_TOOLS.includes(t)) return false;
        }
        return findUnsafeToken(JSON.stringify(p)) === null;
      }),
    );
  });

  /** **Validates: Requirements 7.9, 7.10, 7.11, 8.5** */
  it("each single mutation (write tool, wildcard, SI literal) makes assertSafeProfile throw", () => {
    pbt(
      fc.property(
        optionsArb,
        fc.constantFrom(...WRITE_TOOLS),
        wildcardArb,
        fc.constantFrom(...SI_LITERALS),
        fc.constantFrom("prompt", "description", "extra"),
        (o, writeTool, wildcard, literal, field) => {
          const base = buildKiroProfile(o);
          const throws = (p: unknown): boolean => {
            try {
              assertSafeProfile(p);
              return false;
            } catch {
              return true;
            }
          };
          const allowed = base.allowedTools as string[];
          return (
            throws({ ...base, allowedTools: [...allowed, writeTool] }) &&
            throws({ ...base, allowedTools: [...allowed, wildcard] }) &&
            throws({ ...base, [field]: `${String(base[field] ?? "")} ${literal}` })
          );
        },
      ),
    );
  });
});
