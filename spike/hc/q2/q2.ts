// spike-meta
// id: q2
// group: A
// cost: none
// run-by: loop
// agents:
// max-prompts: 0
// max-wall-seconds: 1800
// estimate-credits: none
// claude-prompts: 0
// human: HS-S5
// depends:
// shares: none
// allow-always: never
// assumption:
// end-spike-meta

import { execFile } from "node:child_process";
import { mkdirSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { publishNamedCopy } from "../../lib/evidence.ts";
import type {
  CriterionRecord,
  ResultValue,
  SpikeContext,
  SpikeOutcome,
} from "../../lib/outcome.ts";

/** Text the owner step HS-S5 and the notes use; the loop cannot see either of these. */
export const UNOBSERVED_VISIBILITY = "Herdr.app visibility of the pane: unobserved (HS-S5)";
export const UNOBSERVED_APP_PATH = "Herdr Core app PATH comparison: unobserved (HS-S5)";

export const FAIL_BRANCH =
  "Start the sprite through an argv wrapper (`env`, `cd`) in the launch spec instead of relying on hc cwd, env or labels.";

const ENV_SENTINEL = "q2-env-ok";
const LABEL_PRIMARY = "q2=primary";
const LABEL_DECOY = "q2=decoy";
const AGENT_VAR = /^(KIRO_|ANTHROPIC_|CLAUDE_|AWS_|OPENAI_|GROK_|XAI_)/;

/** The stub the pane runs under `node -e`. One field per line so the terminal grid cannot join them. */
export const STUB_SOURCE: string = [
  'const { execFileSync } = require("node:child_process");',
  "const e = process.env;",
  "let names = [];",
  "let ok = true;",
  'try { names = execFileSync("env", ["-0"], { env: e }).toString().split("\\0").filter(Boolean).map((s) => s.split("=")[0]); } catch (x) { ok = false; }',
  'console.log("PWD=" + process.cwd());',
  'console.log("WRAITH_X=" + (e.WRAITH_X || ""));',
  'console.log("HC_TERMINAL_ID=" + (e.HC_TERMINAL_ID || ""));',
  'console.log("ENV0=" + (ok ? "yes" : "no"));',
  '(e.PATH || "").split(":").forEach((p) => console.log("PATHENTRY=" + p));',
  'names.forEach((n) => console.log("NAME=" + n));',
  'console.log("Q2-END");',
  "setTimeout(() => {}, 20000);",
].join("\n");

const IDLE_SOURCE = "setTimeout(() => {}, 20000);";

export interface StubFields {
  pwd: string;
  wraithX: string;
  terminalId: string;
  env0: boolean;
  pathEntries: string[];
  names: string[];
  complete: boolean;
}

/** Reads the stub's lines out of plain pane text. Unknown lines are ignored. */
export function parseStubOutput(text: string): StubFields {
  const out: StubFields = {
    pwd: "",
    wraithX: "",
    terminalId: "",
    env0: false,
    pathEntries: [],
    names: [],
    complete: false,
  };
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "").trimEnd();
    if (line === "Q2-END") out.complete = true;
    else if (line.startsWith("PWD=")) out.pwd = line.slice(4);
    else if (line.startsWith("WRAITH_X=")) out.wraithX = line.slice(9);
    else if (line.startsWith("HC_TERMINAL_ID=")) out.terminalId = line.slice(15);
    else if (line.startsWith("ENV0=")) out.env0 = line.slice(5) === "yes";
    else if (line.startsWith("PATHENTRY=")) out.pathEntries.push(line.slice(10));
    else if (line.startsWith("NAME=")) out.names.push(line.slice(5));
  }
  return out;
}

/** First terminal address (`t<N>`) in `hc run` output, or null. */
export function parseTerminalAddress(text: string): string | null {
  return /(?<![A-Za-z0-9_])t\d+(?![A-Za-z0-9_])/.exec(text)?.[0] ?? null;
}

/** `HC_*` and `HERDR_*` names a pane exports, sorted and unique. */
export function paneHcNames(names: readonly string[]): string[] {
  return [...new Set(names.filter((n) => n.startsWith("HC_") || n.startsWith("HERDR_")))].sort();
}

/** The address check: `get t<N>` must return the terminal at that address, never the one named `t<N>`. */
export function addressWins(getOutput: string): boolean {
  return getOutput.includes(LABEL_PRIMARY) && !getOutput.includes(LABEL_DECOY);
}

/** True when `text` names the terminal address `addr` as a whole token. */
export function mentionsAddress(text: string, addr: string): boolean {
  return new RegExp(`(?<![A-Za-z0-9_])${addr}(?![A-Za-z0-9_])`).test(text);
}

export interface PathCompare {
  samePath: boolean;
  onlyInPane: string[];
  onlyInLogin: string[];
  namesOnlyInPane: string[];
  namesOnlyInLogin: string[];
  agentNamesPane: string[];
  agentNamesLogin: string[];
}

function minus(a: readonly string[], b: readonly string[]): string[] {
  const s = new Set(b);
  return [...new Set(a.filter((x) => !s.has(x)))];
}

/** Compares PATH entries, and variable NAMES only for every other variable. */
export function comparePaneToLogin(
  pane: { pathEntries: string[]; names: string[] },
  login: { pathEntries: string[]; names: string[] },
): PathCompare {
  const paneNames = pane.names.filter((n) => n !== "PATH");
  const loginNames = login.names.filter((n) => n !== "PATH");
  const onlyInPane = minus(pane.pathEntries, login.pathEntries);
  const onlyInLogin = minus(login.pathEntries, pane.pathEntries);
  return {
    samePath:
      onlyInPane.length === 0 &&
      onlyInLogin.length === 0 &&
      pane.pathEntries.length === login.pathEntries.length,
    onlyInPane,
    onlyInLogin,
    namesOnlyInPane: minus(paneNames, loginNames).sort(),
    namesOnlyInLogin: minus(loginNames, paneNames).sort(),
    agentNamesPane: paneNames.filter((n) => AGENT_VAR.test(n)).sort(),
    agentNamesLogin: loginNames.filter((n) => AGENT_VAR.test(n)).sort(),
  };
}

export interface Q2Facts {
  schema: boolean;
  cwd: boolean;
  env: boolean;
  labels: boolean;
  terminalId: boolean;
  addressWins: boolean;
  env0: boolean;
}

/**
 * PASS when cwd, env, labels and `HC_TERMINAL_ID` all apply and the side checks hold;
 * PARTIAL when only a side check (schema, address, `env -0`) is missing; FAIL otherwise.
 */
export function judgeQ2(f: Q2Facts): Pick<SpikeOutcome, "result" | "reason" | "branch"> {
  const core = f.cwd && f.env && f.labels && f.terminalId;
  if (!core) {
    const missing = (["cwd", "env", "labels", "terminalId"] as const).filter((k) => !f[k]);
    return {
      result: "FAIL",
      reason: `not applied by hc: ${missing.join(", ")}`,
      branch: FAIL_BRANCH,
    };
  }
  const side = (["schema", "addressWins", "env0"] as const).filter((k) => !f[k]);
  if (side.length > 0) {
    return { result: "PARTIAL", reason: `core checks passed; not shown: ${side.join(", ")}` };
  }
  return { result: "PASS" };
}

export interface LoginEnv {
  pathEntries: string[];
  names: string[];
}

export interface Q2Deps {
  sleep?: (ms: number) => Promise<void>;
  /** Names and PATH of a login shell, or null when it cannot be read. */
  loginEnv?: (ctx: SpikeContext) => Promise<LoginEnv | null>;
  /** Repo root that receives `spike/hc/schema.json`. */
  repoRoot?: string;
  /** Poll count and delay for pane reads. */
  polls?: number;
  pollMs?: number;
}

const DEFAULT_REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function defaultLoginEnv(ctx: SpikeContext): Promise<LoginEnv | null> {
  const shell = process.env.SHELL ?? "/bin/sh";
  return new Promise((done) => {
    execFile(
      shell,
      ["-l", "-c", "env -0"],
      { env: ctx.env("tool"), timeout: 10_000, encoding: "buffer", maxBuffer: 1 << 20 },
      (err, stdout) => {
        if (err) {
          done(null);
          return;
        }
        const pairs = stdout
          .toString("utf8")
          .split("\0")
          .filter((s) => s !== "");
        const names = pairs.map((s) => s.split("=")[0] ?? "");
        const pathPair = pairs.find((s) => s.startsWith("PATH="));
        done({ pathEntries: pathPair ? pathPair.slice(5).split(":") : [], names });
      },
    );
  });
}

function formatCompare(c: PathCompare | null, hcNames: string[], login: LoginEnv | null): string {
  const lines: string[] = [];
  lines.push("# Names only for every variable other than PATH. Values are never written.");
  lines.push(`hc-exported-names: ${hcNames.join(", ") || "(none)"}`);
  if (c === null || login === null) {
    lines.push("login-shell: unavailable, nothing to compare");
  } else {
    lines.push(`path-same: ${c.samePath ? "yes" : "no"}`);
    lines.push(`path-only-in-pane: ${c.onlyInPane.join(":") || "(none)"}`);
    lines.push(`path-only-in-login: ${c.onlyInLogin.join(":") || "(none)"}`);
    lines.push(`names-only-in-pane: ${c.namesOnlyInPane.join(", ") || "(none)"}`);
    lines.push(`names-only-in-login: ${c.namesOnlyInLogin.join(", ") || "(none)"}`);
    lines.push(`agent-names-pane: ${c.agentNamesPane.join(", ") || "(none)"}`);
    lines.push(`agent-names-login: ${c.agentNamesLogin.join(", ") || "(none)"}`);
  }
  lines.push(UNOBSERVED_APP_PATH);
  lines.push(UNOBSERVED_VISIBILITY);
  return `${lines.join("\n")}\n`;
}

export async function run(ctx: SpikeContext, deps: Q2Deps = {}): Promise<SpikeOutcome> {
  const hc = ctx.hc;
  if (hc === null) throw new Error("q2 needs ctx.hc");
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const polls = deps.polls ?? 20;
  const pollMs = deps.pollMs ?? 500;

  ctx.humanStep(
    "HS-S5",
    "Open Herdr.app and note whether the Q2 pane shows there, and whether Herdr Core app's PATH differs from your login shell's. The loop cannot observe either.",
  );

  const started = await hc.run(["server", "start"]);
  if (started.code !== 0) throw new Error("q2: hc server start failed");
  const status = await hc.run(["server", "status"]);
  if (status.code !== 0) throw new Error("q2: hc server status failed");

  // 1. Schema.
  const schema = await hc.run(["schema"]);
  let schemaOk = false;
  if (schema.code === 0) {
    try {
      schemaOk = JSON.parse(schema.stdout) !== null;
    } catch {
      schemaOk = false;
    }
  }
  await ctx.evidence.addText("schema.json", schema.stdout);

  // 2. Primary stub with cwd, env and labels.
  const cwdDir = join(ctx.scratch, "q2-cwd");
  mkdirSync(cwdDir, { recursive: true });
  const cwdReal = realpathSync(cwdDir);
  const runA = await hc.run([
    "run",
    "--cwd",
    cwdDir,
    "--env",
    `WRAITH_X=${ENV_SENTINEL}`,
    "--label",
    LABEL_PRIMARY,
    "--",
    process.execPath,
    "-e",
    STUB_SOURCE,
  ]);
  const addr = parseTerminalAddress(runA.stdout);

  // 3. Decoy terminal labelled with the primary's address as its name.
  let runB: { code: number | null; stdout: string } = { code: null, stdout: "" };
  if (addr !== null) {
    runB = await hc.run([
      "run",
      "--label",
      `name=${addr}`,
      "--label",
      LABEL_DECOY,
      "--",
      process.execPath,
      "-e",
      IDLE_SOURCE,
    ]);
  }

  // 4. Read the stub's output.
  let paneText = "";
  if (addr !== null) {
    for (let i = 0; i < polls; i++) {
      const r = await hc.run(["read", addr]);
      paneText = r.stdout;
      if (r.code === 0 && parseStubOutput(paneText).complete) break;
      await sleep(pollMs);
    }
  }
  const stub = parseStubOutput(paneText);
  await ctx.evidence.addText("run-output.txt", paneText);

  // 5. Labels filter and address lookup.
  const ls = await hc.run(["ls", "--label", LABEL_PRIMARY]);
  await ctx.evidence.addText("ls.json", ls.stdout);
  const decoyAddr = parseTerminalAddress(runB.stdout);
  const lsOk =
    addr !== null &&
    ls.code === 0 &&
    mentionsAddress(ls.stdout, addr) &&
    (decoyAddr === null || !mentionsAddress(ls.stdout, decoyAddr));
  const got = addr === null ? null : await hc.run(["get", addr]);
  await ctx.evidence.addText("get-address.json", got?.stdout ?? "");
  const addressOk = got !== null && got.code === 0 && addressWins(got.stdout);

  // 6. Pane versus login shell.
  const login = await (deps.loginEnv ?? defaultLoginEnv)(ctx);
  const compare = login === null ? null : comparePaneToLogin(stub, login);
  const hcNames = paneHcNames(stub.names);
  await ctx.evidence.addText("env-compare.txt", formatCompare(compare, hcNames, login));

  const facts: Q2Facts = {
    schema: schemaOk,
    cwd: stub.pwd !== "" && (stub.pwd === cwdDir || stub.pwd === cwdReal),
    env: stub.wraithX === ENV_SENTINEL,
    labels: lsOk,
    terminalId:
      stub.terminalId !== "" && (addr === null || stub.terminalId.includes(addr.slice(1))),
    addressWins: addressOk,
    env0: stub.env0,
  };
  const verdict = judgeQ2(facts);

  const criteria: CriterionRecord[] = [
    {
      id: "schema",
      ok: facts.schema,
      observed: `hc schema exit ${String(schema.code)}, JSON ${schemaOk ? "parsed" : "not parsed"}`,
    },
    { id: "cwd", ok: facts.cwd, observed: `pane cwd ${stub.pwd || "(none)"}` },
    { id: "env", ok: facts.env, observed: `WRAITH_X ${facts.env ? "applied" : "not applied"}` },
    {
      id: "labels",
      ok: facts.labels,
      observed: `ls with a labels filter ${facts.labels ? "kept only the primary" : "did not isolate the primary"}`,
    },
    {
      id: "terminal-id",
      ok: facts.terminalId,
      observed: `HC_TERMINAL_ID ${stub.terminalId ? "set" : "not set"}`,
    },
    {
      id: "address-wins",
      ok: facts.addressWins,
      observed: `get ${addr ?? "(no address)"} with a same-named terminal present: ${facts.addressWins ? "address resolved" : "not proven"}`,
    },
    {
      id: "env-0",
      ok: facts.env0,
      observed: `env -0 ${facts.env0 ? "available" : "not shown"} inside a pane`,
    },
    {
      id: "hc-names",
      ok: stub.terminalId !== "",
      observed: `exported HC_/HERDR_ names: ${hcNames.join(", ") || "(none)"}`,
    },
  ];

  const outcome: SpikeOutcome = {
    result: verdict.result as ResultValue,
    criteria,
    affects: ["S-node-core", "S-sprite-acp"],
    openHumanSteps: ["HS-S5"],
    promptsSent: 0,
    notes: [UNOBSERVED_VISIBILITY, UNOBSERVED_APP_PATH],
  };
  if (verdict.reason !== undefined) outcome.reason = verdict.reason;
  if (verdict.branch !== undefined) outcome.branch = verdict.branch;

  // The named copy exists only for PASS or PARTIAL (D8).
  const copied = publishNamedCopy("q2", join(ctx.evidence.dir, "schema.json"), {
    repoRoot: deps.repoRoot ?? DEFAULT_REPO_ROOT,
    result: outcome.result,
  });
  outcome.notes.push(copied ? "named copy written: spike/hc/schema.json" : "no named copy written");
  return outcome;
}
