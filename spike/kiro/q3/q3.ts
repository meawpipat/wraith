// spike-meta
// id: q3
// group: B
// cost: low
// run-by: owner
// agents: kiro
// max-prompts: 4
// max-wall-seconds: 1800
// estimate-credits: 2-6
// claude-prompts: 0
// human: HS-S2, HS-S3
// depends: q43
// shares: none
// allow-always: never
// assumption: A1 Estimate
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
import type { PermissionAnswer, PermissionOption, PermissionRequest } from "../../lib/approval.ts";
import { publishNamedCopy } from "../../lib/evidence.ts";
import {
  asyncFileLines,
  DEFAULT_REPO_ROOT,
  errorMessage,
  isAllow,
  kiroAcpArgv,
  type Q43Placement,
  readQ43Placement,
  recordInMarker,
} from "../../lib/kiro-spike.ts";
import type { CriterionRecord, SpikeContext, SpikeOutcome } from "../../lib/outcome.ts";

/**
 * Q3 asks whether Kiro sends ACP `session/request_permission` with `options[]` for a tool the
 * profile does not pre-approve, and whether the owner's selection makes the tool run. The owner
 * answers every request; nothing here answers one by itself.
 */
export const AGENT_NAME = "wraith-spike-q3";
export const PROFILE_PROMPT = "You are a throwaway Wraith spike agent. Do only what the user asks.";
export const PROBE_PROMPT = "Run `echo hi` with your shell tool and tell me the output.";
export const TIMEOUT_REASON = "approval tap missing";
export const NO_REQUEST_BRANCH =
  "no `session/request_permission` arrived: approval would go through Q3b (`preToolUse` + one-shot grant)";
export const HOME_PENDING_REASON = "Q43 placed the profile in ~/.kiro/agents/; HS-S6 open";
export const HOME_PENDING_NOTE =
  "Nothing was written to ~/.kiro/agents/. To allow one new file there (HS-S6), re-run: pnpm spike q3 --allow-home-profile";

export interface Q3Io {
  /** Replaces `os.homedir()`; tests point it at a temp folder. */
  home?: string;
  /** The agent binary; default `kiro-cli`. */
  command?: string;
  /** Repo root that holds the Q43 evidence and receives `spike/kiro/q3.jsonl`. */
  repoRoot?: string;
  /** Replaces the Q43 evidence lookup. */
  placement?: Q43Placement;
}

interface Seen {
  options: PermissionOption[];
  tool: string;
  answer: PermissionAnswer | null;
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

/** Never starts anything but the agent argv from `kiroAcpArgv`; `io` is for tests. */
export async function run(ctx: SpikeContext, io: Q3Io = {}): Promise<SpikeOutcome> {
  const home = io.home ?? homedir();
  const command = io.command ?? "kiro-cli";
  const repoRoot = io.repoRoot ?? DEFAULT_REPO_ROOT;
  const placement = io.placement ?? readQ43Placement(repoRoot);
  const notes: string[] = [];
  if (placement === "unknown")
    notes.push("no Q43 evidence found; the scratch placement is assumed");
  if (placement === "none")
    notes.push("Q43 failed: launched without `--agent`, so the profile is not selected");

  const profile = buildKiroProfile({ q: "q3", prompt: PROFILE_PROMPT });
  assertSafeProfile(profile);
  const kind = placement === "home" ? "home" : "scratch";
  if (kind === "home" && !ctx.allowHomeProfile) {
    return pending(HOME_PENDING_REASON, [...notes, HOME_PENDING_NOTE], ["HS-S6"]);
  }
  const path = profilePlacement("q3", ctx.scratch, kind, home).path;
  if (kind === "home") {
    ctx.humanStep(
      "HS-S6",
      "Q3 writes one new file, wraith-spike-q3.json, into your ~/.kiro/agents/ and deletes it afterwards. Nothing else there is touched.",
    );
  }

  const rawLog = join(ctx.root, "q3.jsonl");
  const seen: Seen[] = [];
  const toolStatus: string[] = [];
  let sessionId: string | null = null;
  let stopReason: string | null = null;
  let error: string | null = null;
  let promptsSent = 0;
  let partial: string | null = null;
  let notFound = false;

  try {
    recordInMarker(ctx, (m) => writeProfileFile("q3", profile, path, m));
    const acp = startRawAcp({
      argv: kiroAcpArgv(command, "q3", placement),
      cwd: ctx.scratch,
      env: ctx.env("agent"),
      maxPrompts: ctx.meta.maxPrompts,
      killAfterMs: ctx.meta.maxWallSeconds * 1000,
      root: ctx.root,
      rawLog,
    });
    acp.onPermission(async (req: PermissionRequest) => {
      const entry: Seen = { options: req.options, tool: req.tool, answer: null };
      seen.push(entry);
      const answer = await ctx.approval(req);
      entry.answer = answer;
      return answer;
    });
    acp.onUpdate((u) => {
      if (isObject(u) && u.sessionUpdate === "tool_call_update" && typeof u.status === "string") {
        toolStatus.push(u.status);
      }
    });
    try {
      await acp.initialize({});
      const created = await acp.newSession(ctx.scratch);
      sessionId = created.sessionId;
      await ctx.evidence.addText(
        "session.json",
        `${JSON.stringify({ sessionId, cwd: ctx.scratch }, null, 2)}\n`,
      );
      if (ctx.shared !== null) {
        ctx.shared.data.sessionId = sessionId;
        ctx.shared.data.cwd = ctx.scratch;
      }
      stopReason = (await acp.prompt(sessionId, PROBE_PROMPT)).stopReason;
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
  } finally {
    // The scratch file sits under the Spike_Root; a home file is removed here and by cleanup.
    if (kind === "home") rmSync(path, { force: true });
  }

  if (notFound) return pending("kiro-cli was not found on PATH; Q3 needs it installed", notes, []);

  const first = seen[0] ?? null;
  const answered = first?.answer ?? null;
  const allowed = answered !== null && isAllow(answered);
  const ran = allowed && toolStatus.includes("completed");
  const timedOut =
    answered !== null && answered.outcome !== "selected" && answered.reason === "timeout";
  const hasOptions = first !== null && first.options.length > 0;

  const criteria: CriterionRecord[] = [
    {
      id: "q3-request-permission",
      ok: first !== null,
      observed: `permission requests: ${seen.length}${first !== null ? `, tool "${first.tool}"` : ""}`,
    },
    {
      id: "q3-options",
      ok: hasOptions,
      observed: `options: ${first?.options.map((o) => o.kind).join(", ") ?? "none"}`,
    },
    {
      id: "q3-owner-selection",
      ok: allowed,
      observed: `owner answer: ${answered === null ? "none" : answered.outcome}`,
    },
    {
      id: "q3-tool-ran",
      ok: ran,
      observed: `tool updates: ${toolStatus.join(", ") || "none"}, stopReason ${stopReason ?? "none"}`,
    },
  ];
  if (error !== null) notes.push(`run error: ${error}`);

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
  } else if (first === null) {
    outcome.branch = NO_REQUEST_BRANCH;
  } else if (timedOut) {
    outcome.result = "PARTIAL";
    outcome.reason = TIMEOUT_REASON;
  } else if (ran && hasOptions) {
    outcome.result = "PASS";
  } else if (!allowed) {
    outcome.result = "PARTIAL";
    outcome.reason = "the owner did not allow the tool; the run after an allow is not observed";
  }

  await ctx.evidence.addJsonl("frames.jsonl", asyncFileLines([rawLog]));
  const copied = publishNamedCopy("q3", join(ctx.evidence.dir, "frames.jsonl"), {
    repoRoot,
    result: outcome.result,
  });
  notes.push(copied ? "named copy written: spike/kiro/q3.jsonl" : "no named copy written");
  return outcome;
}
