// spike-meta
// id: q11
// group: B
// cost: low
// run-by: owner
// agents: kiro
// max-prompts: 3
// max-wall-seconds: 1800
// estimate-credits: 2-6
// claude-prompts: 0
// human: HS-S2, HS-S3
// depends: q43, q3
// shares: none
// allow-always: never
// assumption: A1 Estimate
// end-spike-meta
import { randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type McpServerConfig, startRawAcp } from "../../lib/acp-echo.ts";
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
import { MCP_TOKEN_HEADER, startMcpEcho } from "../../lib/mcp-echo.ts";
import type { CriterionRecord, SpikeContext, SpikeOutcome } from "../../lib/outcome.ts";

/**
 * Q11 asks whether `kiro-cli acp` accepts an HTTP `mcpServers` entry in `session/new` and calls
 * a tool on it. The local echo server needs a token header. Every permission request goes to the
 * owner; nothing here answers one by itself.
 */
export const AGENT_NAME = "wraith-spike-q11";
export const SERVER_NAME = "wraith-spike-echo";
export const PROFILE_PROMPT = "You are a throwaway Wraith spike agent. Do only what the user asks.";
export const PROBE_PROMPT =
  'Call the `echo` tool of the MCP server named "wraith-spike-echo" once with the text "hi", and tell me what it returned.';
export const FAIL_BRANCH =
  "stdio shim `wraith-mcp-stdio` (an HTTP `mcpServers` entry did not reach the echo server)";
export const FAIL_NOTE =
  "A FAIL may be the echo server's fault, not Kiro's: it replies with plain JSON, never SSE, and implements only initialize, tools/list and tools/call. Check the raw frames for an MCP error from the agent; if one points at the handshake, re-run with a permissive-licensed MCP SDK server before choosing the shim.";
export const HOME_PENDING_REASON = "Q43 placed the profile in ~/.kiro/agents/; HS-S6 open";
export const HOME_PENDING_NOTE =
  "Nothing was written to ~/.kiro/agents/. To allow one new file there (HS-S6), re-run: pnpm spike q11 --allow-home-profile";

export interface Q11Io {
  /** Replaces `os.homedir()`; tests point it at a temp folder. */
  home?: string;
  /** The agent binary; default `kiro-cli`. */
  command?: string;
  /** Repo root that holds the Q43 evidence. */
  repoRoot?: string;
  /** Replaces the Q43 evidence lookup. */
  placement?: Q43Placement;
  /** Header name put in the `mcpServers` entry; tests use a wrong one to see a rejected call. */
  headerName?: string;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The `mcpCapabilities` object of an `initialize` result, wherever the agent put it. */
export function readMcpCapabilities(init: unknown): Record<string, unknown> | null {
  if (!isObject(init)) return null;
  const caps = isObject(init.agentCapabilities) ? init.agentCapabilities : init;
  return isObject(caps.mcpCapabilities) ? caps.mcpCapabilities : null;
}

/** Replaces the token in log lines, so the evidence never holds it. */
export async function* withoutToken(
  lines: AsyncIterable<string>,
  token: string,
): AsyncGenerator<string> {
  for await (const l of lines) yield token === "" ? l : l.split(token).join("[spike-token]");
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
export async function run(ctx: SpikeContext, io: Q11Io = {}): Promise<SpikeOutcome> {
  const home = io.home ?? homedir();
  const command = io.command ?? "kiro-cli";
  const repoRoot = io.repoRoot ?? DEFAULT_REPO_ROOT;
  const placement = io.placement ?? readQ43Placement(repoRoot);
  const notes: string[] = [];
  if (placement === "unknown")
    notes.push("no Q43 evidence found; the scratch placement is assumed");
  if (placement === "none")
    notes.push("Q43 failed: launched without `--agent`, so the profile is not selected");

  const profile = buildKiroProfile({ q: "q11", prompt: PROFILE_PROMPT });
  assertSafeProfile(profile);
  const kind = placement === "home" ? "home" : "scratch";
  if (kind === "home" && !ctx.allowHomeProfile) {
    return pending(HOME_PENDING_REASON, [...notes, HOME_PENDING_NOTE], ["HS-S6"]);
  }
  const path = profilePlacement("q11", ctx.scratch, kind, home).path;
  if (kind === "home") {
    ctx.humanStep(
      "HS-S6",
      "Q11 writes one new file, wraith-spike-q11.json, into your ~/.kiro/agents/ and deletes it afterwards. Nothing else there is touched.",
    );
  }

  const token = randomBytes(24).toString("hex");
  const rawLog = join(ctx.root, "q11.jsonl");
  let capabilities: Record<string, unknown> | null = null;
  let permissions = 0;
  let sessionId: string | null = null;
  let stopReason: string | null = null;
  let error: string | null = null;
  let promptsSent = 0;
  let partial: string | null = null;
  let notFound = false;
  let calls: { tool: string; headerPresent: boolean }[] = [];

  const echo = await startMcpEcho({ token });
  try {
    const server: McpServerConfig = {
      type: "http",
      name: SERVER_NAME,
      url: echo.url,
      headers: [{ name: io.headerName ?? MCP_TOKEN_HEADER, value: token }],
    };
    try {
      recordInMarker(ctx, (m) => writeProfileFile("q11", profile, path, m));
      const acp = startRawAcp({
        argv: kiroAcpArgv(command, "q11", placement),
        cwd: ctx.scratch,
        env: ctx.env("agent"),
        maxPrompts: ctx.meta.maxPrompts,
        killAfterMs: ctx.meta.maxWallSeconds * 1000,
        root: ctx.root,
        rawLog,
      });
      acp.onPermission(async (req: PermissionRequest): Promise<PermissionAnswer> => {
        permissions++;
        return ctx.approval(req);
      });
      try {
        capabilities = readMcpCapabilities(await acp.initialize({}));
        const created = await acp.newSession(ctx.scratch, [server]);
        sessionId = created.sessionId;
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
    calls = echo.calls();
  } finally {
    await echo.close();
  }

  if (notFound) return pending("kiro-cli was not found on PATH; Q11 needs it installed", notes, []);

  const fromAgent = calls.filter((c) => c.headerPresent && c.tool === "echo");
  const criteria: CriterionRecord[] = [
    {
      id: "q11-mcp-capabilities",
      ok: capabilities !== null && capabilities.http === true,
      observed: `mcpCapabilities: ${capabilities === null ? "absent" : JSON.stringify(capabilities)}`,
    },
    {
      id: "q11-session-new",
      ok: sessionId !== null,
      observed:
        sessionId !== null
          ? "session/new accepted the http mcpServers entry"
          : "session/new did not return a session",
    },
    {
      id: "q11-echo-called",
      ok: fromAgent.length > 0,
      observed: `echo server calls: ${calls.length}, echo tool calls with the token header: ${fromAgent.length}`,
    },
  ];
  if (error !== null) notes.push(`run error: ${error}`);
  notes.push(`permission requests answered by the owner: ${permissions}`);
  notes.push(`stopReason: ${stopReason ?? "none"}`);

  const outcome: SpikeOutcome = {
    result: "FAIL",
    criteria,
    affects: [],
    openHumanSteps: [],
    promptsSent,
    notes,
  };
  if (fromAgent.length > 0) {
    outcome.result = "PASS";
  } else if (partial !== null) {
    outcome.result = "PARTIAL";
    outcome.reason = partial;
  } else {
    outcome.branch = FAIL_BRANCH;
    notes.push(FAIL_NOTE);
  }

  await ctx.evidence.addJsonl("frames.jsonl", withoutToken(asyncFileLines([rawLog]), token));
  await ctx.evidence.addText(
    "mcp-calls.json",
    `${JSON.stringify({ capabilities, calls }, null, 2)}\n`,
  );
  return outcome;
}
