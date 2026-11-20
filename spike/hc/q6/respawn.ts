/**
 * Q6 respawn rule (pure), architecture §7.6: with no node close intent, a finished pane is LOST and
 * respawned, whatever the reason. Only three cases are not respawned:
 * - `killed`: a person closed it;
 * - `exited` with code 0: the sprite exits 0 only with an intent (R13.7);
 * - `spawn_pending`: wait and re-check, then treat as lost.
 * The Q6 node stub never closes a pane itself, so it never has an intent.
 */

export type RespawnDecision = "respawn" | "none" | "wait";

/** Reasons §7.6 names as lost. Documentation and test data; the rule itself does not depend on this list. */
export const LOST_REASONS: readonly string[] = [
  "holder_lost",
  "host_shutdown",
  "signaled",
  "stopped_by_restart",
  "server_stop",
  "exited",
];

/** Finish reasons that mean "the core stopped or restarted under the pane". */
export const CORE_STOP_REASONS: readonly string[] = [
  "server_stop",
  "stopped_by_restart",
  "host_shutdown",
];

/** `spawn_pending` is re-checked at most this many times, then treated as lost (§7.6). */
export const MAX_SPAWN_WAITS = 3;

export function respawnDecision(reason: string, code: number | null): RespawnDecision {
  if (reason === "killed") return "none";
  if (reason === "spawn_pending") return "wait";
  if (reason === "exited" && code === 0) return "none";
  return "respawn";
}

/** True when `respawnedMs - triggerMs` is within the limit (both from the same monotonic clock). */
export function withinLimit(triggerMs: number, respawnedMs: number, limitMs = 10_000): boolean {
  const d = respawnedMs - triggerMs;
  return Number.isFinite(d) && d >= 0 && d <= limitMs;
}
