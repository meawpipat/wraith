import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { PermissionAnswer, PermissionRequest } from "../../lib/approval.ts";
import {
  CLAUDE_DRIVER_UNAVAILABLE,
  makePermissionGate,
  startClaudeSession,
} from "../../lib/claude-driver.ts";
import { assertSafeClaudeLaunch, buildClaudeLaunch } from "../../lib/claude-launch.ts";
import { makeFakeClaudeDriver } from "../support/fake-claude-driver.ts";

const req: PermissionRequest = {
  tool: "Edit",
  args: { file: "a.txt" },
  options: [
    { optionId: "1", name: "Allow once", kind: "allow_once" },
    { optionId: "2", name: "Reject", kind: "reject_once" },
  ],
};
const never = (): Promise<PermissionAnswer> => new Promise(() => {});
const selected = (kind: "allow_once" | "reject_once"): PermissionAnswer => ({
  outcome: "selected",
  optionId: "x",
  kind,
  by: "owner",
});

describe("claude driver port", () => {
  it("the fake sees options that pass assertSafeClaudeLaunch", async () => {
    const fake = makeFakeClaudeDriver();
    const launch = buildClaudeLaunch({ cwd: "/tmp/x", askOwner: never });
    const s = await startClaudeSession(fake, launch, never);
    expect(fake.received).toHaveLength(1);
    expect(fake.received[0]).toBe(launch);
    expect(() => assertSafeClaudeLaunch(launch)).not.toThrow();
    await s.close();
    expect(fake.closed).toEqual([s.sessionId]);
  });

  it("refuses an unsafe view before the driver starts", async () => {
    const fake = makeFakeClaudeDriver();
    const launch = {
      ...buildClaudeLaunch({ cwd: "/tmp/x", askOwner: never }),
      settingSources: ["user"],
    };
    await expect(startClaudeSession(fake, launch, never)).rejects.toThrow(/spike-claude-unsafe/);
    expect(fake.received).toHaveLength(0);
  });

  it("denies on timeout", async () => {
    expect(await makePermissionGate(never, 10)(req)).toBe("deny");
  });

  it("denies on error and reject, allows only an owner allow", async () => {
    expect(await makePermissionGate(() => Promise.reject(new Error("x")))(req)).toBe("deny");
    expect(await makePermissionGate(async () => selected("reject_once"))(req)).toBe("deny");
    expect(
      await makePermissionGate(async () => ({ outcome: "cancelled", reason: "timeout" }))(req),
    ).toBe("deny");
    expect(await makePermissionGate(async () => selected("allow_once"))(req)).toBe("allow");
  });

  it("routes session tool requests through the gate and exposes commands and fork", async () => {
    const fake = makeFakeClaudeDriver({
      toolRequests: [req],
      commands: [{ name: "review" }],
      fork: { offered: true },
    });
    const s = await startClaudeSession(
      fake,
      buildClaudeLaunch({ cwd: "/tmp/x", askOwner: never }),
      async () => selected("reject_once"),
    );
    await s.prompt("hi");
    expect(fake.decisions).toEqual(["deny"]);
    expect((await s.supportedCommands()).map((c) => c.name)).toEqual(["review"]);
    expect((await s.offerFork()).offered).toBe(true);
  });

  it("property: any non-allow answer is denied", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<PermissionAnswer>(
          selected("reject_once"),
          { outcome: "rejected", optionId: "2", reason: "policy" },
          { outcome: "cancelled", reason: "non-interactive" },
        ),
        async (a) => {
          expect(await makePermissionGate(async () => a)(req)).toBe("deny");
        },
      ),
      { numRuns: 20 },
    );
  });

  it("exposes the pending reason", () => {
    expect(CLAUDE_DRIVER_UNAVAILABLE).toBe("Claude driver not available");
  });
});
