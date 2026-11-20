import * as fc from "fast-check";
import { describe, it } from "vitest";
import { decideHook, type HookAnswer } from "../lib/hook-receiver.ts";
import { pbt } from "./config.ts";

const kinds = ["allow_once", "allow_always", "reject_once", "reject_always"] as const;

const answerArb: fc.Arbitrary<HookAnswer> = fc.oneof(
  fc.constant<HookAnswer>("timeout"),
  fc.constant<HookAnswer>("error"),
  fc
    .constantFrom(...kinds)
    .map((kind): HookAnswer => ({ outcome: "selected", optionId: "o", kind, by: "owner" })),
  fc
    .constantFrom("timeout", "non-interactive", "policy", "no-reject-option" as const)
    .map(
      (reason): HookAnswer => ({ outcome: "rejected", optionId: "o", reason: reason as "timeout" }),
    ),
  fc
    .constantFrom("timeout", "non-interactive", "policy" as const)
    .map((reason): HookAnswer => ({ outcome: "cancelled", reason: reason as "timeout" })),
);

const nonceArb = fc.string({ minLength: 1, maxLength: 40 });
const bodyArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.record({ nonce: nonceArb, event: fc.anything() }),
  fc.anything(),
  fc.record({ nonce: fc.oneof(fc.integer(), fc.constant(""), fc.constant(null)) }),
  fc.constant(null),
  fc.constant(undefined),
  fc.array(fc.anything()),
);
const tokenArb = fc.oneof(fc.constant(undefined), fc.string({ maxLength: 70 }));

function isWellFormed(b: unknown): b is { nonce: string } {
  if (typeof b !== "object" || b === null || Array.isArray(b)) return false;
  const n = (b as Record<string, unknown>).nonce;
  return typeof n === "string" && n.length > 0 && n.length <= 128 && "event" in b;
}

describe("Feature: s-spikes, Property 17: The hook decision fails closed", () => {
  it("blocks with exit code 2 unless token, body and an owner allow_once all hold", () => {
    pbt(
      fc.property(
        fc.string({ minLength: 1, maxLength: 70 }),
        tokenArb,
        fc.boolean(),
        bodyArb,
        answerArb,
        (expected, given, useExpected, body, answer) => {
          const token = useExpected ? expected : given;
          const r = decideHook({ token, body }, expected, answer);
          const allowed =
            token === expected &&
            isWellFormed(body) &&
            typeof answer === "object" &&
            answer.outcome === "selected" &&
            answer.kind === "allow_once";
          if (allowed) {
            return (
              r.exitCode === 0 &&
              r.body.decision === "allow" &&
              r.body.nonce === (body as { nonce: string }).nonce
            );
          }
          return r.exitCode === 2 && r.body.decision === "block";
        },
      ),
    );
  });
});
