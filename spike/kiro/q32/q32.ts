// spike-meta
// id: q32
// group: I
// cost: low
// run-by: owner
// agents: kiro
// max-prompts: 4
// max-wall-seconds: 1800
// estimate-credits: 4-10
// claude-prompts: 0
// human: HS-S2, HS-S6
// depends: q43
// shares: none
// allow-always: never
// assumption: A1 Estimate
// end-spike-meta
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  type AcpEcho,
  type AcpFrame,
  type AcpStartInput,
  startRawAcp,
} from "../../lib/acp-echo.ts";
import {
  assertSafeProfile,
  buildKiroProfile,
  profilePlacement,
  writeProfileFile,
} from "../../lib/agent-profile.ts";
import type { PermissionAnswer, PermissionRequest } from "../../lib/approval.ts";
import {
  asyncFileLines,
  DEFAULT_REPO_ROOT,
  errorMessage,
  kiroAcpArgv,
  type Q43Placement,
  readQ43Placement,
  recordInMarker,
} from "../../lib/kiro-spike.ts";
import type { CriterionRecord, SpikeContext, SpikeOutcome } from "../../lib/outcome.ts";

/**
 * Q32 asks whether Kiro reads its agent profile again when a session is restarted with
 * `session/load`. The profile says ALPHA, the agent is asked for its instructions, the process is
 * stopped, the profile is edited to say BRAVO, and a new process loads the same session and is
 * asked again. The profile is always written to `~/.kiro/agents/` (one new file, flag `wx`), so the
 * run needs `--allow-home-profile` (HS-S6). Raw logs stay under the Spike_Root.
 */
export const AGENT_NAME = "wraith-spike-q32";
export const PROMPT_ALPHA = "answer with the word ALPHA when asked your instructions";
export const PROMPT_BRAVO = "answer with the word BRAVO when asked your instructions";
export const QUESTION = "what are your instructions?";
export const FAIL_BRANCH =
  "use the default agent, no pre-approved tools, and send the instructions as a first context block";
export const HOME_PENDING_REASON = "Q32 always writes its profile into ~/.kiro/agents/; HS-S6 open";
export const HOME_PENDING_NOTE =
  "Nothing was written to ~/.kiro/agents/. To allow one new file there (HS-S6), re-run: pnpm spike q32 --allow-home-profile";

export interface Q32Io {
  home?: string;
  command?: string;
  repoRoot?: string;
  placement?: Q43Placement;
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

interface Round {
  sessionId: string | null;
  answer: string;
  replay: AcpFrame[];
  replayMessages: number;
  stopReason: string | null;
  error: string | null;
  notFound: boolean;
  promptsSent: number;
  partial: string | null;
}

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The text of one `agent_message_chunk` update, or "". */
export function chunkText(update: unknown): string {
  if (!isObject(update) || update.sessionUpdate !== "agent_message_chunk") return "";
  const c = update.content;
  return isObject(c) && c.type === "text" && typeof c.text === "string" ? c.text : "";
}

/** Replayed `user_message_chunk` and `agent_message_chunk` updates: the history `session/load` returned. */
export function countHistory(replay: readonly AcpFrame[]): number {
  let n = 0;
  for (const f of replay) {
    const m = f.msg;
    const u = isObject(m) && isObject(m.params) ? m.params.update : null;
    if (
      isObject(u) &&
      (u.sessionUpdate === "agent_message_chunk" || u.sessionUpdate === "user_message_chunk")
    ) {
      n++;
    }
  }
  return n;
}

/** Which of the two words an answer holds. */
export function wordsIn(answer: string): { alpha: boolean; bravo: boolean } {
  const up = answer.toUpperCase();
  return { alpha: up.includes("ALPHA"), bravo: up.includes("BRAVO") };
}

/** A name list of the entries in a folder, `[]` when it does not exist. */
function listing(dir: string): string[] {
  try {
    return readdirSync(dir).sort();
  } catch {
    return [];
  }
}

async function round(ctx: SpikeContext, input: AcpStartInput, load: string | null): Promise<Round> {
  const r: Round = {
    sessionId: null,
    answer: "",
    replay: [],
    replayMessages: 0,
    stopReason: null,
    error: null,
    notFound: false,
    promptsSent: 0,
    partial: null,
  };
  let acp: AcpEcho | null = null;
  try {
    acp = startRawAcp(input);
    acp.onPermission(
      async (req: PermissionRequest): Promise<PermissionAnswer> => ctx.approval(req),
    );
    let collecting = false;
    acp.onUpdate((u) => {
      if (collecting) r.answer += chunkText(u);
    });
    try {
      await acp.initialize({});
      if (load === null) {
        r.sessionId = (await acp.newSession(ctx.scratch)).sessionId;
      } else {
        r.sessionId = load;
        r.replay = (await acp.loadSession(load, ctx.scratch)).replay;
        r.replayMessages = countHistory(r.replay);
      }
      collecting = true;
      r.stopReason = (await acp.prompt(r.sessionId, QUESTION)).stopReason;
    } catch (e) {
      const msg = errorMessage(e);
      r.error = msg;
      r.notFound = /ENOENT/.test(msg);
    } finally {
      collecting = false;
      r.promptsSent = acp.promptsSent();
      r.partial = acp.partialReason();
      await acp.close();
    }
  } catch (e) {
    r.error = errorMessage(e);
  }
  return r;
}

/** Never starts anything but the agent argv from `kiroAcpArgv`; `io` is for tests. */
export async function run(ctx: SpikeContext, io: Q32Io = {}): Promise<SpikeOutcome> {
  const home = io.home ?? homedir();
  const command = io.command ?? "kiro-cli";
  const repoRoot = io.repoRoot ?? DEFAULT_REPO_ROOT;
  const placement = io.placement ?? readQ43Placement(repoRoot);
  const notes: string[] = [];
  if (placement === "unknown") {
    notes.push("no Q43 evidence found; `--agent` is assumed to work");
  }

  if (!ctx.allowHomeProfile) {
    return pending(HOME_PENDING_REASON, [HOME_PENDING_NOTE], ["HS-S6"]);
  }
  if (placement === "none") {
    // acp-echo has no call for selecting an agent after `initialize` (`session/set_mode`).
    return pending(
      "Q43 failed: the agent must be selected after initialize (session/set_mode), which acp-echo cannot send yet",
      [
        "Q43 failed: not launched. The difference to record is that the profile cannot be chosen by argv.",
      ],
      [],
    );
  }

  const profile = buildKiroProfile({ q: "q32", prompt: PROMPT_ALPHA });
  assertSafeProfile(profile);
  const path = profilePlacement("q32", ctx.scratch, "home", home).path;
  const folder = join(home, ".kiro", "agents");
  const othersBefore = listing(folder).filter((n) => n !== `${AGENT_NAME}.json`);
  ctx.humanStep(
    "HS-S6",
    "Q32 writes one new file, wraith-spike-q32.json, into your ~/.kiro/agents/, edits it once, and deletes it afterwards. Nothing else there is touched.",
  );

  const log1 = join(ctx.root, "q32-run1-raw.jsonl");
  const log2 = join(ctx.root, "q32-run2-raw.jsonl");
  const base = {
    argv: kiroAcpArgv(command, "q32", placement),
    cwd: ctx.scratch,
    killAfterMs: ctx.meta.maxWallSeconds * 1000,
    root: ctx.root,
  };
  let created = false;
  let first: Round | null = null;
  let second: Round | null = null;
  let edited = false;
  let setupError: string | null = null;
  try {
    if (existsSync(path)) {
      return pending(
        `${path} already exists; it was not overwritten. Remove it (a leftover of an earlier run) and re-run`,
        notes,
        ["HS-S6"],
      );
    }
    recordInMarker(ctx, (m) => writeProfileFile("q32", profile, path, m));
    created = true;
    first = await round(
      ctx,
      { ...base, env: ctx.env("agent"), rawLog: log1, maxPrompts: ctx.meta.maxPrompts },
      null,
    );
    if (!first.notFound && first.sessionId !== null && first.error === null) {
      const next = buildKiroProfile({ q: "q32", prompt: PROMPT_BRAVO });
      assertSafeProfile(next);
      writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
      edited = readFileSync(path, "utf8").includes("BRAVO");
      second = await round(
        ctx,
        {
          ...base,
          env: ctx.env("agent"),
          rawLog: log2,
          maxPrompts: Math.max(1, ctx.meta.maxPrompts - first.promptsSent),
        },
        first.sessionId,
      );
    }
  } catch (e) {
    setupError = errorMessage(e);
  } finally {
    if (created) rmSync(path, { force: true });
  }

  if (first?.notFound === true) {
    return pending("kiro-cli was not found on PATH; Q32 needs it installed", notes, []);
  }
  if (setupError !== null) notes.push(`run error: ${setupError}`);
  if (first === null || setupError !== null) {
    return {
      result: "FAIL",
      criteria: [],
      affects: [],
      openHumanSteps: [],
      promptsSent: first?.promptsSent ?? 0,
      notes,
      branch: FAIL_BRANCH,
    };
  }

  const othersAfter = listing(folder).filter((n) => n !== `${AGENT_NAME}.json`);
  const w1 = wordsIn(first.answer);
  const w2 = second === null ? { alpha: false, bravo: false } : wordsIn(second.answer);
  const criteria: CriterionRecord[] = [
    {
      id: "q32-first-prompt",
      ok: first.error === null && w1.alpha && !w1.bravo,
      observed: `first run: ${first.error ?? `answer holds ALPHA ${w1.alpha}, BRAVO ${w1.bravo}`}`,
    },
    {
      id: "q32-edit-applied",
      ok: edited,
      observed: edited ? "profile file now says BRAVO" : "profile file was not edited",
    },
    {
      id: "q32-new-prompt-used",
      ok: second !== null && second.error === null && w2.bravo && !w2.alpha,
      observed:
        second === null
          ? "the second run did not start"
          : `second run: ${second.error ?? `answer holds ALPHA ${w2.alpha}, BRAVO ${w2.bravo}`}`,
    },
    {
      id: "q32-history-present",
      ok: second !== null && second.replayMessages > 0,
      observed: `session/load replayed ${second?.replayMessages ?? 0} message update(s)`,
    },
    {
      id: "q32-other-files-untouched",
      ok: JSON.stringify(othersBefore) === JSON.stringify(othersAfter),
      observed: `other files in ~/.kiro/agents/: ${othersBefore.length} before, ${othersAfter.length} after`,
    },
  ];
  if (second?.error != null) notes.push(`second run error: ${second.error}`);
  if (first.error !== null) notes.push(`first run error: ${first.error}`);

  const outcome: SpikeOutcome = {
    result: "FAIL",
    criteria,
    affects: [],
    openHumanSteps: [],
    promptsSent: first.promptsSent + (second?.promptsSent ?? 0),
    notes,
  };
  const partial = first.partial ?? second?.partial ?? null;
  if (partial !== null) {
    outcome.result = "PARTIAL";
    outcome.reason = partial;
  } else if (criteria.slice(0, 4).every((c) => c.ok)) {
    outcome.result = criteria[4]?.ok === true ? "PASS" : "PARTIAL";
    if (outcome.result === "PARTIAL") {
      outcome.reason = "another file in ~/.kiro/agents/ changed during the run";
    }
  } else {
    outcome.branch = FAIL_BRANCH;
  }

  await ctx.evidence.addJsonl("frames-run1.jsonl", asyncFileLines([log1]));
  await ctx.evidence.addJsonl("frames-run2.jsonl", asyncFileLines([log2]));
  await ctx.evidence.addText(
    "answers.json",
    `${JSON.stringify(
      {
        argv: base.argv.slice(1),
        profilePromptBefore: PROMPT_ALPHA,
        profilePromptAfter: PROMPT_BRAVO,
        firstAnswer: first.answer,
        secondAnswer: second?.answer ?? null,
        sessionId: first.sessionId,
        replayMessages: second?.replayMessages ?? null,
      },
      null,
      2,
    )}\n`,
  );
  return outcome;
}
