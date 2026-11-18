import { randomBytes } from "node:crypto";
import { readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OWNER_LIST } from "./ids.ts";

export const MARKER_FILE = ".wraith-spike-owner";

// Same pattern as SESSION_RE in preflight.ts (kept local so this module has no dependency on it).
const SESSION_PATTERN = /^wsp(-[a-z0-9]{1,8})?$/;
const NONCE_PATTERN = /^[0-9a-f]{32}$/;
const KNOWN_IDS: ReadonlySet<string> = new Set<string>(OWNER_LIST);

export interface OwnMarker {
  v: 1;
  session: string;
  qs: string[];
  /** Realpath of the Spike_Root. */
  root: string;
  runnerPid: number;
  /** ISO-8601 UTC. */
  startedAt: string;
  /** 16 random bytes, hex. */
  nonce: string;
  /** Pids started by this run. */
  pids: number[];
  /** wraith-spike-<q>.json files this run wrote. */
  agentFiles: { path: string; created: true }[];
}

/** A fresh nonce: 16 random bytes as 32 hex characters. */
export function newNonce(): string {
  return randomBytes(16).toString("hex");
}

function isPid(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n > 0;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/** Validates the shape of a parsed marker; `null` when anything is off. */
function parseMarker(x: unknown): OwnMarker | null {
  if (!isRecord(x) || x.v !== 1) return null;
  const { session, qs, root, runnerPid, startedAt, nonce, pids, agentFiles } = x;
  if (typeof session !== "string" || !SESSION_PATTERN.test(session)) return null;
  if (!Array.isArray(qs) || qs.length === 0) return null;
  if (!qs.every((q) => typeof q === "string" && KNOWN_IDS.has(q))) return null;
  if (typeof root !== "string" || root === "") return null;
  if (!isPid(runnerPid)) return null;
  if (typeof startedAt !== "string" || Number.isNaN(Date.parse(startedAt))) return null;
  if (typeof nonce !== "string" || !NONCE_PATTERN.test(nonce)) return null;
  if (!Array.isArray(pids) || !pids.every(isPid)) return null;
  if (!Array.isArray(agentFiles)) return null;
  const files: { path: string; created: true }[] = [];
  for (const f of agentFiles) {
    if (!isRecord(f) || typeof f.path !== "string" || f.path === "" || f.created !== true) {
      return null;
    }
    files.push({ path: f.path, created: true });
  }
  return {
    v: 1,
    session,
    qs: qs as string[],
    root,
    runnerPid,
    startedAt,
    nonce,
    pids: pids as number[],
    agentFiles: files,
  };
}

/** Reads and validates `<root>/.wraith-spike-owner`; `null` when missing or invalid. */
export function readMarker(root: string): OwnMarker | null {
  try {
    const real = realpathSync(root);
    const parsed: unknown = JSON.parse(readFileSync(join(real, MARKER_FILE), "utf8"));
    const m = parseMarker(parsed);
    if (m === null || m.root !== real) return null;
    return m;
  } catch {
    return null;
  }
}

/** Writes the marker with mode 0600 through a temp file and a rename. */
export function writeMarker(m: OwnMarker): void {
  const target = join(m.root, MARKER_FILE);
  const tmp = `${target}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, `${JSON.stringify(m, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, target);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

/** True when the pid exists (`EPERM` means it exists but belongs to someone else). */
export function pidAlive(pid: number): boolean {
  if (!isPid(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}
