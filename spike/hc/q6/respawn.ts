/**
 * Q6 respawn rule (pure), after architecture §7.6: respawn when the holder was lost, the core
 * stopped, or the sprite exited 75 (a signal) with no node close intent; never after exited 0 or killed.
 * The Q6 node stub never closes a pane itself, so every exited 75 it sees has no node intent.
 */

/** The sprite exits 75 on signals or a refused duplicate (§7.6). */
export const EXIT_LOST_CODE = 75;

export type RespawnDecision = "respawn" | "none";

/** Finish reasons that mean "the core stopped or restarted under the pane" (assumption: names from §7.6). */
export const CORE_STOP_REASONS: readonly string[] = [
  "server_stop",
  "stopped_by_restart",
  "host_shutdown",
];

export function respawnDecision(reason: string, code: number | null): RespawnDecision {
  if (code === 0) return "none";
  if (reason === "killed") return "none";
  if (reason === "holder_lost") return "respawn";
  if (reason === "exited" && code === EXIT_LOST_CODE) return "respawn";
  return CORE_STOP_REASONS.includes(reason) ? "respawn" : "none";
}

/** True when `respawnedMs - triggerMs` is within the limit (both from the same monotonic clock). */
export function withinLimit(triggerMs: number, respawnedMs: number, limitMs = 10_000): boolean {
  const d = respawnedMs - triggerMs;
  return Number.isFinite(d) && d >= 0 && d <= limitMs;
}
