// spike-meta
// id: q3b
// group: B
// cost: low
// run-by: owner
// agents: kiro
// max-prompts: 4
// max-wall-seconds: 1800
// estimate-credits: 2-6
// claude-prompts: 0
// human: HS-S2, HS-S3
// depends: q43, q3
// shares: none
// allow-always: never
// assumption: A1 Estimate
// end-spike-meta
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startRawAcp, type TimerHandle } from "../../lib/acp-echo.ts";
import {
  assertSafeProfile,
  buildKiroProfile,
  profilePlacement,
  writeProfileFile,
} from "../../lib/agent-profile.ts";
import type { PermissionAnswer, PermissionRequest } from "../../lib/approval.ts";
import {
  type HookAnswer,
  newHookToken,
  startHookReceiver,
  writeHookToken,
} from "../../lib/hook-receiver.ts";
import {
  asyncFileLines,
  DEFAULT_REPO_ROOT,
  errorMessage,
  kiroAcpArgv,
  type Q43Placement,
  readQ43Placement,
  recordInMarker,
} from "../../lib/kiro-spike.ts";
import type {
  CriterionRecord,
  ResultValue,
  SpikeContext,
  SpikeOutcome,
} from "../../lib/outcome.ts";

/**
 * Q3b asks whether a Kiro `preToolUse` hook fires before the tool, whether exit code 2 blocks the
 * tool, and how long Kiro waits for a hook that does not answer. The receiver blocks by default.
 * An allow exists only as an owner tap for one request. The script has no other path to an allow.
 */
export const AGENT_NAME = "wraith-spike-q3b";
export const PROFILE_PROMPT = "You are a throwaway Wraith spike agent. Do only what the user asks.";
export const PROBE_PROMPT = "Run `echo hi` with your shell tool and tell me the output.";
export const HOLD_PROMPT = "Run `echo hi` once more with your shell tool and tell me the output.";
export const HOOK_MATCHER = "*";
export const HOLD_CAP_MS = 130_000;
export const TIMEOUT_BOUND_NOTE =
  "The receiver cannot see the hook connection close. timeoutUpperBoundMs is the time until the agent's next tool update (agent-resumed), the end of the prompt (prompt-ended) or the cap (cap), whichever came first: an upper bound of how long the agent waited, not the hook timeout itself.";
export const HOME_PENDING_REASON = "Q43 placed the profile in ~/.kiro/agents/; HS-S6 open";
export const HOME_PENDING_NOTE =
  "Nothing was written to ~/.kiro/agents/. To allow one new file there (HS-S6), re-run: pnpm spike q3b --allow-home-profile";
export const ONE_SHOT_BRANCH = "approval via `preToolUse` + one-shot grant";
export const STOP_REASON = "Q3 and Q3b both FAIL: STOP (agent-loop 22.2)";
export const STOP_BRANCH =
  "STOP: Q3 and Q3b both FAIL; neither `session/request_permission` nor a blocking `preToolUse` hook works (exit code stays 0)";

export const BLOCK_OPTION_ID = "hook-block";
export const ALLOW_OPTION_ID = "hook-allow";

export interface Q3bIo {
  /** Replaces `os.homedir()`; tests point it at a temp folder. */
  home?: string;
  /** The agent binary; default `kiro-cli`. */
  command?: string;
  /** Repo root that holds the Q43 and Q3 evidence. */
  repoRoot?: string;
  /** Replaces the Q43 evidence lookup. */
  placement?: Q43Placement;
  /** Replaces the Q3 evidence lookup (`null` = no Q3 result found). */
  q3Result?: ResultValue | null;
  /** Cap for the held probe request; default 130 s. */
  capMs?: number;
  /** Timer for the cap; a test injects a manual one. */
  setTimer?: (fn: () => void, ms: number) => TimerHandle;
  /** Clock for the measurement, in ms; called once at hold start and once at release. */
  nowMs?: () => number;
}

type Phase = "block" | "hold";

interface ToolUpdate {
  seq: number;
  phase: Phase;
  status: string;
}

interface HookCall {
  seq: number;
  phase: Phase;
  tool: string;
  at: string;
}

export interface Measured {
  ms: number;
  how: "agent-resumed" | "cap" | "prompt-ended";
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function pending(reason: string, notes: string[], steps: string[]): SpikeOutcome {
  return {
    result: "pending",
    reason,
    criteria: [],
    affects: [],
    openHumanSteps: steps,
    promptsSent: 0,
    notes,
  };
}

function realTimer(fn: () => void, ms: number): TimerHandle {
  const t = setTimeout(fn, ms);
  t.unref();
  return { clear: () => clearTimeout(t) };
}

/** Quotes a path for the hook command only when it holds a character a shell would split on. */
export function shellQuote(s: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

/** The profile's hook command (D11): no token on the command line or in the profile. */
export function hookCommand(root: string, clientPath?: string): string {
  const client = clientPath ?? resolve(dirname(fileURLToPath(import.meta.url)), "hook-client.ts");
  return `node --experimental-strip-types ${shellQuote(client)} ${shellQuote(root)}`;
}

/** Reads the newest `spike/kiro/q3/evidence/<stamp>/index.json`; null when absent. */
export function readQ3Result(repoRoot: string): ResultValue | null {
  const root = join(repoRoot, "spike/kiro/q3/evidence");
  let stamps: string[] = [];
  try {
    stamps = readdirSync(root).sort().reverse();
  } catch {
    return null;
  }
  for (const stamp of stamps) {
    try {
      const idx = JSON.parse(readFileSync(join(root, stamp, "index.json"), "utf8")) as {
        result?: unknown;
      };
      const r = idx.result;
      if (r === "PASS" || r === "FAIL" || r === "PARTIAL" || r === "pending") return r;
    } catch {
      // Not a stamp folder with an index; try an older one.
    }
  }
  return null;
}

/** Q3 and Q3b decide the approval path together (R11.2 to R11.4, OQ-8). Pure. */
export function decideBranch(
  q3b: ResultValue,
  q3: ResultValue | null,
): { branch?: string; stop: boolean; note: string } {
  if (q3b === "FAIL" && q3 === "FAIL")
    return { branch: STOP_BRANCH, stop: true, note: "stop = true" };
  if (q3b === "PASS" && q3 === "FAIL") {
    return { branch: ONE_SHOT_BRANCH, stop: false, note: "Q3 FAIL and Q3b PASS" };
  }
  if (q3 === "PASS") return { stop: false, note: "Q3 PASS; Q3b recorded for information (OQ-8)" };
  if (q3 === null)
    return { stop: false, note: "no Q3 result found; the joint branch is decided later" };
  return { stop: false, note: `Q3 ${q3}; no joint branch yet` };
}

function toolOf(event: unknown): string {
  if (isObject(event)) {
    for (const k of ["tool_name", "toolName", "tool"]) {
      const v = event[k];
      if (typeof v === "string" && v.length > 0) return v.slice(0, 80);
    }
  }
  return "unknown tool";
}

/** Never starts anything but the agent argv from `kiroAcpArgv`; `io` is for tests. */
export async function run(ctx: SpikeContext, io: Q3bIo = {}): Promise<SpikeOutcome> {
  const home = io.home ?? homedir();
  const command = io.command ?? "kiro-cli";
  const repoRoot = io.repoRoot ?? DEFAULT_REPO_ROOT;
  const placement = io.placement ?? readQ43Placement(repoRoot);
  const capMs = io.capMs ?? HOLD_CAP_MS;
  const setTimer = io.setTimer ?? realTimer;
  const nowMs = io.nowMs ?? (() => performance.now());
  const notes: string[] = [];
  if (placement === "unknown")
    notes.push("no Q43 evidence found; the scratch placement is assumed");
  if (placement === "none")
    notes.push("Q43 failed: launched without `--agent`, so the profile is not selected");

  const profile = buildKiroProfile({
    q: "q3b",
    prompt: PROFILE_PROMPT,
    hook: { command: hookCommand(ctx.root), matcher: HOOK_MATCHER },
  });
  assertSafeProfile(profile);
  const kind = placement === "home" ? "home" : "scratch";
  if (kind === "home" && !ctx.allowHomeProfile) {
    return pending(HOME_PENDING_REASON, [...notes, HOME_PENDING_NOTE], ["HS-S6"]);
  }
  const path = profilePlacement("q3b", ctx.scratch, kind, home).path;

  const token = newHookToken();
  writeHookToken(ctx.root, token);

  let phase: Phase = "block";
  let seq = 0;
  const hookCalls: HookCall[] = [];
  const tools: ToolUpdate[] = [];
  const ownerAnswers: PermissionAnswer[] = [];
  const permissions: PermissionRequest[] = [];
  const hold: { release: ((how: Measured["how"]) => void) | null; measured: Measured | null } = {
    release: null,
    measured: null,
  };

  const ask = async (event: unknown): Promise<HookAnswer> => {
    const call: HookCall = { seq: ++seq, phase, tool: toolOf(event), at: ctx.now().toISOString() };
    hookCalls.push(call);
    if (call.phase === "hold") {
      // The probe: hold this one request without answering, then block (never allow).
      const started = nowMs();
      await new Promise<void>((done) => {
        const timer = setTimer(() => finish("cap"), capMs);
        function finish(how: Measured["how"]): void {
          if (hold.release === null) return;
          hold.release = null;
          timer.clear();
          hold.measured = { ms: Math.round(nowMs() - started), how };
          done();
        }
        hold.release = finish;
      });
      return "timeout";
    }
    const req: PermissionRequest = {
      tool: `hook: ${call.tool}`,
      args: event,
      options: [
        { optionId: BLOCK_OPTION_ID, name: "Block (hook exits 2)", kind: "reject_once" },
        {
          optionId: ALLOW_OPTION_ID,
          name: "Allow this one call (hook exits 0)",
          kind: "allow_once",
        },
      ],
    };
    const answer = await ctx.approval(req);
    ownerAnswers.push(answer);
    return answer;
  };

  const receiver = await startHookReceiver({ port: 7782, token, ask, log: () => {} });
  if (receiver.outcome === "pending") return pending(receiver.reason, notes, []);

  const rawLog = join(ctx.root, "q3b.jsonl");
  let stopReason: string | null = null;
  let error: string | null = null;
  let promptsSent = 0;
  let partial: string | null = null;
  let notFound = false;
  let events: ReturnType<typeof receiver.events> = [];
  let probeStopReason: string | null = null;

  try {
    if (kind === "home") {
      ctx.humanStep(
        "HS-S6",
        "Q3b writes one new file, wraith-spike-q3b.json, into your ~/.kiro/agents/ and deletes it afterwards. Nothing else there is touched.",
      );
    }
    try {
      recordInMarker(ctx, (m) => writeProfileFile("q3b", profile, path, m));
      const acp = startRawAcp({
        argv: kiroAcpArgv(command, "q3b", placement),
        cwd: ctx.scratch,
        env: ctx.env("agent"),
        maxPrompts: ctx.meta.maxPrompts,
        killAfterMs: ctx.meta.maxWallSeconds * 1000,
        root: ctx.root,
        rawLog,
      });
      acp.onPermission(async (req: PermissionRequest) => {
        permissions.push(req);
        const answer = await ctx.approval(req);
        ownerAnswers.push(answer);
        return answer;
      });
      acp.onUpdate((u) => {
        if (!isObject(u) || u.sessionUpdate !== "tool_call_update") return;
        if (typeof u.status !== "string") return;
        tools.push({ seq: ++seq, phase, status: u.status });
        if (phase === "hold" && (u.status === "failed" || u.status === "completed")) {
          hold.release?.("agent-resumed");
        }
      });
      try {
        await acp.initialize({});
        const created = await acp.newSession(ctx.scratch);
        stopReason = (await acp.prompt(created.sessionId, PROBE_PROMPT)).stopReason;
        if (hookCalls.length > 0 && acp.partialReason() === null) {
          phase = "hold";
          try {
            probeStopReason = (await acp.prompt(created.sessionId, HOLD_PROMPT)).stopReason;
          } finally {
            hold.release?.("prompt-ended");
          }
        }
      } catch (e) {
        error = errorMessage(e);
        notFound = /ENOENT/.test(error);
      } finally {
        promptsSent = acp.promptsSent();
        partial = acp.partialReason();
        await acp.close();
      }
    } catch (e) {
      error = errorMessage(e);
    }
  } finally {
    hold.release?.("prompt-ended");
    events = receiver.events();
    await receiver.close();
    if (kind === "home") rmSync(path, { force: true });
  }

  if (notFound) return pending("kiro-cli was not found on PATH; Q3b needs it installed", notes, []);

  const blockCalls = hookCalls.filter((c) => c.phase === "block");
  const first = blockCalls[0] ?? null;
  const fired = first !== null;
  const beforeTool =
    first !== null && !tools.some((t) => t.status === "completed" && t.seq < first.seq);
  const answered = ownerAnswers.find(
    (a) => a.outcome === "selected" && a.optionId === ALLOW_OPTION_ID,
  );
  const ownerAllowed = answered !== undefined;
  const ranAfterHook =
    first !== null &&
    tools.some((t) => t.phase === "block" && t.status === "completed" && t.seq > first.seq);
  const blockEvent = events.find((e) => e.decision === "block");
  const blocked = fired && !ownerAllowed && !ranAfterHook && blockEvent !== undefined;
  const m = hold.measured;

  const criteria: CriterionRecord[] = [
    {
      id: "q3b-hook-fires",
      ok: fired,
      observed: `hook calls: ${hookCalls.length}${first !== null ? `, tool "${first.tool}"` : ""}`,
    },
    {
      id: "q3b-before-tool",
      ok: fired && beforeTool,
      observed: `tool updates: ${tools.map((t) => `${t.phase}:${t.status}`).join(", ") || "none"}`,
    },
    {
      id: "q3b-exit2-blocks",
      ok: blocked,
      observed: `receiver decision: ${blockEvent?.decision ?? "none"} (${blockEvent?.why ?? "n/a"}), tool ran after hook: ${ranAfterHook}, stopReason ${stopReason ?? "none"}`,
    },
    {
      id: "q3b-timeout-measured",
      ok: m !== null,
      observed:
        m === null
          ? "not measured"
          : m.how === "cap"
            ? `upper bound ${m.ms} ms (cap): the agent was still waiting at the cap; the hook timeout is above it`
            : `upper bound ${m.ms} ms (${m.how}): the agent had stopped waiting by then; the real timeout is at most this`,
    },
  ];
  if (error !== null) notes.push(`run error: ${error}`);
  if (m !== null) notes.push(TIMEOUT_BOUND_NOTE);
  if (permissions.length > 0)
    notes.push(`Kiro also sent ${permissions.length} permission request(s)`);

  const outcome: SpikeOutcome = {
    result: "FAIL",
    criteria,
    affects: [],
    openHumanSteps: [],
    promptsSent,
    notes,
  };
  if (partial !== null) {
    outcome.result = "PARTIAL";
    outcome.reason = partial;
  } else if (!fired) {
    outcome.result = "FAIL";
  } else if (ownerAllowed) {
    outcome.result = "PARTIAL";
    outcome.reason =
      "the owner allowed the hook call; the block path was not observed (rerun and press 1)";
  } else if (!beforeTool || !blocked) {
    outcome.result = "FAIL";
  } else if (m === null) {
    outcome.result = "PARTIAL";
    outcome.reason = "the hook timeout was not measured";
  } else {
    outcome.result = "PASS";
  }

  const q3 = io.q3Result !== undefined ? io.q3Result : readQ3Result(repoRoot);
  const decision = decideBranch(outcome.result, q3);
  if (decision.branch !== undefined) outcome.branch = decision.branch;
  if (decision.stop) outcome.stop = { reason: STOP_REASON };
  notes.push(decision.note);

  await ctx.evidence.addJsonl("frames.jsonl", asyncFileLines([rawLog]));
  await ctx.evidence.addJsonl(
    "hook-events.jsonl",
    (async function* () {
      for (const e of events) yield JSON.stringify(e);
    })(),
  );
  await ctx.evidence.addText(
    "hook-timeout.json",
    `${JSON.stringify(
      {
        timeoutUpperBoundMs: m === null ? null : m.ms,
        timeoutBoundKind: m === null ? null : m.how,
        capMs,
        probeStopReason,
        note: TIMEOUT_BOUND_NOTE,
      },
      null,
      2,
    )}\n`,
  );
  await ctx.evidence.addText(
    "decision.json",
    `${JSON.stringify({ q3, q3b: outcome.result, stop: decision.stop, branch: decision.branch ?? null }, null, 2)}\n`,
  );
  return outcome;
}
