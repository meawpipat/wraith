// spike-meta
// id: q30
// group: I
// cost: low
// run-by: owner
// agents: kiro
// max-prompts: 2
// max-wall-seconds: 1200
// estimate-credits: 2-4
// claude-prompts: 0
// human: HS-S2
// depends: q43
// shares: none
// allow-always: never
// assumption: A1 Estimate
// end-spike-meta
import { execFile, spawn } from "node:child_process";
import { appendFileSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { assertAcpInput, startRawAcp } from "../../lib/acp-echo.ts";
import type { PermissionRequest } from "../../lib/approval.ts";
import { asyncFileLines, errorMessage, kiroAcpArgv } from "../../lib/kiro-spike.ts";
import type { CriterionRecord, SpikeContext, SpikeOutcome } from "../../lib/outcome.ts";

/**
 * Q30 asks whether Kiro lists a session again, from the same cwd, after the agent process ended:
 * through ACP `session/list` and through `kiro-cli chat --list-sessions`. The first process
 * sends one harmless prompt (a session with no turn may not be stored); the listing needs none.
 * No agent profile is written, so nothing outside the Spike_Root is touched (HS-S6 stays closed).
 * The ACP listing and the CLI listing are local helpers here; `lib/kiro-spike.ts` is not edited.
 */
export const PROBE_PROMPT = "Reply with the single word OK. Do not use any tools.";
export const FAIL_BRANCH = "rely only on the node's `workspaces` table";
export const LIST_TIMEOUT_MS = 60_000;
export const OUTSIDE_ROOT_REASON =
  "the scratch folder is not inside the Spike_Root; Q30 refuses to run";

export interface Q30Io {
  /** The agent binary; default `kiro-cli`. */
  command?: string;
}

export type ListStatus = "listed" | "absent" | "unsupported" | "error";

export interface ListResult {
  status: ListStatus;
  detail: string;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function samePath(a: string, b: string): boolean {
  const norm = (p: string): string => {
    try {
      return realpathSync(p);
    } catch {
      return p;
    }
  };
  return norm(a) === norm(b);
}

/** True when `child` is `root` or below it. */
export function isInside(root: string, child: string): boolean {
  const rel = relative(root, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** Reads a `session/list` result: `listed` only when the id appears with this cwd. */
export function judgeAcpList(result: unknown, sessionId: string, cwd: string): ListResult {
  const sessions = isObject(result) && Array.isArray(result.sessions) ? result.sessions : null;
  if (sessions === null) return { status: "error", detail: "the result has no sessions array" };
  const same = sessions.filter((s) => isObject(s) && s.sessionId === sessionId);
  if (same.length === 0) {
    return { status: "absent", detail: `${sessions.length} session(s) listed, the id is not one` };
  }
  const forCwd = same.some((s) => isObject(s) && typeof s.cwd === "string" && samePath(s.cwd, cwd));
  return forCwd
    ? { status: "listed", detail: "the id is listed for the scratch cwd" }
    : { status: "absent", detail: "the id is listed, but not for the scratch cwd" };
}

/** `--list-sessions` runs from the scratch cwd, so the id in its output counts for that cwd. */
export function judgeCliList(output: string, sessionId: string): ListResult {
  return output.includes(sessionId)
    ? { status: "listed", detail: "the id appears in the output" }
    : { status: "absent", detail: "the id does not appear in the output" };
}

/** PASS when either way lists the id for the cwd; otherwise FAIL with the branch. */
export function judgeQ30(acp: ListResult, cli: ListResult): "PASS" | "FAIL" {
  return acp.status === "listed" || cli.status === "listed" ? "PASS" : "FAIL";
}

/** `HC_*`, `HERDR_*` and `XDG_*` never reach the agent (same rule as the acp-echo client). */
function cleanEnv(env: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (/^(HC_|HERDR_|XDG_)/.test(k)) continue;
    out[k] = v;
  }
  return out;
}

interface RpcInput {
  argv: string[];
  cwd: string;
  env: Record<string, string>;
  root: string;
  rawLog: string;
  timeoutMs: number;
}

/**
 * A second, short agent process that only calls `initialize` and `session/list` (no prompt).
 * Returns the raw `session/list` result, or an `unsupported` / `error` status.
 */
export function listViaAcp(
  i: RpcInput,
  sessionId: string,
): Promise<{ list: ListResult; result: unknown }> {
  assertAcpInput({
    argv: i.argv,
    cwd: i.cwd,
    env: i.env,
    maxPrompts: 0,
    killAfterMs: i.timeoutMs,
    root: i.root,
    rawLog: i.rawLog,
  });
  mkdirSync(dirname(i.rawLog), { recursive: true });
  const [command, ...args] = i.argv as [string, ...string[]];
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: i.cwd,
      env: cleanEnv(i.env),
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let done = false;
    let buffer = "";
    const pages: unknown[] = [];
    const finish = (list: ListResult, result: unknown): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.stdin.end();
      setTimeout(() => child.kill("SIGKILL"), 1000).unref();
      resolve({ list, result });
    };
    const log = (dir: string, msg: unknown): void => {
      appendFileSync(i.rawLog, `${JSON.stringify({ t: Date.now(), dir, msg })}\n`);
    };
    const send = (msg: Record<string, unknown>): void => {
      log("c2a", msg);
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...msg })}\n`);
    };
    const timer = setTimeout(
      () => finish({ status: "error", detail: "the listing timed out" }, null),
      i.timeoutMs,
    );
    timer.unref();
    child.stdin.on("error", () => {});
    child.stderr.resume();
    child.once("error", (e) =>
      finish({ status: "error", detail: `could not start: ${errorMessage(e)}` }, null),
    );
    child.once("close", () =>
      finish({ status: "error", detail: "the agent closed before answering" }, null),
    );
    const askPage = (cursor: string | null): void => {
      send({
        id: 2 + pages.length,
        method: "session/list",
        params: cursor === null ? { cwd: i.cwd } : { cwd: i.cwd, cursor },
      });
    };
    const onMessage = (msg: unknown): void => {
      if (!isObject(msg)) return;
      if (typeof msg.method === "string") {
        if (msg.id !== undefined) {
          send({ id: msg.id, error: { code: -32601, message: `not implemented: ${msg.method}` } });
        }
        return;
      }
      if (msg.id === 1) {
        if (isObject(msg.error)) {
          finish({ status: "error", detail: "initialize failed" }, null);
        } else {
          askPage(null);
        }
        return;
      }
      if (typeof msg.id !== "number" || msg.id < 2) return;
      if (isObject(msg.error)) {
        const unsupported = msg.error.code === -32601;
        finish(
          {
            status: unsupported ? "unsupported" : "error",
            detail: unsupported
              ? "session/list is not implemented"
              : "session/list returned an error",
          },
          null,
        );
        return;
      }
      pages.push(msg.result);
      const found = judgeAcpList(msg.result, sessionId, i.cwd);
      const next = isObject(msg.result) ? msg.result.nextCursor : undefined;
      if (found.status === "listed" || typeof next !== "string" || pages.length >= 5) {
        finish(found, pages.length === 1 ? pages[0] : pages);
        return;
      }
      askPage(next);
    };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      let at = buffer.indexOf("\n");
      while (at >= 0) {
        const line = buffer.slice(0, at).trim();
        buffer = buffer.slice(at + 1);
        if (line !== "") {
          try {
            const msg: unknown = JSON.parse(line);
            log("a2c", msg);
            onMessage(msg);
          } catch {
            log("a2c", { nonJson: line.slice(0, 200) });
          }
        }
        at = buffer.indexOf("\n");
      }
    });
    send({ id: 1, method: "initialize", params: { protocolVersion: 1, clientCapabilities: {} } });
  });
}

interface CliOut {
  output: string;
  notFound: boolean;
  error: string | null;
}

function listViaCli(command: string, cwd: string, env: Record<string, string>): Promise<CliOut> {
  return new Promise((resolve) => {
    execFile(
      command,
      ["chat", "--list-sessions"],
      { cwd, env: cleanEnv(env), timeout: LIST_TIMEOUT_MS, maxBuffer: 1024 * 1024, shell: false },
      (error, stdout, stderr) => {
        const text = `${stdout}${stderr === "" ? "" : `\n${stderr}`}`;
        const code = error !== null ? (error as NodeJS.ErrnoException).code : undefined;
        resolve({
          output: text,
          notFound: code === "ENOENT",
          error: error === null ? null : errorMessage(error),
        });
      },
    );
  });
}

function pending(reason: string, notes: string[], promptsSent = 0): SpikeOutcome {
  return {
    result: "pending",
    reason,
    criteria: [],
    affects: [],
    openHumanSteps: [],
    promptsSent,
    notes,
  };
}

/** Starts only `kiro-cli acp` and `kiro-cli chat --list-sessions`; `io` is for tests. */
export async function run(ctx: SpikeContext, io: Q30Io = {}): Promise<SpikeOutcome> {
  const command = io.command ?? "kiro-cli";
  const notes: string[] = [];
  if (!isInside(ctx.root, ctx.scratch)) return pending(OUTSIDE_ROOT_REASON, notes);

  const argv = kiroAcpArgv(command, "q30", "none");
  const rawLog = join(ctx.root, "q30.jsonl");
  const listLog = join(ctx.root, "q30-list.jsonl");
  const deadline = Date.now() + ctx.meta.maxWallSeconds * 1000;

  let sessionId: string | null = null;
  let stopReason: string | null = null;
  let error: string | null = null;
  let promptsSent = 0;
  let partial: string | null = null;
  let notFound = false;
  const requests: string[] = [];

  const acp = startRawAcp({
    argv,
    cwd: ctx.scratch,
    env: ctx.env("agent"),
    maxPrompts: ctx.meta.maxPrompts,
    killAfterMs: ctx.meta.maxWallSeconds * 1000,
    root: ctx.root,
    rawLog,
  });
  acp.onPermission(async (req: PermissionRequest) => {
    requests.push(req.tool);
    return ctx.approval(req);
  });
  try {
    await acp.initialize({});
    const created = await acp.newSession(ctx.scratch);
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

  if (notFound) return pending("kiro-cli was not found on PATH; Q30 needs it installed", notes);
  if (sessionId === null) {
    notes.push(`run error: ${error ?? "no session"}`);
    return pending("no session was created, so there is nothing to list", notes, promptsSent);
  }
  await ctx.evidence.addText(
    "session.json",
    `${JSON.stringify({ sessionId, cwd: ctx.scratch, stopReason }, null, 2)}\n`,
  );
  if (error !== null) notes.push(`prompt error (the session still exists): ${error}`);
  if (requests.length > 0) notes.push(`permission requests during the probe: ${requests.length}`);

  // The first agent process has ended (close() waited for it). List from the same cwd.
  const left = Math.max(1000, Math.min(LIST_TIMEOUT_MS, deadline - Date.now()));
  const viaAcp = await listViaAcp(
    {
      argv,
      cwd: ctx.scratch,
      env: ctx.env("agent"),
      root: ctx.root,
      rawLog: listLog,
      timeoutMs: left,
    },
    sessionId,
  );
  const cliRaw = await listViaCli(command, ctx.scratch, ctx.env("agent"));
  const viaCli: ListResult = cliRaw.notFound
    ? { status: "error", detail: "kiro-cli was not found" }
    : cliRaw.error !== null && cliRaw.output.trim() === ""
      ? { status: "error", detail: `chat --list-sessions failed: ${cliRaw.error}` }
      : judgeCliList(cliRaw.output, sessionId);

  await ctx.evidence.addText(
    "acp-list.json",
    `${JSON.stringify({ status: viaAcp.list.status, detail: viaAcp.list.detail, result: viaAcp.result }, null, 2)}\n`,
  );
  await ctx.evidence.addText(
    "cli-list.txt",
    cliRaw.output === "" ? "(no output)\n" : cliRaw.output,
  );
  await ctx.evidence.addJsonl("frames.jsonl", asyncFileLines([rawLog, listLog]));

  const criteria: CriterionRecord[] = [
    {
      id: "q30-acp-session-list",
      ok: viaAcp.list.status === "listed",
      observed: `${viaAcp.list.status}: ${viaAcp.list.detail}`,
    },
    {
      id: "q30-cli-list-sessions",
      ok: viaCli.status === "listed",
      observed: `${viaCli.status}: ${viaCli.detail}`,
    },
  ];
  const verdict = judgeQ30(viaAcp.list, viaCli);
  const outcome: SpikeOutcome = {
    result: verdict,
    criteria,
    affects: [],
    openHumanSteps: [],
    promptsSent,
    notes,
  };
  if (partial !== null && verdict !== "PASS") {
    outcome.result = "PARTIAL";
    outcome.reason = partial;
  } else if (verdict === "FAIL") {
    outcome.branch = FAIL_BRANCH;
  }
  return outcome;
}
