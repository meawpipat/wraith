import { execFile } from "node:child_process";
import { lstatSync, rmSync } from "node:fs";
import { createConnection } from "node:net";
import { basename, dirname } from "node:path";
import type { Hc } from "./hc.ts";
import { type OwnMarker, pidAlive } from "./own-marker.ts";
import { isUnder } from "./preflight.ts";

/** The only places a Spike_Root may live. Tests pass their own prefixes. */
export const DEFAULT_ROOT_PREFIXES: readonly string[] = ["/tmp/hcw", "/private/tmp/hcw"];

export interface DeletePlan {
  delete: string[];
  refuse: { path: string; why: string }[];
}

export interface ChildHandle {
  pid: number;
  stop(): Promise<void>;
}

/** Absolute, no NUL, no `..` segment, no empty or relative form. */
function lexicallyOk(p: string): string | null {
  if (typeof p !== "string" || p === "") return "empty path";
  if (p.includes("\0")) return "NUL in path";
  if (!p.startsWith("/")) return "relative path";
  if (p.split("/").includes("..")) return "`..` segment";
  return null;
}

/** True when the root is strictly under one of the allowed prefixes (segment-wise). */
function rootAllowed(root: string, prefixes: readonly string[]): boolean {
  if (lexicallyOk(root) !== null) return false;
  return prefixes.some((p) => lexicallyOk(p) === null && isUnder(p, root));
}

/** Pure. A path is deleted only with a matching marker and when strictly under the marker's root. */
export function planDeletion(
  root: string,
  marker: OwnMarker | null,
  candidates: readonly string[],
  prefixes: readonly string[] = DEFAULT_ROOT_PREFIXES,
): DeletePlan {
  const plan: DeletePlan = { delete: [], refuse: [] };
  let blocked: string | null = null;
  if (marker === null) blocked = "no marker";
  else if (marker.root !== root) blocked = "marker root does not match";
  else if (!/^wsp(-[a-z0-9]{1,8})?$/.test(marker.session)) blocked = "marker session is invalid";
  else if (!rootAllowed(root, prefixes)) blocked = "root is not under the allowed prefix";
  for (const path of candidates) {
    if (blocked !== null) {
      plan.refuse.push({ path, why: blocked });
      continue;
    }
    const bad = lexicallyOk(path);
    if (bad !== null) plan.refuse.push({ path, why: bad });
    else if (!isUnder(root, path)) plan.refuse.push({ path, why: "not strictly under the root" });
    else plan.delete.push(path);
  }
  return plan;
}

/** True iff the pid is in the own list, or in the core's status list with the root in its command line. */
export function pidIsOwn(
  pid: number,
  ownPids: readonly number[],
  statusPids: readonly number[],
  cmdline: string,
  root: string,
): boolean {
  if (ownPids.includes(pid)) return true;
  return statusPids.includes(pid) && root !== "" && cmdline.includes(root);
}

export interface CleanupInput {
  hc: Hc | null;
  marker: OwnMarker;
  children: ChildHandle[];
  /** Main socket of the Test_Core (under the root). When absent, only marker pids decide. */
  socketPath?: string;
  rootPrefixes?: readonly string[];
  /** Command line of a pid; defaults to `ps`. */
  cmdlineOf?: (pid: number) => Promise<string>;
  log?: (line: string) => void;
  waitMs?: number;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function socketGone(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const s = createConnection(path);
    const done = (v: boolean): void => {
      s.destroy();
      resolve(v);
    };
    s.once("connect", () => done(false));
    s.once("error", (err) => {
      const code = (err as NodeJS.ErrnoException).code;
      done(code === "ENOENT" || code === "ECONNREFUSED");
    });
  });
}

function defaultCmdline(pid: number): Promise<string> {
  return new Promise((resolve) => {
    execFile("ps", ["-o", "command=", "-p", String(pid)], (err, out) => {
      resolve(err ? "" : out);
    });
  });
}

function collectPids(x: unknown, out: Set<number>): void {
  if (Array.isArray(x)) {
    for (const v of x) collectPids(v, out);
  } else if (typeof x === "object" && x !== null) {
    for (const [k, v] of Object.entries(x)) {
      if (/^pids?$/i.test(k)) {
        for (const n of Array.isArray(v) ? v : [v]) {
          if (typeof n === "number" && Number.isInteger(n) && n > 0) out.add(n);
        }
      } else collectPids(v, out);
    }
  }
}

async function statusPidsOf(hc: Hc): Promise<number[]> {
  try {
    const r = await hc.run(["server", "status"], { timeoutMs: 5000 });
    const out = new Set<number>();
    collectPids(JSON.parse(r.stdout), out);
    return [...out];
  } catch {
    return [];
  }
}

function kill(pid: number, sig: NodeJS.Signals): void {
  try {
    process.kill(pid, sig);
  } catch {
    // already gone
  }
}

function isSymlink(p: string): boolean | null {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return null;
  }
}

/**
 * Design order: stop own children, `server stop`, confirm stopped, kill remaining own pids,
 * delete the agent files, delete the root. Unconfirmed stop leaves the root (exit 30).
 */
export async function cleanupRun(c: CleanupInput): Promise<{ stopped: boolean; removed: boolean }> {
  const log = c.log ?? (() => {});
  const prefixes = c.rootPrefixes ?? DEFAULT_ROOT_PREFIXES;
  const root = c.marker.root;
  const own = (): number[] => [...new Set([...c.marker.pids, ...c.children.map((k) => k.pid)])];

  for (const child of c.children) {
    try {
      await child.stop();
    } catch {
      kill(child.pid, "SIGKILL");
    }
  }
  let statusPids: number[] = [];
  if (c.hc !== null) {
    statusPids = await statusPidsOf(c.hc);
    try {
      await c.hc.run(["server", "stop"], { timeoutMs: 10_000 });
    } catch {
      // confirmation below decides
    }
  }

  const confirm = async (): Promise<boolean> => {
    const socketOk = c.socketPath === undefined ? true : await socketGone(c.socketPath);
    return socketOk && own().every((p) => !pidAlive(p));
  };
  let stopped = await confirm();
  if (!stopped) {
    const cmdlineOf = c.cmdlineOf ?? defaultCmdline;
    const targets = new Set<number>(own());
    for (const p of statusPids) targets.add(p);
    for (const pid of targets) {
      if (!pidAlive(pid)) continue;
      const cmd = statusPids.includes(pid) ? await cmdlineOf(pid) : "";
      if (pidIsOwn(pid, own(), statusPids, cmd, root)) kill(pid, "SIGTERM");
    }
    await sleep(c.waitMs ?? 3000);
    for (const pid of targets) {
      if (!pidAlive(pid)) continue;
      const cmd = statusPids.includes(pid) ? await cmdlineOf(pid) : "";
      if (pidIsOwn(pid, own(), statusPids, cmd, root)) kill(pid, "SIGKILL");
    }
    await sleep(100);
    stopped = await confirm();
  }
  if (!stopped) {
    log(`cleanup: stop not confirmed, root left in place: ${root}`);
    return { stopped: false, removed: false };
  }

  const files = c.marker.agentFiles
    .map((f) => f.path)
    .filter((p) => lexicallyOk(p) === null && basename(p).startsWith("wraith-spike-"));
  for (const p of files) {
    if (isSymlink(dirname(p)) === true) continue;
    rmSync(p, { force: true });
  }

  if (!rootAllowed(root, prefixes)) {
    log(`cleanup: root is outside the allowed prefix, left in place: ${root}`);
    return { stopped: true, removed: false };
  }
  if (isSymlink(root) !== false) {
    // symlink (refused) or already absent
    return { stopped: true, removed: false };
  }
  rmSync(root, { recursive: true, force: true });
  return { stopped: true, removed: true };
}
