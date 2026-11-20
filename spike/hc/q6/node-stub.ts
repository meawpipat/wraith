import { respawnDecision } from "./respawn.ts";

/**
 * Q6 node stub: tracks the panes it started, learns about finished ones from `ls` polls (default
 * every 5 s) and respawns with the same ids and labels when `respawnDecision` says so. It never
 * restarts the core and never answers an approval. All hc calls go through the injected deps.
 */

export interface SlotSpec {
  /** The `wraith.spawn` label value; also names the stub's pid file. */
  token: string;
  labels: Record<string, string>;
  argv: string[];
  cwd: string;
}

export interface Slot {
  addr: string;
  finished: boolean;
  reason: string | null;
  code: number | null;
}

export interface NodeStubDeps {
  /** `null` when the core cannot be reached (stopped, restarting). */
  list(): Promise<Slot[] | null>;
  /** Starts a pane for the spec and returns its address, or `null` when it did not start. */
  start(spec: SlotSpec): Promise<string | null>;
  remove(addr: string): Promise<void>;
  /** Monotonic milliseconds. */
  now(): number;
}

export interface StubEvent {
  token: string;
  addr: string;
  reason: string;
  code: number | null;
  decision: "respawn" | "none";
  detectedMs: number;
  respawnedMs: number | null;
  newAddr: string | null;
}

export const POLL_MS = 5000;

interface Tracked {
  spec: SlotSpec;
  addr: string | null;
}

export class NodeStub {
  readonly events: StubEvent[] = [];
  private readonly tracked = new Map<string, Tracked>();

  constructor(private readonly deps: NodeStubDeps) {}

  /** Starts following a pane the script started itself. */
  track(spec: SlotSpec, addr: string): void {
    this.tracked.set(spec.token, { spec, addr });
  }

  addressOf(token: string): string | null {
    return this.tracked.get(token)?.addr ?? null;
  }

  eventsFor(token: string): StubEvent[] {
    return this.events.filter((e) => e.token === token);
  }

  async pollOnce(): Promise<void> {
    const slots = await this.deps.list();
    if (slots === null) return;
    for (const t of this.tracked.values()) {
      if (t.addr === null) continue;
      const slot = slots.find((s) => s.addr === t.addr);
      if (slot === undefined || !slot.finished) continue;
      const reason = slot.reason ?? "unknown";
      const decision = respawnDecision(reason, slot.code);
      const ev: StubEvent = {
        token: t.spec.token,
        addr: t.addr,
        reason,
        code: slot.code,
        decision,
        detectedMs: this.deps.now(),
        respawnedMs: null,
        newAddr: null,
      };
      this.events.push(ev);
      // The outcome is recorded first, then the finished pane is removed (§7.6).
      await this.deps.remove(t.addr);
      if (decision === "respawn") {
        const addr = await this.deps.start(t.spec);
        ev.respawnedMs = this.deps.now();
        ev.newAddr = addr;
        t.addr = addr;
      } else {
        t.addr = null;
      }
    }
  }
}

/* ---- tolerant parsers for hc output (exact forms are read from Q2's schema, assumption) ---- */

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function str(r: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = r[k];
    if (typeof v === "string" && v !== "") return v;
  }
  return null;
}

function num(r: Record<string, unknown>, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = r[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

/** Accepts a JSON array, or an object holding the array under `terminals`/`items`. */
export function parseSlots(text: string): Slot[] | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const rec = asRecord(json);
  const list = Array.isArray(json) ? json : (rec?.terminals ?? rec?.items);
  if (!Array.isArray(list)) return null;
  const out: Slot[] = [];
  for (const item of list) {
    const r = asRecord(item);
    if (r === null) continue;
    const addr = str(r, "address", "addr", "id");
    if (addr === null) continue;
    const reason = str(r, "reason", "finish_reason", "finished_reason");
    const state = str(r, "status", "state");
    out.push({
      addr,
      finished: state === "finished" || reason !== null,
      reason,
      code: num(r, "code", "exit_code", "exitCode"),
    });
  }
  return out;
}

export interface StatusPids {
  /** The first pid in the status text, taken as the core's. */
  core: number | null;
  all: number[];
}

/** Reads `pid` fields from a JSON status or `pid: N` / `pid=N` text, in order of appearance. */
export function parseStatusPids(text: string): StatusPids {
  const all: number[] = [];
  const re = /pids?"?\s*[:=]\s*\[?\s*(\d+(?:\s*,\s*\d+)*)/gi;
  for (const m of text.matchAll(re)) {
    for (const p of (m[1] ?? "").split(",")) {
      const n = Number(p.trim());
      if (Number.isInteger(n) && n > 1 && !all.includes(n)) all.push(n);
    }
  }
  return { core: all[0] ?? null, all };
}
