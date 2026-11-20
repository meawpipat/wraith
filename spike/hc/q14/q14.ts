// spike-meta
// id: q14
// group: A
// cost: none
// run-by: owner
// agents:
// max-prompts: 0
// max-wall-seconds: 1800
// estimate-credits: none
// claude-prompts: 0
// human: HS-S4
// depends:
// shares: none
// allow-always: never
// assumption:
// end-spike-meta

import { dirname } from "node:path";
import type { CriterionRecord, SpikeContext, SpikeOutcome } from "../../lib/outcome.ts";

/** Q14 (Observe_Mode only): does the owner's own core come back after a logout and login? */
export const POLL_LIMIT_SECONDS = 60;
/** Pass line for the time to the first successful `server status`. */
export const PASS_SECONDS = 10;
export const STATUS_ARGS: readonly string[] = ["server", "status"];

/** What the observer cannot see; the owner records these (HS-S4). */
export const OPEN_ITEMS: readonly string[] = [
  "Linux unit: the service unit starts the core after login",
  "reboot: the core is back after a reboot",
  "reboot with nobody logged in: the core state before any login",
  "recorded pane reason is not `killed` after the core went away",
];

export const INSTRUCTIONS =
  "Q14 observer. 1) Log out of your session. 2) Log in again. 3) Run this script at once. " +
  "It only polls `hc server status` once per second for up to 60 s. It starts nothing and lists nothing.";

export interface Q14Deps {
  /** Milliseconds, monotonic. */
  nowMs?: () => number;
  sleep?: (ms: number) => Promise<void>;
  print?: (line: string) => void;
}

export interface PollOutcome {
  /** One `t+<seconds> ok|fail` line per poll. */
  lines: string[];
  /** Seconds of the first success, or null when none within the limit. */
  firstOkSeconds: number | null;
  /** Raw stdout of the first success; never written out as is. */
  okStdout: string;
}

/** A directory-like absolute path in the status text, reduced to one folder; never a file or project path. */
export function stateDirFrom(stdout: string): string | null {
  const m = /(\/[^\s"',:;]*(?:herdr|hc)[^\s"',:;]*)/i.exec(stdout);
  if (m?.[1] === undefined) return null;
  const p = m[1];
  return /\.(sock|json|log|pid)$/i.test(p) ? dirname(p) : p;
}

/** Evidence text: poll lines, the measured time and the state folder. Nothing else. */
export function buildObserveText(p: PollOutcome, home: string): string {
  const measured = p.firstOkSeconds === null ? "none" : `${p.firstOkSeconds} s`;
  let dir = stateDirFrom(p.okStdout) ?? "unknown";
  if (home.length > 1 && dir.startsWith(home)) dir = `~${dir.slice(home.length)}`;
  return `${[...p.lines, `measured: ${measured}`, `state-dir: ${dir}`].join("\n")}\n`;
}

export async function pollStatus(
  ctx: SpikeContext,
  deps: Required<Pick<Q14Deps, "nowMs" | "sleep">>,
): Promise<PollOutcome> {
  if (ctx.hc === null) throw new Error("q14 needs an hc handle");
  const start = deps.nowMs();
  const lines: string[] = [];
  for (;;) {
    const t = Math.floor((deps.nowMs() - start) / 1000);
    if (t > POLL_LIMIT_SECONDS) return { lines, firstOkSeconds: null, okStdout: "" };
    let ok = false;
    let stdout = "";
    try {
      const r = await ctx.hc.run(STATUS_ARGS, { timeoutMs: 5000 });
      ok = r.code === 0;
      stdout = r.stdout;
    } catch {
      ok = false;
    }
    lines.push(`t+${t} ${ok ? "ok" : "fail"}`);
    if (ok) return { lines, firstOkSeconds: t, okStdout: stdout };
    await deps.sleep(1000);
  }
}

export async function run(ctx: SpikeContext, deps: Q14Deps = {}): Promise<SpikeOutcome> {
  const print = deps.print ?? ((l: string) => console.log(l));
  if (!ctx.interactive) {
    return {
      result: "pending",
      reason: "needs interactive terminal",
      criteria: [],
      affects: [],
      openHumanSteps: ["HS-S4"],
      promptsSent: 0,
      notes: ["q14 refused: not an interactive terminal; nothing was polled"],
    };
  }
  ctx.humanStep("HS-S4", INSTRUCTIONS);
  print(`q14 start ${ctx.now().toISOString()}`);

  const polled = await pollStatus(ctx, {
    nowMs: deps.nowMs ?? (() => performance.now()),
    sleep: deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
  });
  await ctx.evidence.addText("observe.txt", buildObserveText(polled, process.env.HOME ?? ""));

  const within = polled.firstOkSeconds !== null && polled.firstOkSeconds <= PASS_SECONDS;
  const criteria: CriterionRecord[] = [
    {
      id: "q14-status-within-10s",
      ok: within,
      observed:
        polled.firstOkSeconds === null
          ? `no success within ${POLL_LIMIT_SECONDS} s`
          : `first success at ${polled.firstOkSeconds} s`,
    },
  ];
  return {
    result: "PARTIAL",
    reason: `observer covers one login only; open: ${OPEN_ITEMS.join("; ")}`,
    criteria,
    affects: ["S-node-core"],
    openHumanSteps: ["HS-S4"],
    promptsSent: 0,
    notes: [...OPEN_ITEMS.map((i) => `open (HS-S4): ${i}`)],
  };
}
