import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PermissionAnswer } from "./approval.ts";
import type { SpikeContext } from "./outcome.ts";
import { MARKER_FILE, type OwnMarker, readMarker, writeMarker } from "./own-marker.ts";

/** Shared helpers of the Kiro Group B spikes (Q3, Q3b, Q10, Q4, Q11, Q23). Not product code. */

export const DEFAULT_REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** What Q43 found: where the profile loads from, `none` (Q43 FAIL: no `--agent`), or no evidence. */
export type Q43Placement = "scratch" | "home" | "none" | "unknown";

function newestStamp(dir: string): string[] {
  try {
    return readdirSync(dir).sort().reverse();
  } catch {
    return [];
  }
}

/** Reads the newest `spike/kiro/q43/evidence/<stamp>/placement.json`; `unknown` when absent. */
export function readQ43Placement(repoRoot: string = DEFAULT_REPO_ROOT): Q43Placement {
  const root = join(repoRoot, "spike/kiro/q43/evidence");
  for (const stamp of newestStamp(root)) {
    try {
      const p = JSON.parse(readFileSync(join(root, stamp, "placement.json"), "utf8")) as {
        placement?: unknown;
      };
      if (p.placement === "scratch" || p.placement === "home") return p.placement;
      let failed = false;
      try {
        const s = JSON.parse(readFileSync(join(root, stamp, "summary.json"), "utf8")) as {
          result?: unknown;
        };
        failed = s.result === "FAIL";
      } catch {
        // A pending run has no summary.
      }
      return failed ? "none" : "unknown";
    } catch {
      // Not a stamp folder with placement.json; try an older one.
    }
  }
  return "unknown";
}

/** `kiro-cli acp --agent-engine v3 --agent wraith-spike-<q>`, without `--agent` when Q43 failed. */
export function kiroAcpArgv(command: string, q: string, placement: Q43Placement): string[] {
  const base = [command, "acp", "--agent-engine", "v3"];
  return placement === "none" ? base : [...base, "--agent", `wraith-spike-${q}`];
}

/** Records a written profile file in the on-disk marker so a crashed run can still delete it. */
export function recordInMarker(ctx: SpikeContext, write: (m: OwnMarker) => void): void {
  const marker = readMarker(ctx.root);
  if (marker === null) throw new Error(`no ${MARKER_FILE} in the Spike_Root; refusing a profile`);
  write(marker);
  writeMarker(marker);
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Lines of a raw log, skipping blanks; an unreadable file gives none. */
export function* fileLines(path: string): Generator<string> {
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const l of text.split("\n")) if (l !== "") yield l;
}

export async function* asyncFileLines(paths: string[]): AsyncGenerator<string> {
  for (const p of paths) yield* fileLines(p);
}

/** True when the owner's answer is a selected allow option (the only way a tool may run). */
export function isAllow(a: PermissionAnswer): boolean {
  return a.outcome === "selected" && (a.kind === "allow_once" || a.kind === "allow_always");
}
