import { posix } from "node:path";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { buildChildEnv } from "../lib/env.ts";
import {
  formatPreflight,
  isUnder,
  type PfId,
  type PreflightInput,
  parseHcVersion,
  runPreflight,
  versionAtLeast,
} from "../lib/preflight.ts";
import { pbt } from "./config.ts";

const deps = { buildChildEnv };

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
    socketPaths: [`${realRoot}/s/herdr-core/${session}/${"x".repeat(40)}`],
    defaultStateDir: "/home/u/.local/state/herdr-core/default",
    envHome: "/home/u",
    realHome: "/home/u",
    hcVersion: "hc 0.1.18",
    needsHcAtLeast: [0, 1, 18],
    rootState: { kind: "absent" },
    scriptTreeViolations: [],
  };
}

interface Case {
  input: PreflightInput;
  expected: PfId | null;
}

const seg = fc.stringMatching(/^[a-z]{1,5}$/);
const tupleLess = (a: number[], b: number[]): boolean => {
  for (let k = 0; k < 3; k++) {
    if (a[k] !== b[k]) return (a[k] as number) < (b[k] as number);
  }
  return false;
};

const sessionCase: fc.Arbitrary<Case> = fc
  .oneof(
    fc.stringMatching(/^wsp(-[a-z0-9]{1,10})?$/),
    fc.constantFrom("default", "", "wsp-", "WSP-a", "wsp-A", "xwsp", "wsp_a"),
    fc.string({ maxLength: 12 }),
  )
  .map((session) => {
    const valid = session === "wsp" || /^wsp-[a-z0-9]{1,8}$/.test(session);
    return { input: { ...baseline(), session }, expected: valid ? null : "PF-SESSION" };
  });

const xdgCase: fc.Arbitrary<Case> = fc
  .tuple(
    fc.constantFrom(
      "/tmp/hcw",
      "/private/tmp/hcw",
      "/tmp/hcw-evil",
      "/tmp",
      "/var/tmp/hcw",
      "/hcw",
    ),
    fc.option(seg, { nil: undefined }),
    fc.boolean(),
  )
  .map(([prefix, tail, useState]) => {
    const real = tail === undefined ? prefix : `${prefix}/${tail}`;
    const valid = (prefix === "/tmp/hcw" || prefix === "/private/tmp/hcw") && tail !== undefined;
    const b = baseline();
    const input = useState ? { ...b, realStateHome: real } : { ...b, realConfigHome: real };
    return { input, expected: valid ? null : "PF-XDG" };
  });

const sockLenCase: fc.Arbitrary<Case> = fc.integer({ min: 21, max: 130 }).map((n) => {
  const prefix = "/private/tmp/hcw/q2/";
  const p = prefix + "y".repeat(n - prefix.length);
  return {
    input: { ...baseline(), socketPaths: [p] },
    expected: n <= 90 ? null : "PF-SOCKLEN",
  };
});

const defaultPathCase: fc.Arbitrary<Case> = fc
  .tuple(fc.constantFrom("", "/sock", "/a/b", "-x", "x"), fc.boolean())
  .map(([suffix, other]) => {
    const dir = "/home/u/.local/state/herdr-core/default";
    const p = other ? `/private/tmp/hcw/q2/s/${suffix.replace(/\W/g, "")}` : dir + suffix;
    const hit = !other && (suffix === "" || suffix.startsWith("/"));
    return {
      input: { ...baseline(), socketPaths: [p] },
      expected: hit ? "PF-DEFAULT-PATH" : null,
    };
  });

const homeCase: fc.Arbitrary<Case> = fc
  .oneof(fc.constant("/home/u"), fc.constant(undefined), fc.string({ maxLength: 10 }))
  .map((envHome) => ({
    input: { ...baseline(), envHome },
    expected: envHome === "/home/u" ? null : "PF-HOME",
  }));

const triple = fc.tuple(fc.nat(3), fc.nat(3), fc.integer({ min: 14, max: 21 }));
const versionCase: fc.Arbitrary<Case> = fc
  .oneof(
    triple.map((t) => ({ text: `hc ${t.join(".")}` as string | null, t })),
    fc.constantFrom("", "hc", "hc 1.2", "hc 1.2.x", "1.2.3", "hc v1.2.3").map((text) => ({
      text: text as string | null,
      t: null,
    })),
    fc.constant({ text: null as string | null, t: null }),
  )
  .map(({ text, t }) => ({
    input: { ...baseline(), hcVersion: text },
    expected: t !== null && !tupleLess(t, [0, 1, 18]) ? null : "PF-VERSION",
  }));

const rootCase: fc.Arbitrary<Case> = fc
  .oneof(
    fc.constant({ kind: "absent" as const }),
    fc.boolean().map((markerOk) => ({ kind: "stale" as const, markerOk })),
    fc.constant({ kind: "live" as const }),
    fc.constant({ kind: "foreign" as const }),
  )
  .map((rootState) => ({
    input: { ...baseline(), rootState },
    expected:
      rootState.kind === "absent" || (rootState.kind === "stale" && rootState.markerOk)
        ? null
        : "PF-ROOT",
  }));

const wrapperCase: fc.Arbitrary<Case> = fc
  .array(fc.string({ minLength: 1, maxLength: 8 }), { maxLength: 3 })
  .map((v) => ({
    input: { ...baseline(), scriptTreeViolations: v },
    expected: v.length > 0 ? "PF-WRAPPER" : null,
  }));

const oneChange = fc.oneof(
  sessionCase,
  xdgCase,
  sockLenCase,
  defaultPathCase,
  homeCase,
  versionCase,
  rootCase,
  wrapperCase,
);

describe("preflight property", () => {
  it("Feature: s-spikes, Property 2: Preflight accepts exactly the valid inputs", () => {
    expect(runPreflight(baseline(), deps).ok).toBe(true);
    pbt(
      fc.property(oneChange, ({ input, expected }) => {
        const r = runPreflight(input, deps);
        const got = r.failures.map((f) => f.id);
        expect(r.ok).toBe(expected === null);
        expect(got).toEqual(expected === null ? [] : [expected]);
      }),
    );
  });

  it("Feature: s-spikes, Property 3: Path containment is segment-wise", () => {
    const part = fc.oneof(seg, fc.constantFrom("..", ".", "", "", "root-x", "root", "a", "b"));
    const path = fc
      .tuple(fc.array(part, { maxLength: 6 }), fc.constantFrom("/", "//", "///"))
      .map(([parts, sep]) => `/${parts.join(sep)}`);
    const oracle = (root: string, p: string): boolean => {
      const r = posix.normalize(root).split("/").filter(Boolean);
      const c = posix.normalize(p).split("/").filter(Boolean);
      return c.length > r.length && r.every((s, k) => c[k] === s);
    };
    pbt(
      fc.property(path, path, (root, p) => {
        expect(isUnder(root, p)).toBe(oracle(root, p));
      }),
    );
    pbt(
      fc.property(path, fc.array(seg, { minLength: 1, maxLength: 3 }), (root, extra) => {
        const base = posix.normalize(root).replace(/\/+$/, "");
        expect(isUnder(root, `${base}/${extra.join("/")}`)).toBe(true);
        expect(isUnder(root, root)).toBe(false);
        if (base !== "") expect(isUnder(base, `${base}-x/${extra[0]}`)).toBe(false);
      }),
    );
  });

  it("Feature: s-spikes, Property 4: hc version comparison equals tuple order", () => {
    const big = fc.tuple(fc.nat(50), fc.nat(50), fc.nat(50));
    pbt(
      fc.property(fc.stringMatching(/^[a-z][a-z-]{0,5}$/), big, big, (name, a, b) => {
        expect(parseHcVersion(`${name} ${a.join(".")}`)).toEqual(a);
        expect(versionAtLeast(a, b)).toBe(!tupleLess(a, b));
      }),
    );
    const junk = fc
      .string({ maxLength: 20 })
      .filter((s) => !/^\s*[A-Za-z][\w.-]* \d{1,9}\.\d{1,9}\.\d{1,9}\s*$/.test(s));
    pbt(
      fc.property(junk, (text) => {
        expect(parseHcVersion(text)).toBeNull();
        const r = runPreflight({ ...baseline(), hcVersion: text }, deps);
        expect(r.failures.map((f) => f.id)).toContain("PF-VERSION");
      }),
    );
  });

  it("Feature: s-spikes, Property 5: Preflight output reveals no other environment value", () => {
    const names = fc.oneof(
      fc.stringMatching(/^[A-Z][A-Z0-9_]{0,10}$/),
      fc.constantFrom("HC_SESSION", "HC_SOCKET", "HC_SCOPE", "HERDR_X", "XDG_STATE_HOME", "HOME"),
    );
    pbt(
      fc.property(
        fc.array(names, { minLength: 1, maxLength: 8 }),
        fc.boolean(),
        fc.boolean(),
        (keys, withSocket, broken) => {
          const env: Record<string, string> = {};
          keys.forEach((k, n) => {
            env[k] = `SENTINEL-${n}-${"q".repeat(n + 3)}`;
          });
          const b = baseline();
          const i: PreflightInput = {
            ...b,
            env,
            hcSocketVar: withSocket ? "/private/tmp/hcw/q2/s/sock" : null,
            session: broken ? "default" : b.session,
            hcVersion: broken ? null : b.hcVersion,
          };
          const text = formatPreflight(runPreflight(i, deps), i);
          expect(text).not.toMatch(/SENTINEL-/);
          expect(text).toContain(`HC_SESSION=${i.session}`);
          expect(text).toContain(i.stateHome);
          expect(text).toContain(i.configHome);
          if (withSocket) expect(text).toContain("HC_SOCKET=/private/tmp/hcw/q2/s/sock");
        },
      ),
    );
  });
});
