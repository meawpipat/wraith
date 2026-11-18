import * as fc from "fast-check";
import { describe, it } from "vitest";
import { BASE_PASS, buildChildEnv, type EnvProfile, isPaneEnvName } from "../lib/env.ts";
import { LONGEST_SOCKET_NAME, type PreflightInput, runPreflight } from "../lib/preflight.ts";
import { pbt } from "./config.ts";

const PANE_VARS = ["HC_SCOPE", "HC_TERMINAL_ID", "HC_TERMINAL_SOCKET"] as const;

function paneBaseline(env: Record<string, string>): PreflightInput {
  const session = "wsp-q2";
  const realRoot = "/private/tmp/hcw/q2";
  return {
    mode: "normal",
    q: "q2",
    env,
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

const name = fc.oneof(
  fc.constantFrom(
    ...BASE_PASS,
    "HC_SESSION",
    "HC_SOCKET",
    "HC_SCOPE",
    "HERDR_X",
    "XDG_STATE_HOME",
    "XDG_CONFIG_HOME",
  ),
  fc.stringMatching(/^[A-Z][A-Z0-9_]{0,12}$/),
  fc.stringMatching(/^(HC|HERDR|XDG|AWS|API)_[A-Z0-9_]{0,8}$/),
  fc.constantFrom("GITHUB_TOKEN", "ANTHROPIC_API_KEY", "SECRET", "__proto__", "constructor"),
);
const baseEnv = fc
  .array(fc.tuple(name, fc.option(fc.string(), { nil: undefined })))
  .map((pairs) => {
    const o: Record<string, string | undefined> = {};
    for (const [k, v] of pairs)
      Object.defineProperty(o, k, {
        value: v,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    return o;
  });

describe("env property", () => {
  it("Feature: s-spikes, Property 1: Child environments come from the allow-list only", () => {
    pbt(
      fc.property(
        baseEnv,
        fc.constantFrom<EnvProfile>("hc", "agent", "listener", "tool"),
        fc.array(name),
        fc.stringMatching(/^wsp(-[a-z0-9]{1,8})?$/),
        fc.stringMatching(/^\/tmp\/hcw\/[a-z0-9]{1,6}$/),
        (base, profile, extraPass, session, root) => {
          const env = buildChildEnv({ base, profile, session, root, extraPass });
          const own = Object.getOwnPropertyNames(env);
          const allowed = new Set<string>(BASE_PASS);
          if (profile === "hc")
            for (const k of ["HC_SESSION", "XDG_STATE_HOME", "XDG_CONFIG_HOME"]) allowed.add(k);
          if (profile === "agent") for (const k of extraPass) allowed.add(k);
          for (const k of own) {
            if (!allowed.has(k)) throw new Error(`key outside allow-list: ${k}`);
            if (isPaneEnvName(k) && !(profile === "hc" && k === "HC_SESSION"))
              throw new Error(`pane name: ${k}`);
            if (profile !== "hc" && k.startsWith("XDG_"))
              throw new Error(`XDG in ${profile}: ${k}`);
          }
          if (profile === "hc") {
            if (env.HC_SESSION !== session) throw new Error("HC_SESSION differs");
            if (env.XDG_STATE_HOME !== `${root}/s`) throw new Error("XDG_STATE_HOME differs");
            if (env.XDG_CONFIG_HOME !== `${root}/c`) throw new Error("XDG_CONFIG_HOME differs");
          }
        },
      ),
    );
  });

  it("Feature: s-spikes, Property 6: Pane environment never reaches a child, and a leaking builder is caught", () => {
    const paneEnv = fc
      .record({
        HC_SCOPE: fc.option(fc.string(), { nil: undefined }),
        HC_TERMINAL_ID: fc.option(fc.string(), { nil: undefined }),
        HC_TERMINAL_SOCKET: fc.option(fc.string(), { nil: undefined }),
      })
      .filter((r) => PANE_VARS.some((n) => r[n] !== undefined))
      .map((r) => {
        const env: Record<string, string> = { PATH: "/usr/bin", HOME: "/home/u" };
        for (const n of PANE_VARS) {
          const v = r[n];
          if (v !== undefined) env[n] = v;
        }
        return env;
      });
    pbt(
      fc.property(paneEnv, (env) => {
        const real = runPreflight(paneBaseline(env), { buildChildEnv }).failures.map((f) => f.id);
        if (real.includes("PF-CHILD-ENV") || real.includes("PF-PANE-ENV")) {
          throw new Error(`real builder flagged: ${real.join(",")}`);
        }
        const leaking: typeof buildChildEnv = (i) => {
          const out = buildChildEnv(i);
          for (const n of PANE_VARS) {
            const v = i.base[n];
            if (v !== undefined) out[n] = v;
          }
          return out;
        };
        const bad = runPreflight(paneBaseline(env), { buildChildEnv: leaking }).failures.map(
          (f) => f.id,
        );
        if (!bad.includes("PF-PANE-ENV")) throw new Error("leaking builder not caught");
      }),
    );
  });
});
