import * as fc from "fast-check";
import { describe, it } from "vitest";
import { decideHc } from "../lib/hc.ts";
import { pbt } from "./config.ts";

const VERBS = [
  "server",
  "status",
  "stop",
  "start",
  "restart",
  "ls",
  "terminal.list",
  "terminal.run",
  "terminal.send",
  "terminal.create",
  "machine",
  "exec",
  "file",
  "update",
  "config",
  "--version",
  "--json",
  "--all",
];
const REFUSED_FIRST = ["machine", "exec", "file", "update"];
const SESSIONS = [
  undefined,
  "default",
  "",
  "wsp",
  "wsp-q6",
  "wsp-abcd1234",
  "wsp-TOOLONGNAME",
  "wsp-a b",
  "other",
];

const caseVariant = (s: string): fc.Arbitrary<string> =>
  fc
    .array(fc.boolean(), { minLength: s.length, maxLength: s.length })
    .map((flags) => [...s].map((c, i) => (flags[i] ? c.toUpperCase() : c)).join(""));
const word: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom(...VERBS),
  fc.constantFrom(...VERBS).chain(caseVariant),
  fc.constantFrom(...VERBS).map((v) => ` ${v} `),
  fc.constantFrom(";", "&&", "|", "$(id)", "`id`", ">x", "\n", "a b", "server stop", "ls --all"),
  fc.string({ maxLength: 12 }),
);
const argsArb: fc.Arbitrary<string[]> = fc.array(word, { maxLength: 5 });
const sessionArb: fc.Arbitrary<string | undefined> = fc.oneof(
  fc.constantFrom(...SESSIONS),
  fc.string({ maxLength: 12 }),
);
const badSession: fc.Arbitrary<string | undefined> = sessionArb.filter(
  (s) => s === undefined || s === "default" || !/^wsp(-[a-z0-9]{1,8})?$/.test(s),
);
const goodSession: fc.Arbitrary<string> = fc.constantFrom("wsp", "wsp-q6", "wsp-ab12cd34");

describe("Property 7: The hc decision never allows what the mode forbids", () => {
  // Feature: s-spikes, Property 7: The hc decision never allows what the mode forbids
  // **Validates: Requirements 1.4, 1.5, 1.8, 1.10, 2.16**
  it("(a) normal mode with a bad or unset session refuses every command", () => {
    pbt(
      fc.property(argsArb, badSession, (args, session) => {
        return !decideHc(args, { mode: "normal", session }).allow;
      }),
    );
  });

  it("(b) observe mode allows exactly server status", () => {
    pbt(
      fc.property(argsArb, sessionArb, (args, session) => {
        const d = decideHc(args, { mode: "observe", session });
        const exact = args.length === 2 && args[0] === "server" && args[1] === "status";
        return d.allow === exact;
      }),
    );
    pbt(
      fc.property(
        fc.constantFrom(["ls"], ["ls", "--all"], ["terminal.list"]),
        sessionArb,
        (a, s) => {
          return !decideHc(a, { mode: "observe", session: s }).allow;
        },
      ),
      { numRuns: 500 },
    );
  });

  it("(c) the first word machine, exec, file or update is refused in every mode", () => {
    pbt(
      fc.property(
        fc.constantFrom(...REFUSED_FIRST),
        fc.array(fc.constantFrom("--json", "-v"), { maxLength: 2 }),
        argsArb,
        goodSession,
        fc.constantFrom<"normal" | "observe">("normal", "observe"),
        (verb, flags, rest, session, mode) => {
          return !decideHc([...flags, verb, ...rest], { mode, session }).allow;
        },
      ),
    );
  });

  it("(d) server stop, restart and start are refused in observe mode", () => {
    pbt(
      fc.property(
        fc.constantFrom("stop", "restart", "start"),
        fc.array(word, { maxLength: 2 }),
        sessionArb,
        (sub, rest, session) => {
          return !decideHc(["server", sub, ...rest], { mode: "observe", session }).allow;
        },
      ),
    );
  });

  it("(f) remote targets (--on, --on=x, machine addresses) are refused in every mode and position", () => {
    const remote: fc.Arbitrary<string> = fc.oneof(
      fc.constant("--on"),
      fc.string({ maxLength: 8 }).map((x) => `--on=${x}`),
      fc
        .tuple(fc.stringMatching(/^[A-Za-z0-9._-]{1,8}$/), fc.integer({ min: 0, max: 99999 }))
        .map(([n, d]) => `${n}/t${d}`),
      fc
        .tuple(
          fc.stringMatching(/^--[a-z]{1,6}$/),
          fc.stringMatching(/^[A-Za-z0-9._-]{1,8}$/),
          fc.integer({ min: 0, max: 99999 }),
        )
        .map(([f, n, d]) => `${f}=${n}/t${d}`),
    );
    pbt(
      fc.property(
        argsArb,
        remote,
        fc.nat(),
        goodSession,
        fc.constantFrom<"normal" | "observe">("normal", "observe"),
        (args, r, pos, session, mode) => {
          const at = pos % (args.length + 1);
          const argv = [...args.slice(0, at), r, ...args.slice(at)];
          const d = decideHc(argv, { mode, session });
          return !d.allow && !d.reason.includes(r);
        },
      ),
    );
    // The allowed shapes still pass.
    const ok = decideHc(["server", "status"], { mode: "observe", session: undefined });
    const okNormal = decideHc(["terminal.list"], { mode: "normal", session: "wsp-q6" });
    if (!ok.allow || !okNormal.allow) throw new Error("allowed shape refused");
  });

  it("(e) the decision never throws, whatever the input", () => {
    pbt(
      fc.property(
        fc.array(fc.oneof(word, fc.anything() as fc.Arbitrary<string>), { maxLength: 6 }),
        fc.oneof(sessionArb, fc.anything() as fc.Arbitrary<string | undefined>),
        fc.oneof(
          fc.constantFrom<"normal" | "observe">("normal", "observe"),
          fc.anything() as fc.Arbitrary<"normal">,
        ),
        (args, session, mode) => {
          const d = decideHc(args, { mode, session });
          return typeof d.allow === "boolean";
        },
      ),
    );
  });
});
