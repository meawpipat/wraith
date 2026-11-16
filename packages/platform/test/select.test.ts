import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  darwin,
  linux,
  ProgrammerError,
  selectPlatform,
  WIN32_NOTICE,
  WSL2_DOCS_URL,
  win32,
} from "../src/index.js";
import { pbt } from "./config.js";

describe("selectPlatform", () => {
  it("returns the adapter with the requested id", () => {
    expect(selectPlatform("darwin")).toBe(darwin);
    expect(selectPlatform("linux")).toBe(linux);
    expect(selectPlatform("win32")).toBe(win32);
    expect(darwin.id).toBe("darwin");
    expect(linux.id).toBe("linux");
    expect(win32.id).toBe("win32");
  });

  it("throws ProgrammerError unsupported_platform for freebsd", () => {
    let caught: unknown;
    try {
      selectPlatform("freebsd");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ProgrammerError);
    expect((caught as ProgrammerError).reason).toBe("unsupported_platform");
    expect((caught as ProgrammerError).message).toContain("freebsd");
  });

  it("win32 exposes the WSL2 notice and exit code 1", () => {
    expect(win32.notice).toBe(WIN32_NOTICE);
    expect(WIN32_NOTICE).toContain(WSL2_DOCS_URL);
    expect(win32.exitCode).toBe(1);
  });

  it("isWsl() returns false and never throws", () => {
    expect(() => linux.isWsl()).not.toThrow();
    expect(linux.isWsl()).toBe(false);
  });
});

describe("selectPlatform properties", () => {
  // Feature: s-ops-packaging, Property 8: The Platform_Selector is total and exact
  // **Validates: Requirements 8.2, 8.4, 9.3, 9.4, 9.10**
  it("Feature: s-ops-packaging, Property 8: The Platform_Selector is total and exact", () => {
    const adapters = { darwin, linux, win32 } as const;
    const safe = /^[A-Za-z0-9_-]{1,32}$/;
    const input = fc.oneof(
      fc.string({ unit: "binary" }),
      fc.string({ unit: "grapheme", maxLength: 100 }),
      fc.string({ minLength: 33, maxLength: 200 }),
      fc.string().map((s) => `darwin${s}`),
      fc.string().map((s) => `${s}linux`),
      fc.constantFrom("darwin", "linux", "win32"),
    );
    pbt(
      fc.property(input, (value) => {
        if (value === "darwin" || value === "linux" || value === "win32") {
          const adapter = selectPlatform(value);
          expect(adapter).toBe(adapters[value]);
          expect(adapter.id).toBe(value);
          return;
        }
        let caught: unknown;
        try {
          selectPlatform(value);
        } catch (error) {
          caught = error;
        }
        expect(caught).toBeInstanceOf(ProgrammerError);
        const err = caught as ProgrammerError;
        expect(err.reason).toBe("unsupported_platform");
        const shown = safe.test(value) ? value : "<invalid>";
        expect(err.message).toBe(`wraith-platform: unsupported platform ${shown}`);
      }),
    );
    expect(win32.notice).toBe(WIN32_NOTICE);
    expect(win32.exitCode).toBe(1);
    expect(() => linux.isWsl()).not.toThrow();
    expect(typeof linux.isWsl()).toBe("boolean");
  });
});
