/**
 * Q6 respawn rule (pure). It is the spike's reading of R13.7: respawn only when the holder was
 * lost or the core stopped, never after a clean exit or a person's close.
 */

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
  return CORE_STOP_REASONS.includes(reason) ? "respawn" : "none";
}

/** True when `respawnedMs - triggerMs` is within the limit (both from the same monotonic clock). */
export function withinLimit(triggerMs: number, respawnedMs: number, limitMs = 10_000): boolean {
  const d = respawnedMs - triggerMs;
  return Number.isFinite(d) && d >= 0 && d <= limitMs;
}
