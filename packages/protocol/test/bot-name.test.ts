/**
 * Example tests for the bot name rule ^[a-z0-9][a-z0-9-]{0,31}$ (P1-D13).
 * **Validates: Requirements 9.3, 24.6**
 */
import { describe, expect, it } from "vitest";
import { BotName } from "../src/base.ts";

const accepts = (s: string) => BotName.safeParse(s).success;

describe("BotName", () => {
  it.each([
    ["single letter", "a"],
    ["single digit", "0"],
    ["lowercase with hyphen", "my-bot"],
    ["digits first", "1bot"],
    ["all digits", "123"],
    ["trailing hyphen allowed", "bot-"],
    ["consecutive hyphens", "a--b"],
    ["32 characters", "a".repeat(32)],
    ["32 characters with hyphens", `a${"-".repeat(31)}`],
  ])("accepts %s", (_label, name) => {
    expect(accepts(name)).toBe(true);
  });

  it.each([
    ["empty", ""],
    ["leading hyphen", "-bot"],
    ["only a hyphen", "-"],
    ["33 characters", "a".repeat(33)],
    ["uppercase", "Bot"],
    ["all uppercase", "BOT"],
    ["space inside", "my bot"],
    ["leading space", " bot"],
    ["trailing space", "bot "],
    ["underscore", "my_bot"],
    ["dot", "my.bot"],
    ["non-ASCII letter", "bót"],
    ["non-ASCII only", "ボット"],
    ["emoji", "bot🙂"],
    ["trailing newline", "bot\n"],
    ["embedded newline", "bo\nt"],
    ["trailing carriage return", "bot\r"],
  ])("rejects %s", (_label, name) => {
    expect(accepts(name)).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(BotName.safeParse(undefined).success).toBe(false);
    expect(BotName.safeParse(null).success).toBe(false);
    expect(BotName.safeParse(12).success).toBe(false);
  });
});
