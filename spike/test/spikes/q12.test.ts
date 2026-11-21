import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";
import { runWith } from "../../hc/q12/q12.ts";
import {
  findSenderField,
  Q12_FAIL_BRANCH,
  Q12_PASS_BRANCH,
  q12Verdict,
} from "../../hc/q12/sender.ts";
import { createEvidenceWriter } from "../../lib/evidence.ts";
import type { Hc } from "../../lib/hc.ts";
import { readSpikeMeta } from "../../lib/meta.ts";
import type { SpikeContext } from "../../lib/outcome.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "q12-"));
  dirs.push(d);
  return d;
}

interface FakeScript {
  paneStdout?: string;
  paneCode?: number;
  events?: string;
  sendCode?: number;
}

function fakeHc(script: FakeScript, calls: string[][]): Hc {
  return {
    session: "wsp",
    mode: "normal",
    spawnLong: () => {
      throw new Error("not used");
    },
    async run(args) {
      calls.push([...args]);
      const out = (stdout: string, code: number | null = 0) => ({
        code,
        stdout,
        stderr: "",
        ms: 1,
      });
      switch (args[0]) {
        case "run":
          return out(script.paneStdout ?? "t1\n", script.paneCode ?? 0);
        case "events":
          return out(script.events ?? "", null);
        case "send":
          return out("", script.sendCode ?? 0);
        default:
          return out("");
      }
    },
  };
}

function makeCtx(hc: Hc): { ctx: SpikeContext; root: string } {
  const root = tmp();
  const meta = readSpikeMeta("q12");
  if (!meta.ok) throw new Error(meta.reason);
  const evidence = createEvidenceWriter({ evidenceRoot: join(tmp(), "evidence"), q: "q12" });
  const ctx: SpikeContext = {
    q: "q12",
    meta: meta.meta,
    root,
    session: "wsp",
    scratch: join(root, "scratch"),
    hc,
    env: () => ({}),
    evidence,
    approval: async () => {
      throw new Error("no approvals in q12");
    },
    shared: null,
    humanStep: () => {},
    now: () => new Date(),
    interactive: false,
    allowHomeProfile: false,
  };
  return { ctx, root };
}

const FAST = { windowMs: 5, startupMs: 0, sleep: async () => {} };

describe("findSenderField", () => {
  it("finds a sender-like key next to a pane id", () => {
    const f = findSenderField([
      { type: "heartbeat" },
      { type: "input", terminal_id: "t3", client: "cli-7" },
    ]);
    expect(f).toMatchObject({ eventIndex: 1, key: "client", paneKey: "terminal_id", path: "$" });
  });

  it("finds a nested object that holds both", () => {
    const f = findSenderField([{ params: { pane: "t2", origin: { id: 9 } } }]);
    expect(f?.path).toBe("$.params");
    expect(f?.key).toBe("origin");
  });

  it("ignores events without a pane id or without a filled sender value", () => {
    expect(findSenderField([{ source: "core" }, { pane: "t1", sender: "" }, { pane: "t1" }])).toBe(
      null,
    );
    expect(findSenderField([])).toBeNull();
  });

  it("finds exactly the generated sender key, and none without it", () => {
    const senderKey = fc.constantFrom("client", "clientId", "event_source", "Sender", "origin");
    const plainKey = fc.constantFrom("type", "status", "label", "seq", "ts", "text");
    fc.assert(
      fc.property(
        senderKey,
        fc.integer({ min: 1, max: 99 }),
        fc.array(plainKey, { maxLength: 4 }),
        (k, n, others) => {
          const base: Record<string, unknown> = { pane: `t${n}` };
          for (const o of others) base[o] = 1;
          expect(findSenderField([base])).toBeNull();
          const withSender = { ...base, [k]: "x" };
          expect(findSenderField([withSender])?.key).toBe(k);
        },
      ),
    );
  });
});

describe("q12Verdict", () => {
  const base = {
    paneCreated: true,
    followerStarted: true,
    sendOk: true,
    eventCount: 4,
    finding: null,
  };

  it("is FAIL with the expected branch when no event names the sender", () => {
    expect(q12Verdict(base)).toEqual({ result: "FAIL", branch: Q12_FAIL_BRANCH });
    expect(Q12_FAIL_BRANCH).toBe("drop `herdr-guard`, keep the limitation in §12");
  });

  it("is PASS when a sender field exists", () => {
    const finding = { eventIndex: 0, path: "$", key: "client", paneKey: "pane" };
    expect(q12Verdict({ ...base, finding })).toEqual({ result: "PASS", branch: Q12_PASS_BRANCH });
  });

  it("is PARTIAL with a reason when no events arrived", () => {
    const v = q12Verdict({ ...base, eventCount: 0 });
    expect(v.result).toBe("PARTIAL");
    expect(v.reason).toBeTruthy();
  });

  it("stays pending, never FAIL, when the spike could not run", () => {
    for (const patch of [{ paneCreated: false }, { followerStarted: false }, { sendOk: false }]) {
      const v = q12Verdict({ ...base, ...patch });
      expect(v.result).toBe("pending");
      expect(v.reason).toBeTruthy();
    }
  });
});

describe("q12 run with a scripted hc", () => {
  const events = `${[
    JSON.stringify({ type: "heartbeat" }),
    JSON.stringify({ type: "output", terminal: "t1", seq: 1 }),
  ].join("\n")}\n`;

  it("records FAIL, keeps the raw log under the root and writes shape-only evidence", async () => {
    const calls: string[][] = [];
    const { ctx, root } = makeCtx(fakeHc({ events }, calls));
    const out = await runWith(ctx, FAST);
    expect(out.result).toBe("FAIL");
    expect(out.branch).toBe(Q12_FAIL_BRANCH);
    expect(out.promptsSent).toBe(0);
    expect(calls.map((c) => c[0])).toEqual(["run", "events", "send", "kill"]);
    expect(calls.find((c) => c[0] === "send")).toEqual(["send", "t1", "wraith-q12-marker"]);
    const rawPath = join(root, "q12-events.raw.log");
    expect(statSync(rawPath).mode & 0o777).toBe(0o600);
    expect(readFileSync(rawPath, "utf8")).toBe(events);
    const idx = await ctx.evidence.finish(out, { id: "q12", runBy: "loop" }, { node: "x" });
    expect(idx.files.map((f) => f.path).sort()).toEqual(["events-shape.json", "summary.json"]);
    expect(readFileSync(join(ctx.evidence.dir, "events-shape.json"), "utf8")).not.toContain(
      "heartbeat",
    );
  });

  it("records PASS when an event carries a client next to the pane", async () => {
    const withClient = `${JSON.stringify({ type: "input", terminal: "t1", client: "c2" })}\n`;
    const { ctx } = makeCtx(fakeHc({ events: withClient }, []));
    const out = await runWith(ctx, FAST);
    expect(out.result).toBe("PASS");
    expect(out.criteria.find((c) => c.id === "event-names-sender")?.ok).toBe(true);
  });

  it("stays pending when no pane can be created, and runs no follower", async () => {
    const calls: string[][] = [];
    const { ctx } = makeCtx(fakeHc({ paneCode: 1 }, calls));
    const out = await runWith(ctx, FAST);
    expect(out.result).toBe("pending");
    expect(out.reason).toBeTruthy();
    expect(calls.map((c) => c[0])).toEqual(["run"]);
  });

  it("stays pending when hc send fails", async () => {
    const { ctx } = makeCtx(fakeHc({ events, sendCode: 1 }, []));
    expect((await runWith(ctx, FAST)).result).toBe("pending");
  });

  it("carries a valid metadata block", () => {
    const meta = readSpikeMeta("q12");
    expect(meta.ok && meta.meta).toMatchObject({
      id: "q12",
      group: "A",
      cost: "none",
      runBy: "loop",
      maxPrompts: 0,
      maxWallSeconds: 600,
      depends: ["q2"],
    });
  });
});
