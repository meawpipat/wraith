import { spawn } from "node:child_process";
import { buildChildEnv } from "./env.ts";
import { type OwnMarker, writeMarker } from "./own-marker.ts";

export type HcMode = "normal" | "observe";
export type HcDecision = { allow: true } | { allow: false; reason: string };

// Same pattern as SESSION_RE in preflight.ts (kept local so this module has no dependency on it).
const SESSION_PATTERN = /^wsp(-[a-z0-9]{1,8})?$/;
const VERB_PATTERN = /^[a-z][a-z0-9._-]*$/;
/** First words refused in every mode (D5). */
const ALWAYS_REFUSED: ReadonlySet<string> = new Set(["machine", "exec", "file", "update"]);
const DEFAULT_TIMEOUT_MS = 30_000;

let preflightPassed = false;

/** Called by the runner once preflight passed (R1.3). `createHc` handles refuse before that. */
export function markPreflightPassed(): void {
  preflightPassed = true;
}

/**
 * Pure and total: never throws, whatever it is given.
 * `observe` accepts exactly `["server","status"]` (D4).
 */
export function decideHc(
  args: readonly string[],
  ctx: { mode: HcMode; session: string | undefined },
): HcDecision {
  try {
    if (!Array.isArray(args) || !args.every((a) => typeof a === "string")) {
      return { allow: false, reason: "arguments must be an array of strings" };
    }
    if (ctx.mode !== "normal" && ctx.mode !== "observe") {
      return { allow: false, reason: "unknown mode" };
    }
    if (ctx.mode === "observe") {
      return args.length === 2 && args[0] === "server" && args[1] === "status"
        ? { allow: true }
        : { allow: false, reason: "observe mode runs `server status` only" };
    }
    const s = ctx.session;
    if (typeof s !== "string" || !SESSION_PATTERN.test(s) || s === "default") {
      return { allow: false, reason: "session is not a Test_Session" };
    }
    const first = args.find((a) => !a.startsWith("-"));
    if (first === undefined) return { allow: false, reason: "no command word" };
    if (!VERB_PATTERN.test(first)) {
      return { allow: false, reason: "first word is not a plain hc verb" };
    }
    if (ALWAYS_REFUSED.has(first)) {
      return { allow: false, reason: `\`${first}\` is refused in every mode` };
    }
    return { allow: true };
  } catch {
    return { allow: false, reason: "decision failed" };
  }
}

export interface HcRunOptions {
  stdin?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}
export interface HcResult {
  code: number | null;
  stdout: string;
  stderr: string;
  ms: number;
}
export interface Hc {
  run(args: readonly string[], o?: HcRunOptions): Promise<HcResult>;
  spawnLong(args: readonly string[]): { pid: number; stop(): Promise<void> };
  readonly session: string;
  readonly mode: HcMode;
}

type Env = Record<string, string>;
type Record_ = (pid: number) => void;

function build(
  mode: HcMode,
  session: string,
  env: Env,
  record: Record_,
  gate: () => string | null,
): Hc {
  const check = (args: readonly string[]): void => {
    const g = gate();
    if (g !== null) throw new Error(g);
    const d = decideHc(args, { mode, session: mode === "normal" ? session : undefined });
    if (!d.allow) throw new Error(`hc refused: ${d.reason}`);
  };
  return {
    session,
    mode,
    run(args, o = {}) {
      return new Promise<HcResult>((resolve, reject) => {
        try {
          check(args);
        } catch (err) {
          reject(err);
          return;
        }
        const t0 = Date.now();
        const child = spawn("hc", [...args], {
          env,
          shell: false,
          stdio: ["pipe", "pipe", "pipe"],
          signal: o.signal,
        });
        if (child.pid !== undefined) record(child.pid);
        let stdout = "";
        let stderr = "";
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (d: string) => {
          stdout += d;
        });
        child.stderr.on("data", (d: string) => {
          stderr += d;
        });
        const timer = setTimeout(() => child.kill("SIGKILL"), o.timeoutMs ?? DEFAULT_TIMEOUT_MS);
        child.on("error", (err) => {
          clearTimeout(timer);
          reject(err);
        });
        child.on("close", (code) => {
          clearTimeout(timer);
          resolve({ code, stdout, stderr, ms: Date.now() - t0 });
        });
        child.stdin.on("error", () => {});
        child.stdin.end(o.stdin ?? "");
      });
    },
    spawnLong(args) {
      check(args);
      const child = spawn("hc", [...args], { env, shell: false, stdio: "ignore" });
      if (child.pid === undefined) throw new Error("hc did not start");
      const pid = child.pid;
      record(pid);
      const exited = new Promise<void>((resolve) => {
        child.on("close", () => resolve());
        child.on("error", () => resolve());
      });
      return {
        pid,
        async stop() {
          if (child.exitCode !== null || child.signalCode !== null) return;
          child.kill("SIGTERM");
          const timer = setTimeout(() => child.kill("SIGKILL"), 3000);
          await exited;
          clearTimeout(timer);
        },
      };
    },
  };
}

export function createHc(i: {
  mode: "normal";
  session: string;
  root: string;
  baseEnv: NodeJS.ProcessEnv;
  marker: OwnMarker;
}): Hc {
  const env = buildChildEnv({
    base: i.baseEnv,
    profile: "hc",
    session: i.session,
    root: i.root,
  });
  const record: Record_ = (pid) => {
    if (!i.marker.pids.includes(pid)) i.marker.pids.push(pid);
    writeMarker(i.marker);
  };
  return build("normal", i.session, env, record, () =>
    preflightPassed ? null : "hc refused: preflight has not passed",
  );
}

export function createObserveHc(i: { baseEnv: NodeJS.ProcessEnv }): Hc {
  const env = buildChildEnv({ base: i.baseEnv, profile: "tool" });
  return build(
    "observe",
    "",
    env,
    () => {},
    () => null,
  );
}

/**
 * `hc --version` with the `tool` env profile and no session, so it never contacts a core.
 * Used only by `gatherPreflightInput`; not part of `decideHc`. Returns the version, or null.
 */
export function readHcVersion(baseEnv: NodeJS.ProcessEnv): Promise<string | null> {
  const env = buildChildEnv({ base: baseEnv, profile: "tool" });
  return new Promise((resolve) => {
    let out = "";
    let done = false;
    const finish = (v: string | null): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(v);
    };
    const child = spawn("hc", ["--version"], {
      env,
      shell: false,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(null);
    }, 10_000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d: string) => {
      out += d;
    });
    child.on("error", () => finish(null));
    child.on("close", (code) => {
      const m = /(\d+\.\d+\.\d+)/.exec(out);
      finish(code === 0 && m ? (m[1] ?? null) : null);
    });
  });
}
