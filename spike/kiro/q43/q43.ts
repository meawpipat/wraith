// spike-meta
// id: q43
// group: J
// cost: low
// run-by: loop
// agents: kiro
// max-prompts: 1
// max-wall-seconds: 900
// estimate-credits: 0-3
// claude-prompts: 0
// human: HS-S2, HS-S6
// depends: none
// shares: none
// allow-always: never
// assumption: A1 Estimate
// end-spike-meta
import { readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type AcpEcho, startRawAcp } from "../../lib/acp-echo.ts";
import {
  assertSafeProfile,
  buildKiroProfile,
  profilePlacement,
  writeProfileFile,
} from "../../lib/agent-profile.ts";
import {
  type ApprovalPolicy,
  type PermissionAnswer,
  type PermissionRequest,
  pickOption,
} from "../../lib/approval.ts";
import type { CriterionRecord, SpikeContext, SpikeOutcome } from "../../lib/outcome.ts";
import { MARKER_FILE, readMarker, writeMarker } from "../../lib/own-marker.ts";

/**
 * Q43 asks whether `kiro-cli acp --agent-engine v3 --agent <name>` loads a custom profile from the
 * Scratch_Workspace (`<scratch>/.kiro/agents/`) or only from `~/.kiro/agents/`, and whether the
 * profile's tools apply. Later Kiro spikes read `placement.json` through `profilePlacement`.
 */
export const AGENT_NAME = "wraith-spike-q43";
/** Recorded on `FAIL`; the architecture text is not edited by this spike (R16.7). */
export const FAIL_BRANCH =
  "launch without `--agent`, select it after `initialize` with `session/set_mode` or the agent config option; text to update: §4.4/§5 argv";
export const PROFILE_PROMPT = "You are a throwaway Wraith spike agent. Do only what the user asks.";
/** The profile pre-approves read-only tools only, so a shell request must ask. */
export const PROBE_PROMPT = "Run `echo hi` with your shell tool and tell me the output.";

export const HOME_PENDING_REASON = "scratch profile not found; HS-S6 open";
export const HOME_PENDING_NOTE =
  "Nothing was written to ~/.kiro/agents/. To allow one new file there (HS-S6), re-run: pnpm spike q43 --allow-home-profile";

/** Every permission request is answered with a reject option (R16.9, R8.3). */
const REJECT_ALL: ApprovalPolicy = { kind: "reject-all", allowAlways: "never", timeoutMs: 120_000 };

export interface Q43Io {
  /** Replaces `os.homedir()`; tests point it at a temp folder, never the real `~/.kiro`. */
  home?: string;
  /** The agent binary; default `kiro-cli`. */
  command?: string;
}

export type Placement = "scratch" | "home";

interface Attempt {
  placement: Placement;
  started: boolean;
  notFound: boolean;
  error: string | null;
  asked: number;
  answers: PermissionAnswer[];
  prompted: boolean;
  stopReason: string | null;
  promptsSent: number;
  partial: string | null;
  rawLog: string;
}

function argvFor(command: string): string[] {
  return [command, "acp", "--agent-engine", "v3", "--agent", AGENT_NAME];
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Records a written profile file in the on-disk marker so a crashed run can still delete it. */
function recordInMarker(
  ctx: SpikeContext,
  write: (m: NonNullable<ReturnType<typeof readMarker>>) => void,
) {
  const marker = readMarker(ctx.root);
  if (marker === null)
    throw new Error(`no ${MARKER_FILE} in the Spike_Root; refusing a home profile`);
  write(marker);
  writeMarker(marker);
}

async function attemptLaunch(
  ctx: SpikeContext,
  command: string,
  placement: Placement,
  sendPrompt: boolean,
): Promise<Attempt> {
  const rawLog = join(ctx.root, `q43-${placement}.jsonl`);
  const a: Attempt = {
    placement,
    started: false,
    notFound: false,
    error: null,
    asked: 0,
    answers: [],
    prompted: false,
    stopReason: null,
    promptsSent: 0,
    partial: null,
    rawLog,
  };
  const acp: AcpEcho = startRawAcp({
    argv: argvFor(command),
    cwd: ctx.scratch,
    env: ctx.env("agent"),
    maxPrompts: ctx.meta.maxPrompts,
    killAfterMs: ctx.meta.maxWallSeconds * 1000,
    root: ctx.root,
    rawLog,
  });
  acp.onPermission(async (req: PermissionRequest) => {
    a.asked++;
    const answer = pickOption(req, null, REJECT_ALL, true, false) ?? {
      outcome: "cancelled" as const,
      reason: "policy" as const,
    };
    a.answers.push(answer);
    return answer;
  });
  try {
    await acp.initialize({});
    const { sessionId } = await acp.newSession(ctx.scratch);
    a.started = true;
    if (sendPrompt) {
      a.prompted = true;
      try {
        a.stopReason = (await acp.prompt(sessionId, PROBE_PROMPT)).stopReason;
      } catch (e) {
        a.error = message(e);
      }
    }
  } catch (e) {
    a.error = message(e);
    a.notFound = /ENOENT/.test(a.error);
  } finally {
    a.promptsSent = acp.promptsSent();
    a.partial = acp.partialReason();
    await acp.close();
  }
  return a;
}

function* lines(path: string): Generator<string> {
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const l of text.split("\n")) if (l !== "") yield l;
}

async function* asyncLines(paths: string[]): AsyncGenerator<string> {
  for (const p of paths) yield* lines(p);
}

function noAllow(answers: readonly PermissionAnswer[]): boolean {
  return answers.every((a) => a.outcome !== "selected");
}

/** Never starts anything but the agent argv above; `io` is for tests. */
export async function run(ctx: SpikeContext, io: Q43Io = {}): Promise<SpikeOutcome> {
  const home = io.home ?? homedir();
  const command = io.command ?? "kiro-cli";
  const profile = buildKiroProfile({ q: "q43", prompt: PROFILE_PROMPT });
  assertSafeProfile(profile);
  const notes: string[] = [];
  const attempts: Attempt[] = [];
  const homeFiles: string[] = [];
  let placement: Placement | null = null;

  try {
    // 1. Scratch first. The file sits under the Spike_Root, so root removal deletes it.
    const scratchPath = profilePlacement("q43", ctx.scratch, "scratch", home).path;
    recordInMarker(ctx, (m) => writeProfileFile("q43", profile, scratchPath, m));
    const first = await attemptLaunch(ctx, command, "scratch", true);
    attempts.push(first);
    if (first.notFound) {
      return {
        result: "pending",
        reason: "kiro-cli was not found on PATH; Q43 needs it installed",
        criteria: [],
        affects: [],
        openHumanSteps: [],
        promptsSent: 0,
        notes,
      };
    }
    if (first.started) placement = "scratch";

    // 2. Home fallback: only with `--allow-home-profile` (HS-S6). One new file, one retry.
    //    Deleted in `finally` and by cleanup.
    if (placement === null && !ctx.allowHomeProfile) {
      await ctx.evidence.addText(
        "placement.json",
        `${JSON.stringify({ placement: null, profile: `${AGENT_NAME}.json` }, null, 2)}\n`,
      );
      return {
        result: "pending",
        reason: HOME_PENDING_REASON,
        criteria: [],
        affects: [],
        openHumanSteps: ["HS-S6"],
        promptsSent: attempts.reduce((n, a) => n + a.promptsSent, 0),
        notes: [...notes, HOME_PENDING_NOTE],
      };
    }
    if (placement === null) {
      ctx.humanStep(
        "HS-S6",
        "Q43 writes one new file, wraith-spike-q43.json, into your ~/.kiro/agents/ and deletes it afterwards. Nothing else there is touched.",
      );
      const homePath = profilePlacement("q43", ctx.scratch, "home", home).path;
      try {
        recordInMarker(ctx, (m) => writeProfileFile("q43", profile, homePath, m));
        homeFiles.push(homePath);
      } catch (e) {
        notes.push(`home profile not written: ${message(e)}`);
      }
      if (homeFiles.length > 0) {
        const second = await attemptLaunch(ctx, command, "home", true);
        attempts.push(second);
        if (second.started) placement = "home";
      }
    }
  } catch (e) {
    notes.push(`placement error: ${message(e)}`);
  } finally {
    for (const f of homeFiles) rmSync(f, { force: true });
  }

  const used = attempts.find((a) => a.placement === placement) ?? null;
  const last = attempts.at(-1) ?? null;
  const promptsSent = attempts.reduce((n, a) => n + a.promptsSent, 0);
  const asked = used !== null && used.asked > 0;
  const allAnswers = attempts.flatMap((a) => a.answers);
  const partial = attempts.map((a) => a.partial).find((p) => p !== null) ?? null;

  const criteria: CriterionRecord[] = [
    {
      id: "q43-agent-starts",
      ok: used !== null,
      observed:
        used !== null
          ? `started with the profile in ${used.placement}`
          : `no start: ${last?.error ?? "no attempt"}`,
    },
    {
      id: "q43-tool-asks",
      ok: asked,
      observed: `permission requests: ${used?.asked ?? 0}, stopReason ${used?.stopReason ?? "none"}`,
    },
    {
      id: "q43-all-rejected",
      ok: noAllow(allAnswers),
      observed: `${allAnswers.length} answer(s), none an allow`,
    },
    {
      id: "q43-one-prompt",
      ok: promptsSent <= ctx.meta.maxPrompts,
      observed: `${promptsSent} prompt(s) sent`,
    },
  ];

  const pass = used !== null && asked;
  await ctx.evidence.addText(
    "placement.json",
    `${JSON.stringify({ placement: pass ? placement : null, profile: `${AGENT_NAME}.json` }, null, 2)}\n`,
  );
  await ctx.evidence.addText(
    "summary.json",
    `${JSON.stringify(
      {
        result: pass ? "PASS" : "FAIL",
        placement,
        attempts: attempts.map((a) => ({
          placement: a.placement,
          started: a.started,
          asked: a.asked,
          error: a.error,
        })),
        branch: pass ? null : FAIL_BRANCH,
      },
      null,
      2,
    )}\n`,
  );
  await ctx.evidence.addJsonl("frames.jsonl", asyncLines(attempts.map((a) => a.rawLog)));
  notes.push("every permission request was answered with a reject option");

  const outcome: SpikeOutcome = {
    result: pass ? "PASS" : "FAIL",
    criteria,
    affects: [],
    openHumanSteps: [],
    promptsSent,
    notes,
  };
  if (partial !== null) {
    outcome.result = "PARTIAL";
    outcome.reason = partial;
  } else if (!pass) {
    outcome.branch = FAIL_BRANCH;
  }
  return outcome;
}
