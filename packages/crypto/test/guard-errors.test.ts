import { describe, expect, it } from "vitest";
import { ProgrammerError, type ProgrammerReason } from "../src/errors.js";
import { failClosed, isPlainRecord, isRecord } from "../src/guard.js";

describe("failClosed", () => {
  it("returns true only for exactly true (sync and async)", async () => {
    expect(await failClosed(() => true)).toBe(true);
    expect(await failClosed(async () => true)).toBe(true);
  });

  it("turns a sync throw into false", async () => {
    expect(
      await failClosed(() => {
        throw new Error("boom");
      }),
    ).toBe(false);
  });

  it("turns a rejection into false", async () => {
    expect(await failClosed(() => Promise.reject(new Error("boom")))).toBe(false);
    expect(
      await failClosed(async () => {
        throw new Error("boom");
      }),
    ).toBe(false);
  });

  it("turns any non-true result into false", async () => {
    const results: unknown[] = [false, undefined, null, 1, 0, "true", {}, [], "", Number.NaN];
    for (const r of results) {
      expect(await failClosed(() => r as boolean)).toBe(false);
      expect(await failClosed(async () => r as boolean)).toBe(false);
    }
  });

  it("never throws on a non-Error throw value", async () => {
    expect(
      await failClosed(() => {
        throw "x";
      }),
    ).toBe(false);
  });
});

describe("isRecord / isPlainRecord", () => {
  class Foo {
    a = 1;
  }

  it("rejects null, primitives and arrays in both", () => {
    for (const v of [null, undefined, 1, "s", true, [], [1]]) {
      expect(isRecord(v)).toBe(false);
      expect(isPlainRecord(v)).toBe(false);
    }
  });

  it("accepts object literals and null-prototype objects in both", () => {
    expect(isRecord({})).toBe(true);
    expect(isPlainRecord({})).toBe(true);
    expect(isRecord(Object.create(null))).toBe(true);
    expect(isPlainRecord(Object.create(null))).toBe(true);
  });

  it("isRecord accepts class instances but isPlainRecord rejects them", () => {
    expect(isRecord(new Foo())).toBe(true);
    expect(isPlainRecord(new Foo())).toBe(false);
    expect(isPlainRecord(Object.create({}))).toBe(false);
    expect(isPlainRecord(new Date())).toBe(false);
  });
});

describe("ProgrammerError", () => {
  it("has the fixed prefix plus the reason as its exact message", () => {
    const reasons: ProgrammerReason[] = ["non_json_value", "empty_secret", "invalid_argument"];
    for (const reason of reasons) {
      expect(new ProgrammerError(reason).message).toBe(`wraith-crypto: ${reason}`);
    }
  });

  it("exposes reason, name and Error ancestry", () => {
    const e = new ProgrammerError("cyclic_value");
    expect(e.reason).toBe("cyclic_value");
    expect(e.name).toBe("ProgrammerError");
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(ProgrammerError);
  });

  it("carries no cause", () => {
    const e = new ProgrammerError("webcrypto_failed");
    expect("cause" in e).toBe(false);
    expect(e.cause).toBeUndefined();
  });
});
