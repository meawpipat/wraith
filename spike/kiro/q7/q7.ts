// spike-meta
// id: q7
// group: B
// cost: none
// run-by: loop
// agents:
// max-prompts: 0
// max-wall-seconds: 300
// estimate-credits: none
// claude-prompts: 0
// human:
// depends: none
// shares: none
// allow-always: never
// assumption:
// end-spike-meta
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import type { CriterionRecord, SpikeContext, SpikeOutcome } from "../../lib/outcome.ts";
import { redactText } from "../../lib/redact.ts";

/** Q7 asks whether `kiro-cli chat --list-sessions` can print JSON, so the node can list sessions. */
export const NO_JSON_BRANCH = "use ACP `session/list` only";
export const HELP_TIMEOUT_MS = 20_000;
const MAX_TEXT = 8000;
const BASE_ARGS: readonly string[] = ["chat", "--list-sessions"];

export interface RawRun {
  /** False when the binary could not be started (not found, not executable). */
  started: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
}
export type RunKiro = (args: readonly string[], env: Record<string, string>) => Promise<RawRun>;

/** Runs `kiro-cli` with an argv array, no shell. Only ever called with `--help` arguments. */
export const defaultRunKiro: RunKiro = (args, env) =>
  new Promise((resolve) => {
    execFile(
      "kiro-cli",
      [...args],
      { env, timeout: HELP_TIMEOUT_MS, maxBuffer: 1_000_000, shell: false },
      (error, stdout, stderr) => {
        const e = error as (NodeJS.ErrnoException & { code?: unknown }) | null;
        if (e !== null && (e.code === "ENOENT" || e.code === "EACCES")) {
          resolve({ started: false, code: null, stdout: "", stderr: String(e.code) });
          return;
        }
        const code = e === null ? 0 : typeof e.code === "number" ? e.code : null;
        resolve({ started: true, code, stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });

/** True when a help line names `--format` and offers `json` (R14.6). */
export function hasJsonOption(helpText: string): boolean {
  return helpText.split("\n").some((l) => /--format\b/.test(l) && /\bjson\b/i.test(l));
}

export interface Q7Verdict {
  result: "PASS" | "FAIL";
  branch?: string;
}
export function judgeQ7(plainHelp: string, jsonHelp: string): Q7Verdict {
  if (hasJsonOption(plainHelp) || hasJsonOption(jsonHelp)) return { result: "PASS" };
  return { result: "FAIL", branch: NO_JSON_BRANCH };
}

function clip(s: string): string {
  return s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}\n[clipped]` : s;
}

/** Runs the two help commands only; sends no prompt and never signs in. `runKiro` is for tests. */
export async function run(
  ctx: SpikeContext,
  runKiro: RunKiro = defaultRunKiro,
): Promise<SpikeOutcome> {
  const env = ctx.env("agent");
  const plainArgs = [...BASE_ARGS, "--help"];
  const jsonArgs = [...BASE_ARGS, "--format", "json", "--help"];
  const plain = await runKiro(plainArgs, env);
  const json = plain.started ? await runKiro(jsonArgs, env) : plain;
  const notes: string[] = [];
  if (!plain.started) {
    return {
      result: "pending",
      reason: "kiro-cli was not found on PATH; Q7 needs it installed (help only, no login)",
      criteria: [],
      affects: [],
      openHumanSteps: [],
      promptsSent: 0,
      notes,
    };
  }
  const plainText = `${plain.stdout}${plain.stderr}`;
  const jsonText = `${json.stdout}${json.stderr}`;
  const verdict = judgeQ7(plainText, jsonText);
  const criteria: CriterionRecord[] = [
    {
      id: "q7-help-runs",
      ok: plain.code === 0 && plainText.trim() !== "",
      observed: `exit ${plain.code}, ${plainText.length} chars`,
    },
    {
      id: "q7-format-json-help-runs",
      ok: json.code === 0,
      observed: `exit ${json.code}, ${jsonText.length} chars`,
    },
    {
      id: "q7-json-option-exists",
      ok: verdict.result === "PASS",
      observed: `plain=${hasJsonOption(plainText)} withFormat=${hasJsonOption(jsonText)}`,
    },
  ];
  const redactOpts = {
    file: "help.txt",
    home: homedir(),
    realHome: homedir(),
    env: process.env,
  };
  const record = (args: readonly string[], r: RawRun, text: string): string =>
    redactText(clip(`$ kiro-cli ${args.join(" ")}\nexit ${r.code}\n${text}`), redactOpts).text;
  await ctx.evidence.addText("help-plain.txt", record(plainArgs, plain, plainText));
  await ctx.evidence.addText("help-format-json.txt", record(jsonArgs, json, jsonText));
  await ctx.evidence.addText(
    "summary.json",
    `${JSON.stringify({ result: verdict.result, branch: verdict.branch ?? null }, null, 2)}\n`,
  );
  notes.push("help text only; lines with an SI token are replaced before they are written");
  const outcome: SpikeOutcome = {
    result: verdict.result,
    criteria,
    affects: [],
    openHumanSteps: [],
    promptsSent: 0,
    notes,
  };
  if (verdict.branch !== undefined) outcome.branch = verdict.branch;
  return outcome;
}
