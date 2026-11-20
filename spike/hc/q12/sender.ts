/** Pure helpers of the Q12 spike: does any event name the client that sent input to a pane? */

import type { ResultValue } from "../../lib/outcome.ts";

const SENDER_KEY = /client|source|sender|origin/i;
const PANE_KEY = /^(?:pane|terminal)(?:[_-]?id)?$/i;
const PANE_ID = /^t\d+$/;

export interface SenderFinding {
  /** Index of the event in the input list. */
  eventIndex: number;
  /** Dotted path of the object that holds both fields (`$` for the event itself). */
  path: string;
  /** The sender-like key. */
  key: string;
  /** The key that holds the pane id next to it. */
  paneKey: string;
}

function isFilled(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v !== "";
  return true;
}

function paneKeyOf(o: Record<string, unknown>): string | null {
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === "string" && PANE_ID.test(v)) return k;
    if (PANE_KEY.test(k) && (typeof v === "string" || typeof v === "number") && isFilled(v)) {
      return k;
    }
  }
  return null;
}

function walk(
  node: unknown,
  path: string,
  eventIndex: number,
): Omit<SenderFinding, "eventIndex"> | null {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const hit = walk(node[i], `${path}[${i}]`, eventIndex);
      if (hit) return hit;
    }
    return null;
  }
  if (node === null || typeof node !== "object") return null;
  const obj = node as Record<string, unknown>;
  const paneKey = paneKeyOf(obj);
  if (paneKey !== null) {
    for (const [k, v] of Object.entries(obj)) {
      if (k !== paneKey && SENDER_KEY.test(k) && isFilled(v)) return { path, key: k, paneKey };
    }
  }
  for (const [k, v] of Object.entries(obj)) {
    const hit = walk(v, `${path}.${k}`, eventIndex);
    if (hit) return hit;
  }
  return null;
}

/**
 * First event object that holds a pane id and, in the same object, a key matching
 * `/client|source|sender|origin/i` with a value. Total: never throws.
 */
export function findSenderField(events: readonly unknown[]): SenderFinding | null {
  for (let i = 0; i < events.length; i++) {
    const hit = walk(events[i], "$", i);
    if (hit) return { eventIndex: i, ...hit };
  }
  return null;
}

export interface Q12Observation {
  paneCreated: boolean;
  followerStarted: boolean;
  sendOk: boolean;
  eventCount: number;
  finding: SenderFinding | null;
}

export interface Q12Verdict {
  result: ResultValue;
  reason?: string;
  branch?: string;
}

export const Q12_FAIL_BRANCH = "drop `herdr-guard`, keep the limitation in §12";
export const Q12_PASS_BRANCH = "keep `herdr-guard`: read the sender field from the event";

/** Maps what was observed to a Result_Value. FAIL is the expected answer (R13.9). */
export function q12Verdict(o: Q12Observation): Q12Verdict {
  if (!o.paneCreated) return { result: "pending", reason: "no test pane could be created" };
  if (!o.followerStarted) return { result: "pending", reason: "the events follower did not start" };
  if (!o.sendOk) return { result: "pending", reason: "hc send did not succeed" };
  if (o.finding !== null) return { result: "PASS", branch: Q12_PASS_BRANCH };
  if (o.eventCount === 0) {
    return { result: "PARTIAL", reason: "the follower captured no events during the window" };
  }
  return { result: "FAIL", branch: Q12_FAIL_BRANCH };
}

/** Dotted key paths of a JSON value, no values (so evidence holds structure only). */
export function keyPaths(v: unknown, prefix = "$", out: string[] = []): string[] {
  if (Array.isArray(v)) {
    for (const item of v.slice(0, 3)) keyPaths(item, `${prefix}[]`, out);
  } else if (v !== null && typeof v === "object") {
    for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
      out.push(`${prefix}.${k}`);
      keyPaths(child, `${prefix}.${k}`, out);
    }
  }
  return out;
}
