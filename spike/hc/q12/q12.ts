// spike-meta
// id: q12
// group: A
// cost: none
// run-by: loop
// agents:
// max-prompts: 0
// max-wall-seconds: 600
// estimate-credits: none
// claude-prompts: 0
// human:
// depends: q2
// shares: none
// allow-always: never
// assumption:
// end-spike-meta

import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Hc } from "../../lib/hc.ts";
import type { CriterionRecord, SpikeContext, SpikeOutcome } from "../../lib/outcome.ts";
import { findSenderField, keyPaths, type Q12Observation, q12Verdict } from "./sender.ts";

export interface Q12Options {
  /** How long the events follower runs before the runner stops it. */
  windowMs: number;
  /** Pause after the follower starts, before the send. */
  startupMs: number;
  sleep: (ms: number) => Promise<void>;
}

const DEFAULTS: Q12Options = {
  windowMs: 8000,
  startupMs: 1000,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

/** The marker text typed into the test pane by `hc send`. Harmless, no secret shape. */
const MARKER = "wraith-q12-marker";
/** hc form that starts a background pane. Q2 records the real form; adjust here if it differs. */
const PANE_ARGV = ["run", "--bg", "--label", "wraith.spike=q12", "--", "cat"] as const;
const PANE_ID_IN_TEXT = /\bt\d+\b/;
const MAX_SHAPES = 200;

async function startPane(hc: Hc): Promise<string | null> {
  try {
    const r = await hc.run([...PANE_ARGV]);
    if (r.code !== 0) return null;
    return PANE_ID_IN_TEXT.exec(r.stdout)?.[0] ?? null;
  } catch {
    return null;
  }
}

function parseEvents(raw: string): { events: unknown[]; unparsed: number } {
  const events: unknown[] = [];
  let unparsed = 0;
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      unparsed++;
    }
  }
  return { events, unparsed };
}

export async function runWith(ctx: SpikeContext, opts: Q12Options): Promise<SpikeOutcome> {
  const hc = ctx.hc;
  if (hc === null) throw new Error("q12 needs the hc wrapper");

  const pane = await startPane(hc);
  let followerStarted = false;
  let sendOk = false;
  let raw = "";
  if (pane !== null) {
    try {
      // The follower is a bounded `hc events` run: the wrapper stops it when the window ends.
      const follower = hc.run(["events"], { timeoutMs: opts.windowMs });
      await opts.sleep(opts.startupMs);
      try {
        const sent = await hc.run(["send", pane, MARKER]);
        sendOk = sent.code === 0;
      } catch {
        sendOk = false;
      }
      const f = await follower;
      raw = f.stdout;
      followerStarted = f.code === null || f.stdout.length > 0;
    } catch {
      followerStarted = false;
    } finally {
      try {
        await hc.run(["kill", pane]);
      } catch {
        // Cleanup of the root removes whatever is left.
      }
    }
  }

  // Raw log stays under the Spike_Root; evidence gets structure only.
  mkdirSync(ctx.root, { recursive: true });
  const rawPath = join(ctx.root, "q12-events.raw.log");
  writeFileSync(rawPath, raw, { mode: 0o600 });
  chmodSync(rawPath, 0o600);

  const { events, unparsed } = parseEvents(raw);
  const finding = findSenderField(events);
  const namesPane =
    pane !== null && events.some((e) => JSON.stringify(e)?.includes(`"${pane}"`) === true);
  const obs: Q12Observation = {
    paneCreated: pane !== null,
    followerStarted,
    sendOk,
    eventCount: events.length,
    finding,
  };
  const verdict = q12Verdict(obs);

  const shapes = events.slice(0, MAX_SHAPES).map((e) => [...new Set(keyPaths(e))].sort());
  await ctx.evidence.addText("events-shape.json", `${JSON.stringify(shapes, null, 2)}\n`);
  await ctx.evidence.addText(
    "summary.json",
    `${JSON.stringify(
      {
        paneCreated: obs.paneCreated,
        followerStarted,
        sendOk,
        eventCount: events.length,
        unparsedLines: unparsed,
        windowMs: opts.windowMs,
        namesPane,
        senderField: finding,
      },
      null,
      2,
    )}\n`,
  );

  const criteria: CriterionRecord[] = [
    {
      id: "events-seen",
      ok: events.length > 0,
      observed: `${events.length} events in a ${opts.windowMs} ms window`,
    },
    { id: "event-names-pane", ok: namesPane, observed: namesPane ? "yes" : "no" },
    {
      id: "event-names-sender",
      ok: finding !== null,
      observed: finding ? `key ${finding.key} next to ${finding.paneKey}` : "no sender-like key",
    },
  ];
  const outcome: SpikeOutcome = {
    result: verdict.result,
    criteria,
    affects: ["S-node-core"],
    openHumanSteps: [],
    promptsSent: 0,
    notes: [
      "hc --version is recorded by the runner in the evidence index",
      "the follower is a bounded `hc events` run because the wrapper's long child keeps no output",
    ],
  };
  if (verdict.reason !== undefined) outcome.reason = verdict.reason;
  if (verdict.branch !== undefined) outcome.branch = verdict.branch;
  return outcome;
}

export function run(ctx: SpikeContext): Promise<SpikeOutcome> {
  return runWith(ctx, DEFAULTS);
}
