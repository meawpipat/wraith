// spike-meta
// id: q23
// group: B
// cost: low
// run-by: owner
// agents: kiro
// max-prompts: 0
// max-wall-seconds: 1200
// estimate-credits: 0-2
// claude-prompts: 0
// human: HS-S2
// depends: q3
// shares: q3
// allow-always: never
// assumption: none
// end-spike-meta
import { rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { startRawAcp } from "../../lib/acp-echo.ts";
import {
  assertSafeProfile,
  buildKiroProfile,
  profilePlacement,
  writeProfileFile,
} from "../../lib/agent-profile.ts";
import type { PermissionRequest } from "../../lib/approval.ts";
import {
  DEFAULT_REPO_ROOT,
  errorMessage,
  kiroAcpArgv,
  type Q43Placement,
  readQ43Placement,
  recordInMarker,
} from "../../lib/kiro-spike.ts";
import type { CriterionRecord, SpikeContext, SpikeOutcome } from "../../lib/outcome.ts";
import { compareReplays } from "./compare.ts";

/**
 * Q23 asks whether `session/load` replays the same message and tool-call ids every time. It sends
 * no prompt: it loads the Q3 session twice (same cwd) and compares the ids of the two replays.
 * It only runs in the same invocation as Q3 (D6), which hands over the session through `ctx.shared`.
 */
export const AGENT_NAME = "wraith-spike-q23";
export const PROFILE_PROMPT = "You are a throwaway Wraith spike agent. Do only what the user asks.";
export const STANDALONE_REASON = "needs q3 session in the same run";
export const DEDUPE_BRANCH =
  "replayed ids differ between loads: dedupe replayed updates with hash(turnIndex, text)";
export const HOME_PENDING_REASON = "Q43 placed the profile in ~/.kiro/agents/; HS-S6 open";
export const HOME_PENDING_NOTE =
  "Nothing was written to ~/.kiro/agents/. To allow one new file there (HS-S6), re-run: pnpm spike run q3 q23 --allow-home-profile";

export interface Q23Io {
  /** Replaces `os.homedir()`; tests point it at a temp folder. */
  home?: string;
  /** The agent binary; default `kiro-cli`. */
  command?: string;
  /** Repo root that holds the Q43 evidence. */
  repoRoot?: string;
  /** Replaces the Q43 evidence lookup. */
  placement?: Q43Placement;
  /**
   * Test only: open one session in this process before loading, because a fake agent keeps no
   * sessions between processes. Costs no prompt. The real run never sets it.
   */
  seedSession?: boolean;
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

/** Never starts anything but the agent argv from `kiroAcpArgv`; `io` is for tests. */
export async function run(ctx: SpikeContext, io: Q23Io = {}): Promise<SpikeOutcome> {
  const shared = ctx.shared;
  const sessionId = shared?.owner === "q3" ? shared.data.sessionId : undefined;
  const sharedCwd = shared?.owner === "q3" ? shared.data.cwd : undefined;
  if (typeof sessionId !== "string" || sessionId === "") {
    return pending(STANDALONE_REASON, ["Run it as `pnpm spike run q3 q23`."], []);
  }
  const cwd = typeof sharedCwd === "string" && sharedCwd !== "" ? sharedCwd : ctx.scratch;

  const home = io.home ?? homedir();
  const command = io.command ?? "kiro-cli";
  const repoRoot = io.repoRoot ?? DEFAULT_REPO_ROOT;
  const placement = io.placement ?? readQ43Placement(repoRoot);
  const notes: string[] = [];
  if (placement === "unknown")
    notes.push("no Q43 evidence found; the scratch placement is assumed");
  if (placement === "none")
    notes.push("Q43 failed: launched without `--agent`, so the profile is not selected");

  const profile = buildKiroProfile({ q: "q23", prompt: PROFILE_PROMPT });
  assertSafeProfile(profile);
  const kind = placement === "home" ? "home" : "scratch";
  if (kind === "home" && !ctx.allowHomeProfile) {
    return pending(HOME_PENDING_REASON, [...notes, HOME_PENDING_NOTE], ["HS-S6"]);
  }
  const path = profilePlacement("q23", ctx.scratch, kind, home).path;
  if (kind === "home") {
    ctx.humanStep(
      "HS-S6",
      "Q23 writes one new file, wraith-spike-q23.json, into your ~/.kiro/agents/ and deletes it afterwards. Nothing else there is touched.",
    );
  }

  const rawLog = join(ctx.root, "q23.jsonl");
  const first: unknown[] = [];
  const second: unknown[] = [];
  let loadsDone = 0;
  let error: string | null = null;
  let partial: string | null = null;
  let notFound = false;

  try {
    recordInMarker(ctx, (m) => writeProfileFile("q23", profile, path, m));
    const acp = startRawAcp({
      argv: kiroAcpArgv(command, "q23", placement),
      cwd,
      env: ctx.env("agent"),
      maxPrompts: ctx.meta.maxPrompts,
      killAfterMs: ctx.meta.maxWallSeconds * 1000,
      root: ctx.root,
      rawLog,
    });
    // No prompt is sent, so a permission request is not expected; if one comes the owner decides.
    acp.onPermission((req: PermissionRequest) => ctx.approval(req));
    try {
      await acp.initialize({});
      if (io.seedSession === true) await acp.newSession(cwd);
      first.push(...(await acp.loadSession(sessionId, cwd)).replay);
      loadsDone = 1;
      second.push(...(await acp.loadSession(sessionId, cwd)).replay);
      loadsDone = 2;
    } catch (e) {
      error = errorMessage(e);
      notFound = /ENOENT/.test(error);
    } finally {
      partial = acp.partialReason();
      await acp.close();
    }
  } catch (e) {
    error = errorMessage(e);
  } finally {
    if (kind === "home") rmSync(path, { force: true });
  }

  if (notFound) return pending("kiro-cli was not found on PATH; Q23 needs it installed", notes, []);

  const cmp = compareReplays(first, second);
  const criteria: CriterionRecord[] = [
    {
      id: "q23-loaded-twice",
      ok: loadsDone === 2,
      observed: `session/load completed ${loadsDone} of 2 times${error !== null ? `: ${error}` : ""}`,
    },
    {
      id: "q23-replay-has-ids",
      ok: cmp.comparable,
      observed: `ids in load 1: ${cmp.a.ids.length}, load 2: ${cmp.b.ids.length}, updates without id: ${cmp.a.withoutId + cmp.b.withoutId}`,
    },
    {
      id: "q23-ids-equal",
      ok: cmp.equal && cmp.comparable,
      observed: cmp.equal
        ? `${cmp.a.ids.length} ids, identical`
        : `only in load 1: ${cmp.onlyInA.join(", ") || "none"}; only in load 2: ${cmp.onlyInB.join(", ") || "none"}`,
    },
  ];
  if (error !== null) notes.push(`run error: ${error}`);

  const outcome: SpikeOutcome = {
    result: "FAIL",
    criteria,
    affects: [],
    openHumanSteps: [],
    promptsSent: 0,
    notes,
  };
  if (partial !== null) {
    outcome.result = "PARTIAL";
    outcome.reason = partial;
  } else if (loadsDone < 2) {
    outcome.result = "PARTIAL";
    outcome.reason = `session/load did not complete twice (${error ?? "no error recorded"})`;
  } else if (!cmp.comparable) {
    outcome.result = "PARTIAL";
    outcome.reason = "the replay carried no message or tool-call ids to compare";
  } else if (cmp.equal) {
    outcome.result = "PASS";
  } else {
    outcome.branch = DEDUPE_BRANCH;
  }

  await ctx.evidence.addText(
    "comparison.json",
    `${JSON.stringify({ sessionId, cwd, ...cmp }, null, 2)}\n`,
  );
  await ctx.evidence.addJsonl("replay-1.jsonl", lines(first));
  await ctx.evidence.addJsonl("replay-2.jsonl", lines(second));
  return outcome;
}

async function* lines(items: readonly unknown[]): AsyncGenerator<string> {
  for (const i of items) yield JSON.stringify(i);
}
