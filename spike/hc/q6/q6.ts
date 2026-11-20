// spike-meta
// id: q6
// group: A
// cost: none
// run-by: loop
// agents:
// max-prompts: 0
// max-wall-seconds: 2700
// estimate-credits: none
// claude-prompts: 0
// human: HS-S5
// depends: q2
// shares: none
// allow-always: never
// assumption:
// end-spike-meta
import { execFile } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { pidIsOwn } from "../../lib/cleanup.ts";
import type { SpikeContext, SpikeOutcome } from "../../lib/outcome.ts";
import { pidAlive } from "../../lib/own-marker.ts";
import {
  NodeStub,
  type NodeStubDeps,
  POLL_MS,
  parseSlots,
  parseStatusPids,
  type SlotSpec,
  type StubEvent,
} from "./node-stub.ts";
import { withinLimit } from "./respawn.ts";

/*
 * Q6: does a node stub find and respawn a lost pane? Steps (a) to (d) follow R13.6 and R13.7.
 * The exact `hc` command forms below are an assumption (🧪): they are read from Q2's
 * `schema.json`, and this one table is the only place to change when the schema differs.
 * `hc --version` is recorded by the runner's preflight (index.json), not by this script.
 */

export const HC_FORMS = {
  start: ["server", "start"],
  stop: ["server", "stop"],
  restart: ["server", "restart"],
  status: ["server", "status"],
  ls: (node: string): string[] => ["ls", "--all", "--json", "--label", `wraith.node=${node}`],
  run: (s: SlotSpec): string[] => [
    "run",
    "--bg",
    ...Object.entries(s.labels).flatMap(([k, v]) => ["--label", `${k}=${v}`]),
    "--cwd",
    s.cwd,
    "--",
    ...s.argv,
  ],
  kill: (addr: string): string[] => ["kill", addr],
  rm: (addr: string): string[] => ["rm", addr],
  events: ["events"],
} as const;

export const NODE_LABEL = "q6node";
export const HS_S5_TEXT =
  "Optional: close a Wraith-labelled pane with the Herdr.app close button and report the reason " +
  "hc records (expected killed; exited 75 selects the branch 'document /exit').";

export interface Q6Deps {
  now(): number;
  sleep(ms: number): Promise<void>;
  pollMs: number;
  limitMs: number;
  /** Pid the stub wrote to its pid file, or null. */
  pidOf(token: string, scratch: string): Promise<number | null>;
  killPid(pid: number, signal: "SIGTERM" | "SIGKILL"): void;
  pidAlive(pid: number): boolean;
  cmdlineOf(pid: number): Promise<string>;
  nodePath: string;
  stubPath: string;
}

const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function defaultDeps(): Q6Deps {
  return {
    now: () => Number(process.hrtime.bigint() / 1_000_000n),
    sleep: realSleep,
    pollMs: POLL_MS,
    limitMs: 10_000,
    async pidOf(token, scratch) {
      for (let i = 0; i < 20; i++) {
        try {
          const n = Number(readFileSync(join(scratch, `${token}.pid`), "utf8").trim());
          if (Number.isInteger(n) && n > 1) return n;
        } catch {
          // The stub has not written it yet.
        }
        await realSleep(250);
      }
      return null;
    },
    killPid: (pid, signal) => process.kill(pid, signal),
    pidAlive,
    cmdlineOf: (pid) =>
      new Promise((resolve) => {
        execFile("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8" }, (_e, out) =>
          resolve(typeof out === "string" ? out : ""),
        );
      }),
    nodePath: process.execPath,
    stubPath: fileURLToPath(new URL("./stub-sprite.ts", import.meta.url)),
  };
}

function parseRunAddr(text: string): string | null {
  try {
    const j: unknown = JSON.parse(text);
    if (typeof j === "object" && j !== null) {
      const r = j as Record<string, unknown>;
      for (const k of ["address", "addr", "id"]) {
        const v = r[k];
        if (typeof v === "string" && v !== "") return v;
      }
    }
  } catch {
    // Not JSON: fall through to the text form.
  }
  return /\bt\d+\b/.exec(text)?.[0] ?? null;
}

function pendingOutcome(reason: string, notes: string[] = []): SpikeOutcome {
  return {
    result: "pending",
    reason,
    criteria: [],
    affects: [],
    openHumanSteps: [],
    promptsSent: 0,
    notes,
  };
}

export async function run(ctx: SpikeContext, over: Partial<Q6Deps> = {}): Promise<SpikeOutcome> {
  const hc = ctx.hc;
  if (hc === null) return pendingOutcome("Q6 needs hc and the context has none");
  const d: Q6Deps = { ...defaultDeps(), ...over };
  const t0 = d.now();
  const timeline: string[] = [];
  const log = (line: string): void => {
    timeline.push(`t+${d.now() - t0}ms ${line}`);
  };
  const rawLog = join(ctx.root, "q6-raw.log");
  const raw = (label: string, text: string): void => {
    appendFileSync(rawLog, `--- ${label}\n${text}\n`, { mode: 0o600 });
  };

  const specs = new Map<string, SlotSpec>();
  const mkSpec = (tag: string, extra: string[] = []): SlotSpec => {
    const token = `q6-${tag}`;
    const spec: SlotSpec = {
      token,
      labels: {
        "wraith.node": NODE_LABEL,
        "wraith.bot": `bot-${tag}`,
        "wraith.session": "main",
        "wraith.spawn": token,
      },
      argv: [
        d.nodePath,
        "--experimental-strip-types",
        d.stubPath,
        "--bot",
        `bot-${tag}`,
        "--session",
        "main",
        "--pid-file",
        join(ctx.scratch, `${token}.pid`),
        ...extra,
      ],
      cwd: ctx.scratch,
    };
    specs.set(token, spec);
    return spec;
  };

  let lsFailures = 0;
  const start = async (spec: SlotSpec): Promise<string | null> => {
    const r = await hc.run(HC_FORMS.run(spec));
    raw(`run ${spec.token} code=${r.code}`, r.stdout + r.stderr);
    return r.code === 0 ? parseRunAddr(r.stdout) : null;
  };
  const deps: NodeStubDeps = {
    async list() {
      const r = await hc.run(HC_FORMS.ls(NODE_LABEL));
      if (r.code !== 0) return null;
      raw("ls", r.stdout);
      const slots = parseSlots(r.stdout);
      if (slots === null) lsFailures++;
      return slots;
    },
    start,
    async remove(addr) {
      await hc.run(HC_FORMS.rm(addr)).catch(() => undefined);
    },
    now: d.now,
  };
  const stub = new NodeStub(deps);

  const status = async (): Promise<{ ok: boolean; core: number | null; all: number[] }> => {
    const r = await hc.run(HC_FORMS.status);
    raw(`status code=${r.code}`, r.stdout);
    const p = parseStatusPids(r.stdout);
    return { ok: r.code === 0, core: p.core, all: p.all };
  };

  const waitEvent = async (token: string): Promise<StubEvent | null> => {
    const from = stub.events.length;
    const begin = d.now();
    for (;;) {
      await stub.pollOnce();
      const ev = stub.events.slice(from).find((e) => e.token === token);
      if (ev !== undefined && (ev.decision === "none" || ev.respawnedMs !== null)) return ev;
      if (d.now() - begin > d.limitMs + 2 * d.pollMs) return null;
      await d.sleep(d.pollMs);
    }
  };
  const settle = async (token: string): Promise<boolean> => {
    // Two more polls with no respawn for a decision of "none".
    for (let i = 0; i < 2; i++) {
      await d.sleep(d.pollMs);
      await stub.pollOnce();
    }
    return (
      stub.eventsFor(token).every((e) => e.decision === "none") && stub.addressOf(token) === null
    );
  };

  const criteria: SpikeOutcome["criteria"] = [];
  const notes: string[] = [
    "hc --version is recorded by the runner's preflight in index.json.",
    "The events follower runs through spawnLong, whose output the wrapper does not capture; detection comes from the ls poll.",
  ];
  let follower: { stop(): Promise<void> } | null = null;
  const tracked: string[] = [];
  let corePidBefore: number | null = null;
  let corePidAfter: number | null = null;
  let stubPidKept: boolean | null = null;

  try {
    const started = await hc.run(HC_FORMS.start);
    if (started.code !== 0) return pendingOutcome("hc server start failed under the Test_Session");
    const st0 = await status();
    if (!st0.ok || st0.core === null) {
      return pendingOutcome("hc server status gave no readable pid (adjust parseStatusPids)");
    }
    corePidBefore = st0.core;
    try {
      follower = hc.spawnLong(HC_FORMS.events);
    } catch (e) {
      notes.push(`events follower not started: ${e instanceof Error ? e.message : "error"}`);
    }

    // Stub A: the long-lived pane used by steps a, b and c.
    const specA = mkSpec("a");
    const addrA = await start(specA);
    if (addrA === null) return pendingOutcome("hc run of the stub sprite failed (check HC_FORMS)");
    stub.track(specA, addrA);
    tracked.push(specA.token);
    const pidA = await d.pidOf(specA.token, ctx.scratch);
    if (pidA === null) return pendingOutcome("the stub sprite wrote no pid file");
    await stub.pollOnce();
    if (lsFailures > 0) return pendingOutcome("hc ls output was not readable (check HC_FORMS)");
    log(`stub a started addr=${addrA} pid=${pidA}`);

    // (a) server restart: the stub keeps its pid.
    await hc.run(HC_FORMS.restart);
    let back = await status();
    for (let i = 0; i < 20 && !back.ok; i++) {
      await d.sleep(500);
      back = await status();
    }
    corePidAfter = back.core;
    const pidAfter = await d.pidOf(specA.token, ctx.scratch);
    stubPidKept = d.pidAlive(pidA) && pidAfter === pidA;
    log(`restart core ${corePidBefore} -> ${corePidAfter ?? "none"} stub kept=${stubPidKept}`);
    criteria.push({
      id: "a-same-pid-keeps-running",
      ok: stubPidKept,
      observed: `stub pid ${pidA} alive after restart: ${d.pidAlive(pidA)}; core pid ${corePidBefore} -> ${corePidAfter ?? "none"}`,
    });

    // (b) kill the holder pid from server.status.
    const st1 = await status();
    const holders: number[] = [];
    for (const p of st1.all) {
      if (p === st1.core) continue;
      if (pidIsOwn(p, [], st1.all, await d.cmdlineOf(p), ctx.root)) holders.push(p);
    }
    if (holders.length === 0) {
      criteria.push({
        id: "b-holder-lost-respawn",
        ok: false,
        observed: "no holder pid in server status passed the own-pid check",
      });
    } else {
      const tb = d.now();
      for (const p of holders) {
        try {
          d.killPid(p, "SIGKILL");
        } catch {
          // Already gone.
        }
      }
      log(`holder killed pids=${holders.join(",")}`);
      const ev = await waitEvent(specA.token);
      const ok =
        ev !== null &&
        ev.reason === "holder_lost" &&
        ev.decision === "respawn" &&
        ev.newAddr !== null &&
        ev.respawnedMs !== null &&
        withinLimit(tb, ev.respawnedMs, d.limitMs);
      log(`b event ${ev === null ? "none" : `${ev.reason} respawned=${ev.respawnedMs !== null}`}`);
      criteria.push({
        id: "b-holder-lost-respawn",
        ok,
        observed:
          ev === null
            ? "no finished pane seen in time"
            : `reason ${ev.reason}, decision ${ev.decision}, respawn after ${ev.respawnedMs === null ? "none" : `${ev.respawnedMs - tb} ms`}`,
      });
    }

    // (c) server stop, then server start.
    await hc.run(HC_FORMS.stop);
    await d.sleep(1000);
    await hc.run(HC_FORMS.start);
    const tc = d.now();
    log("stop and start done");
    const evC = await waitEvent(specA.token);
    const okC =
      evC !== null &&
      evC.decision === "respawn" &&
      evC.respawnedMs !== null &&
      withinLimit(tc, evC.respawnedMs, d.limitMs);
    criteria.push({
      id: "c-stop-start-respawn",
      ok: okC,
      observed:
        evC === null
          ? "no finished pane seen after stop and start"
          : `reason ${evC.reason}, decision ${evC.decision}, respawn ${evC.respawnedMs === null ? "none" : `${evC.respawnedMs - tc} ms after start`}`,
    });

    // (d1) hc kill records killed, no respawn.
    const specB = mkSpec("b");
    const addrB = await start(specB);
    if (addrB === null) return pendingOutcome("hc run of stub b failed");
    stub.track(specB, addrB);
    tracked.push(specB.token);
    await d.pidOf(specB.token, ctx.scratch);
    await hc.run(HC_FORMS.kill(addrB));
    const evB = await waitEvent(specB.token);
    const quietB = evB !== null && (await settle(specB.token));
    criteria.push({
      id: "d-killed-no-respawn",
      ok: evB !== null && evB.reason === "killed" && evB.decision === "none" && quietB,
      observed:
        evB === null
          ? "no finished pane seen"
          : `reason ${evB.reason} code ${evB.code ?? "none"}, decision ${evB.decision}`,
    });

    // (d2) external SIGTERM records exited 75.
    const specC = mkSpec("c");
    const addrC = await start(specC);
    if (addrC === null) return pendingOutcome("hc run of stub c failed");
    stub.track(specC, addrC);
    tracked.push(specC.token);
    const pidC = await d.pidOf(specC.token, ctx.scratch);
    if (pidC === null) return pendingOutcome("stub c wrote no pid file");
    const tt = d.now();
    d.killPid(pidC, "SIGTERM");
    const evC2 = await waitEvent(specC.token);
    criteria.push({
      id: "d-term-exited-75-respawn",
      ok:
        evC2 !== null &&
        evC2.reason === "exited" &&
        evC2.code === 75 &&
        evC2.decision === "respawn" &&
        evC2.respawnedMs !== null &&
        withinLimit(tt, evC2.respawnedMs, d.limitMs),
      observed:
        evC2 === null
          ? "no finished pane seen"
          : `reason ${evC2.reason} code ${evC2.code ?? "none"}, decision ${evC2.decision}, respawn ${evC2.respawnedMs === null ? "none" : `${evC2.respawnedMs - tt} ms after the signal`}`,
    });

    // (d3) a clean exit 0 is never respawned.
    const specD = mkSpec("d", ["--exit-after-ms", "500", "--exit-code", "0"]);
    const addrD = await start(specD);
    if (addrD === null) return pendingOutcome("hc run of stub d failed");
    stub.track(specD, addrD);
    tracked.push(specD.token);
    const evD = await waitEvent(specD.token);
    const quietD = evD !== null && (await settle(specD.token));
    criteria.push({
      id: "d-exit0-no-respawn",
      ok:
        evD !== null &&
        evD.reason === "exited" &&
        evD.code === 0 &&
        evD.decision === "none" &&
        quietD,
      observed:
        evD === null
          ? "no finished pane seen"
          : `reason ${evD.reason} code ${evD.code ?? "none"}, decision ${evD.decision}`,
    });
  } finally {
    if (follower !== null) await follower.stop().catch(() => undefined);
    for (const t of tracked) {
      const addr = stub.addressOf(t);
      if (addr === null) continue;
      await hc.run(HC_FORMS.kill(addr)).catch(() => undefined);
      await hc.run(HC_FORMS.rm(addr)).catch(() => undefined);
    }
  }

  ctx.humanStep("HS-S5", HS_S5_TEXT);
  notes.push("Herdr.app close-button reason: unobserved (HS-S5).");

  await ctx.evidence.addText("timeline.txt", `${timeline.join("\n")}\n`);
  await ctx.evidence.addText(
    "summary.json",
    `${JSON.stringify(
      {
        corePidBefore,
        corePidAfter,
        stubPidKept,
        pollMs: d.pollMs,
        limitMs: d.limitMs,
        events: stub.events.map((e) => ({
          token: e.token,
          reason: e.reason,
          code: e.code,
          decision: e.decision,
          respawnedAfterDetectMs: e.respawnedMs === null ? null : e.respawnedMs - e.detectedMs,
        })),
      },
      null,
      2,
    )}\n`,
  );

  const pass = criteria.length === 6 && criteria.every((c) => c.ok);
  const outcome: SpikeOutcome = {
    result: pass ? "PASS" : "FAIL",
    criteria,
    affects: ["S-node-core", "S-sprite-acp", "S-crypt"],
    openHumanSteps: ["HS-S5"],
    promptsSent: 0,
    notes,
    branch: pass
      ? "node polls `terminal.list` every 5 s; document `/exit` if the Herdr.app close records exited 75"
      : "re-check the §7.6 respawn rule against the observed reasons before S-node-core",
  };
  return outcome;
}
