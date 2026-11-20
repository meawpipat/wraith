import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UNSAFE_TOKENS } from "../../tools/lib/unsafe-tokens.ts";
import {
  assertSafeProfile,
  buildKiroProfile,
  profilePlacement,
  READ_ONLY_TOOLS,
  writeProfileFile,
} from "../lib/agent-profile.ts";
import type { OwnMarker } from "../lib/own-marker.ts";

let tmp = "";
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "wsp-prof-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function marker(): OwnMarker {
  return {
    v: 1,
    session: "wsp",
    qs: ["q43"],
    root: tmp,
    runnerPid: process.pid,
    startedAt: "2026-11-19T09:30:00.000Z",
    nonce: "0".repeat(32),
    pids: [],
    agentFiles: [],
  };
}

describe("buildKiroProfile / assertSafeProfile", () => {
  it("builds a read-only profile that passes the assertion", () => {
    const p = buildKiroProfile({ q: "q43", prompt: "say hi" });
    expect(p.name).toBe("wraith-spike-q43");
    expect(p.allowedTools).toEqual([...READ_ONLY_TOOLS]);
    expect(p.hooks).toBeUndefined();
    expect(() => assertSafeProfile(p)).not.toThrow();
  });

  it("adds a hook only for q3b", () => {
    const hook = { command: "node hook.ts /tmp/x", matcher: "*" };
    expect(buildKiroProfile({ q: "q3b", prompt: "p", hook }).hooks).toBeDefined();
    expect(buildKiroProfile({ q: "q43", prompt: "p", hook }).hooks).toBeUndefined();
  });

  it("never pre-approves the write tool for Q31", () => {
    const p = buildKiroProfile({ q: "q31", prompt: "p", writeAllowedPaths: ["/tmp/scratch"] });
    expect(JSON.stringify(p.allowedTools)).not.toContain("fs_write");
    expect(() => assertSafeProfile(p)).not.toThrow();
  });

  it("rejects a write tool, a wildcard, a bad name, a stray hook and an unsafe token", () => {
    const base = buildKiroProfile({ q: "q43", prompt: "p" });
    expect(() => assertSafeProfile({ ...base, allowedTools: ["fs_write"] })).toThrow();
    expect(() => assertSafeProfile({ ...base, allowedTools: ["*"] })).toThrow();
    expect(() => assertSafeProfile({ ...base, name: "other" })).toThrow();
    expect(() => assertSafeProfile({ ...base, hooks: { preToolUse: [] } })).toThrow();
    const literal = UNSAFE_TOKENS.argvFlags[0].literal;
    expect(() => assertSafeProfile({ ...base, prompt: `x ${literal}` })).toThrow();
  });
});

describe("profilePlacement", () => {
  it("prefers scratch, falls back to home, and Q32 is always home", () => {
    expect(profilePlacement("q43", "/s", "unknown", "/h")).toEqual({
      path: "/s/.kiro/agents/wraith-spike-q43.json",
      kind: "scratch",
    });
    expect(profilePlacement("q31", "/s", "scratch", "/h").kind).toBe("scratch");
    expect(profilePlacement("q31", "/s", "home", "/h")).toEqual({
      path: "/h/.kiro/agents/wraith-spike-q31.json",
      kind: "home",
    });
    expect(profilePlacement("q32", "/s", "scratch", "/h").kind).toBe("home");
  });
});

describe("writeProfileFile", () => {
  it("writes once, records the path, and never overwrites", () => {
    const m = marker();
    const p = buildKiroProfile({ q: "q43", prompt: "p" });
    const { path } = profilePlacement("q43", tmp, "scratch");
    writeProfileFile("q43", p, path, m);
    expect(JSON.parse(readFileSync(path, "utf8")).name).toBe("wraith-spike-q43");
    expect(m.agentFiles).toEqual([{ path, created: true }]);
    expect(() => writeProfileFile("q43", p, path, m)).toThrow();
    expect(m.agentFiles).toHaveLength(1);
  });

  it("leaves an existing file untouched", () => {
    const m = marker();
    const p = buildKiroProfile({ q: "q43", prompt: "p" });
    const path = join(tmp, ".kiro", "agents", "wraith-spike-q43.json");
    writeProfileFile("q43", p, path, m);
    writeFileSync(path, "mine");
    expect(() => writeProfileFile("q43", p, path, m)).toThrow();
    expect(readFileSync(path, "utf8")).toBe("mine");
  });

  it("refuses any other file name or folder", () => {
    const m = marker();
    const p = buildKiroProfile({ q: "q43", prompt: "p" });
    expect(() =>
      writeProfileFile("q43", p, join(tmp, ".kiro", "agents", "other.json"), m),
    ).toThrow();
    expect(() => writeProfileFile("q43", p, join(tmp, "wraith-spike-q43.json"), m)).toThrow();
    expect(() =>
      writeProfileFile("q32", p, join(tmp, ".kiro", "agents", "wraith-spike-q32.json"), m),
    ).toThrow();
    expect(m.agentFiles).toHaveLength(0);
  });
});
