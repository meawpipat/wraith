import * as fc from "fast-check";
import { describe, it } from "vitest";
import { pidIsOwn, planDeletion } from "../lib/cleanup.ts";
import type { OwnMarker } from "../lib/own-marker.ts";
import { pbt } from "./config.ts";

const PREFIX = "/tmp/fake-hcw";
const ROOT = `${PREFIX}/run1`;

function marker(over: Partial<OwnMarker> = {}): OwnMarker {
  return {
    v: 1,
    session: "wsp-q6",
    qs: ["q6"],
    root: ROOT,
    runnerPid: 1,
    startedAt: "2026-11-19T09:30:00.000Z",
    nonce: "0".repeat(32),
    pids: [],
    agentFiles: [],
    ...over,
  };
}

const segment = fc.constantFrom("a", "b", "c.txt", "link-like", "..", ".", "", "x y");
const tail = fc.array(segment, { maxLength: 4 }).map((s) => s.join("/"));
const candidate = fc.oneof(
  tail.map((t) => `${ROOT}/${t}`),
  tail.map((t) => `${PREFIX}/${t}`),
  tail.map((t) => `${ROOT}-sibling/${t}`),
  tail.map((t) => `/tmp/fake-hcw-other/${t}`),
  tail.map((t) => `/home/u/.config/herdr-core/${t}`),
  tail.map((t) => `/home/u/.local/state/herdr-core/${t}`),
  tail,
  fc.constantFrom("", "/", "~/.config/herdr-core", PREFIX, ROOT, `${ROOT}/..`),
);

function isUnderRoot(p: string): boolean {
  if (!p.startsWith("/") || p.split("/").includes("..")) return false;
  const parts = p.split("/").filter((s) => s !== "" && s !== ".");
  const r = ROOT.split("/").filter((s) => s !== "");
  return parts.length > r.length && r.every((s, k) => parts[k] === s);
}

describe("Feature: s-spikes, Property 8: Deletion plans stay inside the marked root", () => {
  it("deletes only paths strictly under the marker's root and refuses the rest", () => {
    pbt(
      fc.property(fc.array(candidate, { maxLength: 12 }), (cands) => {
        const plan = planDeletion(ROOT, marker(), cands, [PREFIX]);
        const expected = cands.filter(isUnderRoot);
        const refused = cands.filter((c) => !isUnderRoot(c));
        return (
          JSON.stringify(plan.delete) === JSON.stringify(expected) &&
          JSON.stringify(plan.refuse.map((r) => r.path)) === JSON.stringify(refused)
        );
      }),
    );
  });

  it("deletes nothing with no marker, a mismatched marker, or a root outside the prefix", () => {
    const bad = fc.constantFrom<"none" | "root" | "session" | "prefix">(
      "none",
      "root",
      "session",
      "prefix",
    );
    pbt(
      fc.property(bad, fc.array(candidate, { maxLength: 12 }), (kind, cands) => {
        const m =
          kind === "none"
            ? null
            : kind === "root"
              ? marker({ root: `${PREFIX}/other` })
              : kind === "session"
                ? marker({ session: "default" })
                : marker();
        const prefixes = kind === "prefix" ? ["/tmp/not-the-prefix"] : [PREFIX];
        const plan = planDeletion(ROOT, m, cands, prefixes);
        return plan.delete.length === 0 && plan.refuse.length === cands.length;
      }),
    );
  });
});

describe("Feature: s-spikes, Property 9: Only own pids are killed", () => {
  it("pidIsOwn is true iff the pid is own, or in the status list with the root in its command line", () => {
    const pid = fc.integer({ min: 1, max: 40 });
    const root = fc.constantFrom("/tmp/hcw/run1", "/tmp/hcw/run2", "/private/tmp/hcw/x");
    const cmd = fc.oneof(
      fc.string({ maxLength: 20 }),
      fc
        .tuple(fc.string({ maxLength: 6 }), root, fc.string({ maxLength: 6 }))
        .map((t) => t.join("")),
    );
    pbt(
      fc.property(
        pid,
        fc.array(pid, { maxLength: 8 }),
        fc.array(pid, { maxLength: 8 }),
        cmd,
        root,
        (p, own, status, cmdline, r) => {
          const expected = own.includes(p) || (status.includes(p) && cmdline.includes(r));
          return pidIsOwn(p, own, status, cmdline, r) === expected;
        },
      ),
    );
  });
});
