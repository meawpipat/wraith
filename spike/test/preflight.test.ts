import { describe, expect, it } from "vitest";
import { buildChildEnv } from "../lib/env.ts";
import {
  formatPreflight,
  LONGEST_SOCKET_NAME,
  type PfId,
  type PreflightInput,
  runPreflight,
} from "../lib/preflight.ts";

function baseline(): PreflightInput {
  const session = "wsp-q2";
  const realRoot = "/private/tmp/hcw/q2";
  return {
    mode: "normal",
    q: "q2",
    env: { PATH: "/usr/bin", HOME: "/home/u" },
    session,
    root: "/tmp/hcw/q2",
    realRoot,
    stateHome: "/tmp/hcw/q2/s",
    configHome: "/tmp/hcw/q2/c",
    realStateHome: `${realRoot}/s`,
    realConfigHome: `${realRoot}/c`,
    hcSocketVar: null,
    socketPaths: [`${realRoot}/s/herdr-core/${session}/${"x".repeat(LONGEST_SOCKET_NAME)}`],
    defaultStateDir: "/home/u/.local/state/herdr-core/default",
    envHome: "/home/u",
    realHome: "/home/u",
    hcVersion: "hc 0.1.18",
    needsHcAtLeast: [0, 1, 18],
    rootState: { kind: "absent" },
    scriptTreeViolations: [],
  };
}

const deps = { buildChildEnv };

function ids(i: PreflightInput, d = deps): PfId[] {
  return runPreflight(i, d).failures.map((f) => f.id);
}

describe("preflight core", () => {
  it("passes the baseline", () => {
    expect(runPreflight(baseline(), deps)).toEqual({ ok: true, failures: [] });
  });

  it("PF-SESSION for default, empty and out-of-pattern sessions", () => {
    for (const session of ["default", "", "wsp-UPPER", "wsp-123456789", "other"]) {
      expect(ids({ ...baseline(), session })).toContain("PF-SESSION");
    }
  });

  it("PF-XDG for a sibling prefix /tmp/hcw-evil and for an unset home", () => {
    expect(ids({ ...baseline(), realStateHome: "/tmp/hcw-evil/s" })).toEqual(["PF-XDG"]);
    expect(ids({ ...baseline(), realConfigHome: "/tmp/other/c" })).toEqual(["PF-XDG"]);
    expect(ids({ ...baseline(), configHome: "" })).toEqual(["PF-XDG"]);
  });

  it("PF-SOCKLEN for a 91-byte socket path, passes at 90", () => {
    const b = baseline();
    const base = `${b.realRoot}/`;
    const at = (n: number): string => base + "y".repeat(n - base.length);
    expect(at(91)).toHaveLength(91);
    expect(ids({ ...b, socketPaths: [at(91)] })).toEqual(["PF-SOCKLEN"]);
    expect(ids({ ...b, socketPaths: [at(90)] })).toEqual([]);
  });

  it("PF-DEFAULT-PATH for a path equal to or under the default state dir", () => {
    const b = baseline();
    expect(ids({ ...b, socketPaths: [b.defaultStateDir] })).toContain("PF-DEFAULT-PATH");
    expect(ids({ ...b, socketPaths: [`${b.defaultStateDir}/sock`] })).toContain("PF-DEFAULT-PATH");
  });

  it("PF-HOME when HOME differs or is unset", () => {
    expect(ids({ ...baseline(), envHome: "/tmp/hcw/q2/h" })).toEqual(["PF-HOME"]);
    expect(ids({ ...baseline(), envHome: undefined })).toEqual(["PF-HOME"]);
  });

  it("PF-VERSION for too old, unparseable and missing; Q1 minimum is 0.1.17", () => {
    expect(ids({ ...baseline(), hcVersion: "hc 0.1.17" })).toEqual(["PF-VERSION"]);
    expect(ids({ ...baseline(), hcVersion: "garbage" })).toEqual(["PF-VERSION"]);
    expect(ids({ ...baseline(), hcVersion: null })).toEqual(["PF-VERSION"]);
    expect(ids({ ...baseline(), hcVersion: "hc 0.1.17", needsHcAtLeast: [0, 1, 17] })).toEqual([]);
  });

  it("PF-ROOT for live, foreign and stale without a valid marker", () => {
    expect(ids({ ...baseline(), rootState: { kind: "live" } })).toEqual(["PF-ROOT"]);
    expect(ids({ ...baseline(), rootState: { kind: "foreign" } })).toEqual(["PF-ROOT"]);
    expect(ids({ ...baseline(), rootState: { kind: "stale", markerOk: false } })).toEqual([
      "PF-ROOT",
    ]);
    expect(ids({ ...baseline(), rootState: { kind: "stale", markerOk: true } })).toEqual([]);
  });

  it("PF-WRAPPER for script tree violations", () => {
    expect(ids({ ...baseline(), scriptTreeViolations: ["spike/x.ts:1"] })).toEqual(["PF-WRAPPER"]);
  });

  it("PF-CHILD-ENV for a HC_SOCKET outside the root", () => {
    expect(ids({ ...baseline(), hcSocketVar: "/tmp/elsewhere/sock" })).toEqual(["PF-CHILD-ENV"]);
    expect(ids({ ...baseline(), hcSocketVar: "/private/tmp/hcw/q2/s/sock" })).toEqual([]);
  });

  it("PF-CHILD-ENV for a builder that leaks HERDR_*", () => {
    const leaky = {
      buildChildEnv: (x: Parameters<typeof buildChildEnv>[0]) => ({
        ...buildChildEnv(x),
        HERDR_X: "1",
      }),
    };
    expect(ids(baseline(), leaky)).toContain("PF-CHILD-ENV");
  });

  it("pane env present: passes with the allow-list builder, fails with a copying wrapper", () => {
    const b = {
      ...baseline(),
      env: { PATH: "/usr/bin", HC_SCOPE: "a", HC_TERMINAL_ID: "b", HC_TERMINAL_SOCKET: "/c" },
    };
    expect(ids(b)).toEqual([]);
    const copying = {
      buildChildEnv: (x: Parameters<typeof buildChildEnv>[0]) => {
        const out = buildChildEnv(x);
        for (const n of ["HC_SCOPE", "HC_TERMINAL_ID", "HC_TERMINAL_SOCKET"]) {
          const v = x.base[n];
          if (v !== undefined) out[n] = v;
        }
        return out;
      },
    };
    expect(ids(b, copying)).toEqual(["PF-PANE-ENV"]);
  });

  it("lists every failure at once", () => {
    const got = ids({
      ...baseline(),
      session: "default",
      hcVersion: null,
      rootState: { kind: "live" },
    });
    expect(got).toEqual(["PF-SESSION", "PF-VERSION", "PF-ROOT"]);
  });

  it("formatPreflight prints ids and only session, XDG paths and HC_SOCKET", () => {
    const i = { ...baseline(), session: "default", env: { SECRET: "s3cr3t-value" } };
    const text = formatPreflight(runPreflight(i, deps), i);
    expect(text).toContain("PF-SESSION");
    expect(text).toContain("XDG_STATE_HOME=/tmp/hcw/q2/s");
    expect(text).not.toContain("s3cr3t-value");
  });
});
