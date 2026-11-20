import { closeSync, mkdirSync, openSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createObserveHc, type Hc } from "./hc.ts";
import { pidAlive, readMarker } from "./own-marker.ts";

/** Parent of every Spike_Root. Tests pass their own folder. */
export const DEFAULT_OBSERVE_ROOT = "/tmp/hcw";
export const OBSERVE_LOCK_NAME = ".observe-lock";

export interface ObserveIo {
  stdinIsTTY: boolean;
  stdoutIsTTY: boolean;
  baseEnv: NodeJS.ProcessEnv;
  /** Parent folder of the Spike_Roots and of the lock. Default `/tmp/hcw`. */
  rootsDir?: string;
  /** Prints a fixed line. */
  print: (line: string) => void;
  /** The observer's work. It only ever receives the observe-mode hc wrapper. Default: one `server status`. */
  run?: (hc: Hc) => Promise<void>;
}

export type ObserveResult = { ok: true } | { ok: false; reason: string };

export function observeLockPath(rootsDir: string = DEFAULT_OBSERVE_ROOT): string {
  return join(rootsDir, OBSERVE_LOCK_NAME);
}

/** True while an Observe_Mode run holds the lock (the runner refuses every other spike then). */
export function observeLockHeld(rootsDir: string = DEFAULT_OBSERVE_ROOT): boolean {
  try {
    return readdirSync(rootsDir).includes(OBSERVE_LOCK_NAME);
  } catch {
    return false;
  }
}

/** True when a Spike_Root under `rootsDir` has a valid Own_Marker whose runner pid is alive. */
export function liveMarkerExists(rootsDir: string = DEFAULT_OBSERVE_ROOT): boolean {
  let names: string[];
  try {
    names = readdirSync(rootsDir);
  } catch {
    return false;
  }
  for (const n of names) {
    const m = readMarker(join(rootsDir, n));
    if (m !== null && pidAlive(m.runnerPid)) return true;
  }
  return false;
}

/**
 * `pnpm spike q14 --observe-default` (R1.8, R1.9). Does not use the normal preflight,
 * which keeps refusing `default`. The only hc wrapper is `createObserveHc` (`server status` only).
 */
export async function runObserve(io: ObserveIo): Promise<ObserveResult> {
  const rootsDir = io.rootsDir ?? DEFAULT_OBSERVE_ROOT;
  if (!io.stdinIsTTY || !io.stdoutIsTTY) {
    return { ok: false, reason: "needs interactive terminal" };
  }
  if (liveMarkerExists(rootsDir)) {
    return { ok: false, reason: "another spike run is live" };
  }
  const lock = observeLockPath(rootsDir);
  try {
    mkdirSync(rootsDir, { recursive: true, mode: 0o700 });
    closeSync(openSync(lock, "wx", 0o600));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      return { ok: false, reason: "observe lock is held" };
    }
    return { ok: false, reason: "observe lock could not be created" };
  }
  try {
    const hc = createObserveHc({ baseEnv: io.baseEnv });
    const work =
      io.run ??
      (async (h: Hc): Promise<void> => {
        const r = await h.run(["server", "status"]);
        io.print(`server status exit ${String(r.code)} in ${String(r.ms)} ms`);
      });
    await work(hc);
    return { ok: true };
  } finally {
    rmSync(lock, { force: true });
  }
}
