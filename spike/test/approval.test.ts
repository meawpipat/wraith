import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ApprovalPolicy,
  askOwner,
  type PermissionRequest,
  pickOption,
} from "../lib/approval.ts";

const ask: ApprovalPolicy = { kind: "ask-owner", allowAlways: "never", timeoutMs: 120_000 };
const req: PermissionRequest = {
  tool: "shell",
  args: { cmd: "echo hi" },
  options: [
    { optionId: "a", name: "Allow", kind: "allow_once" },
    { optionId: "b", name: "Always", kind: "allow_always" },
    { optionId: "c", name: "Reject", kind: "reject_once" },
  ],
};
const noReject: PermissionRequest = { ...req, options: req.options.slice(0, 2) };

function streams(tty: boolean) {
  const stdin = Object.assign(new EventEmitter(), {
    isTTY: tty,
    setRawMode: vi.fn(),
    resume: vi.fn(),
    pause: vi.fn(),
  });
  const written: string[] = [];
  const stdout = { isTTY: tty, write: (s: string) => written.push(s) };
  return {
    stdin,
    stdout,
    written,
    io: { stdin, stdout } as unknown as Parameters<typeof askOwner>[2],
  };
}

describe("pickOption", () => {
  it("returns an allow option only with by:owner for a mapped key", () => {
    expect(pickOption(req, "1", ask, true, false)).toEqual({
      outcome: "selected",
      optionId: "a",
      kind: "allow_once",
      by: "owner",
    });
  });
  it("ignores the allow_always key unless manual", () => {
    expect(pickOption(req, "2", ask, true, false)).toBeNull();
    expect(pickOption(req, "2", { ...ask, allowAlways: "manual" }, true, false)).toMatchObject({
      kind: "allow_always",
      by: "owner",
    });
  });
  it("keeps waiting on unknown keys", () => {
    expect(pickOption(req, "x", ask, true, false)).toBeNull();
    expect(pickOption(req, "9", ask, true, false)).toBeNull();
  });
  it("rejects on timeout, cancels when no reject option exists", () => {
    expect(pickOption(req, "1", ask, true, true)).toMatchObject({
      outcome: "rejected",
      optionId: "c",
      reason: "timeout",
    });
    expect(pickOption(noReject, "1", ask, true, true)).toEqual({
      outcome: "cancelled",
      reason: "timeout",
    });
  });
  it("rejects when not interactive or reject-all", () => {
    expect(pickOption(req, "1", ask, false, false)).toMatchObject({ reason: "non-interactive" });
    expect(pickOption(req, "1", { ...ask, kind: "reject-all" }, true, false)).toMatchObject({
      reason: "policy",
    });
  });
});

describe("askOwner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("answers reject_once after 120 s", async () => {
    const s = streams(true);
    const p = askOwner(req, ask, s.io);
    await vi.advanceTimersByTimeAsync(120_000);
    await expect(p).resolves.toMatchObject({
      outcome: "rejected",
      optionId: "c",
      reason: "timeout",
    });
  });
  it("answers cancelled on timeout with no reject option", async () => {
    const s = streams(true);
    const p = askOwner(noReject, ask, s.io);
    await vi.advanceTimersByTimeAsync(120_000);
    await expect(p).resolves.toEqual({ outcome: "cancelled", reason: "timeout" });
  });
  it("rejects on a non-interactive stream without printing", async () => {
    const s = streams(false);
    await expect(askOwner(req, ask, s.io)).resolves.toMatchObject({ reason: "non-interactive" });
    expect(s.written).toHaveLength(0);
  });
  it("reject-all never reads a key", async () => {
    const s = streams(true);
    await expect(askOwner(req, { ...ask, kind: "reject-all" }, s.io)).resolves.toMatchObject({
      reason: "policy",
    });
    expect(s.stdin.listenerCount("data")).toBe(0);
    expect(s.stdin.setRawMode).not.toHaveBeenCalled();
  });
  it("returns an allow_once option with by:owner for its key", async () => {
    const s = streams(true);
    const p = askOwner(req, ask, s.io);
    s.stdin.emit("data", Buffer.from("1"));
    await expect(p).resolves.toEqual({
      outcome: "selected",
      optionId: "a",
      kind: "allow_once",
      by: "owner",
    });
    expect(s.written.join("")).toContain("not offered");
  });
});
