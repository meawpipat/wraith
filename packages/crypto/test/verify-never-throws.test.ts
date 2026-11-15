// Feature: s-crypto, Property 12: Verification never throws
// Validates: Requirements 3.1, 3.2, 3.3, 3.8, 8.13, 13.10
// Portable: no `node:` import. HMAC, pairing and payload verifiers are added in task 12.1.
import * as fc from "fast-check";
import { describe, it } from "vitest";
import { requestHashEquals } from "../src/request-hash.js";
import { verify, verifyBytes } from "../src/sign.js";
import { pbt } from "./config.js";
import { anyHostileOrAnythingThunkArb, hostileThunkArb } from "./support/hostile.js";

const thunks = {
  hostile: hostileThunkArb,
  "hostile or anything": anyHostileOrAnythingThunkArb,
};

describe("Feature: s-crypto, Property 12: Verification never throws", () => {
  for (const [name, arb] of Object.entries(thunks)) {
    it(`verify resolves to a boolean for any scope, signature and key (${name})`, async () => {
      await pbt(
        fc.asyncProperty(arb, arb, arb, async (a, b, c) => {
          let result: unknown;
          try {
            result = await verify(a(), b(), c());
          } catch {
            return false;
          }
          return typeof result === "boolean";
        }),
      );
    });

    it(`verifyBytes resolves to a boolean for any bytes, signature and key (${name})`, async () => {
      await pbt(
        fc.asyncProperty(arb, arb, arb, async (a, b, c) => {
          let result: unknown;
          try {
            result = await verifyBytes(a(), b(), c());
          } catch {
            return false;
          }
          return typeof result === "boolean";
        }),
      );
    });

    it(`requestHashEquals returns a boolean for any pair (${name})`, () => {
      pbt(
        fc.property(arb, arb, (a, b) => {
          let result: unknown;
          try {
            result = requestHashEquals(a(), b());
          } catch {
            return false;
          }
          return typeof result === "boolean";
        }),
      );
    });
  }
});
