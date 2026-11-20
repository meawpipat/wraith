/** Pure helpers for the Q1 spike: `ps -o cputime=` parsing and CPU percentage points. */

/**
 * Parses a `ps` cputime value into seconds.
 * Accepts `M:SS.cc` (macOS), `H:MM:SS` and `D-HH:MM:SS` (Linux). Returns NaN for anything else.
 */
export function cpuSeconds(text: string): number {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d{2}(?:\.\d+)?)$/.exec(text.trim());
  if (m === null) return Number.NaN;
  const days = Number(m[1] ?? 0);
  const hours = m[2] === undefined ? 0 : Number(m[2]);
  const minutes = Number(m[3]);
  const seconds = Number(m[4]);
  return days * 86_400 + hours * 3_600 + minutes * 60 + seconds;
}

/** CPU seconds used by the core over a wall-clock window (all in seconds). */
export interface CpuWindow {
  cpuStart: number;
  cpuEnd: number;
  wallSeconds: number;
}

/** Percentage points of one core used in the window; 0 when the window has no usable length. */
export function windowPoints(w: CpuWindow): number {
  if (!(w.wallSeconds > 0)) return 0;
  const delta = w.cpuEnd - w.cpuStart;
  return Number.isFinite(delta) ? (delta / w.wallSeconds) * 100 : 0;
}

/** Points of one core gained by the during window over the baseline window; never negative. */
export function increasePoints(base: CpuWindow, during: CpuWindow): number {
  return Math.max(0, windowPoints(during) - windowPoints(base));
}
