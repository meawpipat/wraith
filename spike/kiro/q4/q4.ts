// spike-meta
// id: q4
// group: B
// cost: low
// run-by: owner
// agents: kiro
// max-prompts: 3
// max-wall-seconds: 1200
// estimate-credits: 2-6
// claude-prompts: 0
// human: HS-S2, HS-S3
// depends: q43, q3
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
import type { PermissionAnswer, PermissionRequest } from "../../lib/approval.ts";
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
 * Q4 asks whether Kiro uses the ACP `terminal/*` methods when the client declares
 * `clientCapabilities.terminal: true`. The raw client answers every `terminal/*` request with a
 * JSON-RPC error (`-32601`) and starts no process, so a command only ever runs through the agent's
 * own tool, after the owner's tap. This script never answers a permission request itself.
 */
export const AGENT_NAME = "wraith-spike-q4";
export const PROFILE_PROMPT = "You are a throwaway Wraith spike agent. Do only what the user asks.";
export const PROBE_PROMPT =
  "Run `sleep 20; echo done` with your shell tool and tell me the output once it finishes.";
export const TIMEOUT_REASON = "approval tap missing";
export const FAIL_BRANCH = "show output in the ToolCard";
export const HOME_PENDING_REASON = "Q43 placed the profile in ~/.kiro/agents/; HS-S6 open";
export const HOME_PENDING_NOTE =
  "Nothing was written to ~/.kiro/agents/. To allow one new file there (HS-S6), re-run: pnpm spike q4 --allow-home-profile";

export interface Q4Io {
  /** Replaces `os.homedir()`; tests point it at a temp folder. */
  home?: string;
  /** The agent binary; default `kiro-cli`. */
  command?: string;
  /** Repo root that holds the Q43 evidence. */
  repoRoot?: string;
  /** Replaces the Q43 evidence lookup. */
  placement?: Q43Placement;
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

/** The `terminal/*` methods the agent sent, in order, read from the client's frame log. */
export function terminalCalls(frames: readonly { dir: string; msg: unknown }[]): string[] {
  const out: string[] = [];
  for (const f of frames) {
    if (f.dir !== "a2c" || !isObject(f.msg)) continue;
    const m = f.msg.method;
    if (typeof m === "string" && m.startsWith("terminal/") && f.msg.id !== undefined) out.push(m);
  }
  return out;
}

/** Never starts anything but the agent argv from `kiroAcpArgv`; `io` is for tests. */
export async function run(ctx: SpikeContext, io: Q4Io = {}): Promise<SpikeOutcome> {
  const home = io.home ?? homedir();
  const command = io.command ?? "kiro-cli";
  const repoRoot = io.repoRoot ?? DEFAULT_REPO_ROOT;
  const placement = io.placement ?? readQ43Placement(repoRoot);
  const notes: string[] = [];
  if (placement === "unknown")
    notes.push("no Q43 evidence found; the scratch placement is assumed");
  if (placement === "none")
    notes.push("Q43 failed: launched without `--agent`, so the profile is not selected");

  const profile = buildKiroProfile({ q: "q4", prompt: PROFILE_PROMPT });
  assertSafeProfile(profile);
  const kind = placement === "home" ? "home" : "scratch";
  if (kind === "home" && !ctx.allowHomeProfile) {
    return pending(HOME_PENDING_REASON, [...notes, HOME_PENDING_NOTE], ["HS-S6"]);
  }
  const path = profilePlacement("q4", ctx.scratch, kind, home).path;
  if (kind === "home") {
    ctx.humanStep(
      "HS-S6",
      "Q4 writes one new file, wraith-spike-q4.json, into your ~/.kiro/agents/ and deletes it afterwards. Nothing else there is touched.",
    );
  }

  const rawLog = join(ctx.root, "q4.jsonl");
  const asked: { req: PermissionRequest; answer: PermissionAnswer | null }[] = [];
  const toolStatus: string[] = [];
  let calls: string[] = [];
  let stopReason: string | null = null;
  let error: string | null = null;
  let promptsSent = 0;
  let partial: string | null = null;
  let notFound = false;

  try {
    recordInMarker(ctx, (m) => writeProfileFile("q4", profile, path, m));
    const acp = startRawAcp({
      argv: kiroAcpArgv(command, "q4", placement),
      cwd: ctx.scratch,
      env: ctx.env("agent"),
      maxPrompts: ctx.meta.maxPrompts,
      killAfterMs: ctx.meta.maxWallSeconds * 1000,
      root: ctx.root,
      rawLog,
    });
    acp.onPermission(async (req: PermissionRequest) => {
      const entry: { req: PermissionRequest; answer: PermissionAnswer | null } = {
        req,
        answer: null,
      };
      asked.push(entry);
      entry.answer = await ctx.approval(req);
      return entry.answer;
    });
    acp.onUpdate((u) => {
      if (isObject(u) && u.sessionUpdate === "tool_call_update" && typeof u.status === "string") {
        toolStatus.push(u.status);
      }
    });
    try {
      await acp.initialize({ terminal: true });
      const created = await acp.newSession(ctx.scratch);
      stopReason = (await acp.prompt(created.sessionId, PROBE_PROMPT)).stopReason;
    } catch (e) {
      error = errorMessage(e);
      notFound = /ENOENT/.test(error);
    } finally {
      promptsSent = acp.promptsSent();
      partial = acp.partialReason();
      calls = terminalCalls(acp.frames());
      await acp.close();
    }
  } catch (e) {
    error = errorMessage(e);
  } finally {
    // The scratch file sits under the Spike_Root; a home file is removed here and by cleanup.
    if (kind === "home") rmSync(path, { force: true });
  }

  if (notFound) return pending("kiro-cli was not found on PATH; Q4 needs it installed", notes, []);

  const first = asked[0] ?? null;
  const answer = first?.answer ?? null;
  const allowed = answer !== null && isAllow(answer);
  const timedOut = answer !== null && answer.outcome !== "selected" && answer.reason === "timeout";
  const sawCreate = calls.includes("terminal/create");
  const sawOutput = calls.includes("terminal/output");

  const criteria: CriterionRecord[] = [
    {
      id: "q4-owner-selection",
      ok: allowed,
      observed: `permission requests: ${asked.length}, owner answer: ${answer === null ? "none" : answer.outcome}`,
    },
    {
      id: "q4-terminal-create",
      ok: sawCreate,
      observed: `terminal/create requests: ${calls.filter((c) => c === "terminal/create").length}`,
    },
    {
      id: "q4-terminal-output",
      ok: sawOutput,
      observed: `terminal/output requests: ${calls.filter((c) => c === "terminal/output").length}, tool updates: ${toolStatus.join(", ") || "none"}, stopReason ${stopReason ?? "none"}`,
    },
  ];
  notes.push("terminal/* requests were answered with an error and ran nothing");
  if (error !== null) notes.push(`run error: ${error}`);

  const outcome: SpikeOutcome = {
    result: "FAIL",
    criteria,
    affects: [],
    openHumanSteps: [],
    promptsSent,
    notes,
  };
  if (sawCreate && sawOutput) {
    outcome.result = "PASS";
  } else if (partial !== null) {
    outcome.result = "PARTIAL";
    outcome.reason = partial;
  } else if (timedOut) {
    outcome.result = "PARTIAL";
    outcome.reason = TIMEOUT_REASON;
  } else if (first !== null && !allowed) {
    outcome.result = "PARTIAL";
    outcome.reason =
      "the owner did not allow the tool; terminal use after an allow is not observed";
  } else {
    outcome.branch = FAIL_BRANCH;
  }

  await ctx.evidence.addJsonl("frames.jsonl", asyncFileLines([rawLog]));
  return outcome;
}
