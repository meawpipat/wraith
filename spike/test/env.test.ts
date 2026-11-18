import { describe, expect, it } from "vitest";
import { BASE_PASS, buildChildEnv, isPaneEnvName } from "../lib/env.ts";

const base = {
  PATH: "/usr/bin",
  HOME: "/home/u",
  LANG: "C",
  TERM: "xterm",
  TMPDIR: "/tmp",
  HC_SCOPE: "s",
  HC_TERMINAL_ID: "t",
  HC_TERMINAL_SOCKET: "/x",
  HC_SOCKET: "/y",
  HERDR_ENV: "e",
  XDG_STATE_HOME: "/leak",
  XDG_CONFIG_HOME: "/leak",
  API_TOKEN: "secret",
};

describe("buildChildEnv", () => {
  it("hc profile adds the session and XDG dirs below the root", () => {
    const env = buildChildEnv({ base, profile: "hc", session: "wsp-q1", root: "/tmp/hcw/q1" });
    expect(env).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/u",
      LANG: "C",
      TERM: "xterm",
      TMPDIR: "/tmp",
      HC_SESSION: "wsp-q1",
      XDG_STATE_HOME: "/tmp/hcw/q1/s",
      XDG_CONFIG_HOME: "/tmp/hcw/q1/c",
    });
  });

  it("agent profile adds only extraPass names and no XDG_*", () => {
    const env = buildChildEnv({ base, profile: "agent", extraPass: ["API_TOKEN", "MISSING"] });
    expect(Object.keys(env).sort()).toEqual([...BASE_PASS, "API_TOKEN"].sort());
    expect(Object.keys(env).some((k) => k.startsWith("XDG_"))).toBe(false);
  });

  it("listener and tool add nothing beyond BASE_PASS", () => {
    for (const profile of ["listener", "tool"] as const) {
      const env = buildChildEnv({ base, profile, extraPass: ["API_TOKEN"] });
      expect(Object.keys(env).sort()).toEqual([...BASE_PASS].sort());
    }
  });

  it("never lets pane names through in any profile", () => {
    for (const profile of ["hc", "agent", "listener", "tool"] as const) {
      const env = buildChildEnv({
        base,
        profile,
        session: "wsp-q1",
        root: "/r",
        extraPass: ["HC_X", "HERDR_ENV", "HC_SOCKET"],
      });
      for (const name of [
        "HC_SCOPE",
        "HC_TERMINAL_ID",
        "HC_TERMINAL_SOCKET",
        "HC_SOCKET",
        "HC_X",
        "HERDR_ENV",
      ]) {
        expect(env).not.toHaveProperty(name);
      }
    }
  });

  it("isPaneEnvName matches HC_* and HERDR_* only", () => {
    expect(isPaneEnvName("HC_SESSION")).toBe(true);
    expect(isPaneEnvName("HERDR_X")).toBe(true);
    expect(isPaneEnvName("PATH")).toBe(false);
    expect(isPaneEnvName("XHC_A")).toBe(false);
  });
});
