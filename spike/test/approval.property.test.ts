import * as fc from "fast-check";
import { describe, it } from "vitest";
import {
  type ApprovalPolicy,
  type PermissionOption,
  type PermissionRequest,
  pickOption,
} from "../lib/approval.ts";
import { pbt } from "./config.ts";

const kindArb = fc.constantFrom<PermissionOption["kind"]>(
  "allow_once",
  "allow_always",
  "reject_once",
  "reject_always",
);
const optionsArb = fc
  .array(kindArb, { minLength: 0, maxLength: 6 })
  .map((kinds): PermissionOption[] =>
    kinds.map((kind, i) => ({ optionId: `opt-${i}`, name: `Option ${i}`, kind })),
  );
const reqArb = optionsArb.map((options): PermissionRequest => ({ tool: "t", args: {}, options }));
const policyArb = fc.record({
  kind: fc.constantFrom<ApprovalPolicy["kind"]>("ask-owner", "reject-all"),
  allowAlways: fc.constantFrom<ApprovalPolicy["allowAlways"]>("never", "manual"),
  timeoutMs: fc.constant(120_000 as const),
});
const keyArb = fc.oneof(
  fc.constant(null),
  fc.constantFrom("1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "a", "\u0003", "", "10"),
  fc.string({ maxLength: 3 }),
);

describe("Feature: s-spikes, Property 16: The approval picker never allows without the owner's key and times out to a reject", () => {
  it("never allows without the owner's key, and rejects when non-interactive, reject-all or timed out", () => {
    pbt(
      fc.property(
        reqArb,
        keyArb,
        policyArb,
        fc.boolean(),
        fc.boolean(),
        (req, key, p, interactive, timedOut) => {
          const a = pickOption(req, key, p, interactive, timedOut);
          const forced = !interactive || p.kind === "reject-all" || timedOut;
          if (forced) {
            if (a === null) return false;
            if (a.outcome === "selected") return false;
            if (a.outcome === "rejected") {
              const o = req.options.find((x) => x.optionId === a.optionId);
              return o?.kind.startsWith("reject_") === true;
            }
            return req.options.every((o) => !o.kind.startsWith("reject_"));
          }
          if (a === null) return true;
          if (a.outcome !== "selected") return false;
          const o = req.options.find((x) => x.optionId === a.optionId);
          if (o === undefined || o.kind !== a.kind || a.by !== "owner") return false;
          if (key === null || !/^[1-9]$/.test(key)) return false;
          if (req.options[Number(key) - 1] !== o) return false;
          if (a.kind === "allow_always" && p.allowAlways !== "manual") return false;
          return true;
        },
      ),
    );
  });

  it("any non-null answer is an offered option or cancelled; allow kinds only come from owner keys", () => {
    pbt(
      fc.property(
        reqArb,
        keyArb,
        policyArb,
        fc.boolean(),
        fc.boolean(),
        (req, key, p, interactive, timedOut) => {
          const a = pickOption(req, key, p, interactive, timedOut);
          if (a === null || a.outcome === "cancelled") return true;
          const o = req.options.find((x) => x.optionId === a.optionId);
          if (o === undefined) return false;
          if (o.kind.startsWith("allow_")) return a.outcome === "selected" && a.by === "owner";
          return true;
        },
      ),
    );
  });
});
