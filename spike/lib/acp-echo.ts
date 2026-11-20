import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import {
  type AnyMessage,
  type ClientConnection,
  client,
  type RequestPermissionResponse,
  type Stream,
} from "@agentclientprotocol/sdk";
import { findUnsafeToken } from "../../tools/lib/unsafe-tokens.ts";
import type { PermissionAnswer, PermissionOption, PermissionRequest } from "./approval.ts";
import { isPaneEnvName } from "./env.ts";
import { isUnder } from "./preflight.ts";

/** Raw ACP client for the spikes (design: "acp-echo client", R12.5, R14). Not product code. */

export interface ClientCaps {
  /** Declared to the agent only when a spike asks for it (Q4). */
  terminal?: boolean;
}

export interface McpServerConfig {
  type: "http";
  name: string;
  url: string;
  headers: { name: string; value: string }[];
}

export interface AcpFrame {
  t: number;
  dir: "c2a" | "a2c";
  msg: unknown;
}

export interface AcpEcho {
  initialize(caps: ClientCaps): Promise<unknown>;
  newSession(cwd: string, mcpServers?: McpServerConfig[]): Promise<{ sessionId: string }>;
  loadSession(sessionId: string, cwd: string): Promise<{ replay: AcpFrame[] }>;
  prompt(sessionId: string, text: string): Promise<{ stopReason: string }>;
  onPermission(h: (r: PermissionRequest) => Promise<PermissionAnswer>): void;
  onUpdate(h: (u: unknown) => void): void;
  frames(): readonly AcpFrame[];
  promptsSent(): number;
  /** Why the agent was closed by a limit (`PARTIAL`), or null. */
  partialReason(): string | null;
  close(): Promise<void>;
}

export interface AcpStartInput {
  argv: string[];
  cwd: string;
  env: Record<string, string>;
  maxPrompts: number;
  killAfterMs: number;
  /** The run's Spike_Root. Raw logs are unredacted, so `rawLog` must be under it (only the root is deleted). */
  root: string;
  rawLog: string;
  /** Wall-time timer. Default: a real unref'd `setTimeout`. A test injects a manual one. */
  setTimer?: (fn: () => void, ms: number) => TimerHandle;
}

export interface TimerHandle {
  clear(): void;
}

function realTimer(fn: () => void, ms: number): TimerHandle {
  const t = setTimeout(fn, ms);
  t.unref();
  return { clear: () => clearTimeout(t) };
}

export class PromptCapReached extends Error {
  constructor(readonly maxPrompts: number) {
    super(`prompt cap reached: ${maxPrompts} prompt(s) already sent`);
    this.name = "PromptCapReached";
  }
}

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Refuses an argv holding an SI token (SI-2), an empty argv, or a non-absolute log path. */
export function assertAcpInput(i: AcpStartInput): void {
  if (i.argv.length === 0 || i.argv.some((a) => typeof a !== "string")) {
    throw new Error("acp-echo: argv must be a non-empty string array");
  }
  for (const a of i.argv) {
    if (findUnsafeToken(a) !== null)
      throw new Error("spike-agent-unsafe: argv holds an unsafe token");
  }
  if (findUnsafeToken(i.argv.join(" ")) !== null) {
    throw new Error("spike-agent-unsafe: argv holds an unsafe token");
  }
  if (!isAbsolute(i.rawLog)) throw new Error("acp-echo: rawLog must be an absolute path");
  if (!isAbsolute(i.root) || !isUnder(i.root, i.rawLog)) {
    throw new Error("acp-echo: rawLog must be under the Spike_Root");
  }
}

/** `HC_*`, `HERDR_*` and `XDG_*` never reach the agent, whatever the caller passed. */
function cleanEnv(env: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (isPaneEnvName(k) || k.startsWith("XDG_")) continue;
    out[k] = v;
  }
  return out;
}

function toRequest(params: unknown): PermissionRequest {
  const p = isObject(params) ? params : {};
  const call = isObject(p.toolCall) ? p.toolCall : {};
  const tool =
    typeof call.title === "string"
      ? call.title
      : typeof call.kind === "string"
        ? call.kind
        : "unknown";
  const options = Array.isArray(p.options) ? (p.options as PermissionOption[]) : [];
  return { tool, args: call.rawInput ?? call, options };
}

/** Maps an approval answer to the ACP outcome; anything that is not an offered option cancels. */
export function toAcpOutcome(req: PermissionRequest, a: PermissionAnswer): Json {
  if (a.outcome === "cancelled") return { outcome: "cancelled" };
  const opt = req.options.find((o) => o.optionId === a.optionId);
  if (opt === undefined) return { outcome: "cancelled" };
  if (a.outcome === "rejected" && opt.kind !== "reject_once" && opt.kind !== "reject_always") {
    return { outcome: "cancelled" };
  }
  if (a.outcome === "selected" && (a.by !== "owner" || a.kind !== opt.kind)) {
    return { outcome: "cancelled" };
  }
  return { outcome: "selected", optionId: opt.optionId };
}

interface Pending {
  resolve(v: unknown): void;
  reject(e: Error): void;
}

class RawAcp implements AcpEcho {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly log: AcpFrame[] = [];
  private readonly pending = new Map<number, Pending>();
  private readonly started = Date.now();
  private nextId = 1;
  private sent = 0;
  private buffer = "";
  private exited = false;
  private partial: string | null = null;
  private permission: ((r: PermissionRequest) => Promise<PermissionAnswer>) | null = null;
  private update: ((u: unknown) => void) | null = null;
  private readonly timer: TimerHandle;
  private readonly exitPromise: Promise<void>;

  constructor(private readonly i: AcpStartInput) {
    assertAcpInput(i);
    mkdirSync(dirname(i.rawLog), { recursive: true });
    const [command, ...args] = i.argv as [string, ...string[]];
    this.child = spawn(command, args, {
      cwd: i.cwd,
      env: cleanEnv(i.env),
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.exitPromise = new Promise<void>((resolve) => {
      this.child.once("close", () => {
        this.exited = true;
        this.failAll(new Error("agent closed"));
        resolve();
      });
      this.child.once("error", (e) => {
        this.exited = true;
        this.failAll(e);
        resolve();
      });
    });
    this.child.stdin.on("error", () => {
      // the agent closed its stdin; pending requests are failed by the close handler
    });
    this.child.stderr.resume();
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.onData(chunk));
    this.timer = (i.setTimer ?? realTimer)(() => {
      this.partial = "max-wall-seconds reached";
      void this.close();
    }, i.killAfterMs);
  }

  private record(dir: AcpFrame["dir"], msg: unknown): AcpFrame {
    const frame: AcpFrame = { t: Date.now() - this.started, dir, msg };
    this.log.push(frame);
    appendFileSync(this.i.rawLog, `${JSON.stringify(frame)}\n`);
    return frame;
  }

  private failAll(e: Error): void {
    for (const p of this.pending.values()) p.reject(e);
    this.pending.clear();
  }

  private write(msg: Json): void {
    this.record("c2a", msg);
    if (!this.exited) this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...msg })}\n`);
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      if (this.exited) {
        reject(new Error("agent closed"));
        return;
      }
      this.pending.set(id, { resolve, reject });
      this.write({ id, method, params });
    });
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let at = this.buffer.indexOf("\n");
    while (at >= 0) {
      const line = this.buffer.slice(0, at).trim();
      this.buffer = this.buffer.slice(at + 1);
      if (line) this.onLine(line);
      at = this.buffer.indexOf("\n");
    }
  }

  private onLine(line: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      this.record("a2c", { nonJson: line.slice(0, 200) });
      return;
    }
    this.record("a2c", msg);
    if (!isObject(msg)) return;
    const id = msg.id;
    if (typeof msg.method === "string") {
      if (id === undefined) {
        if (msg.method === "session/update" && isObject(msg.params)) {
          this.update?.(msg.params.update);
        }
        return;
      }
      void this.onAgentRequest(id as number | string, msg.method, msg.params);
      return;
    }
    if (typeof id !== "number") return;
    const p = this.pending.get(id);
    if (p === undefined) return;
    this.pending.delete(id);
    if (isObject(msg.error)) {
      p.reject(new Error(String(msg.error.message ?? "agent error")));
    } else {
      p.resolve(msg.result);
    }
  }

  private async onAgentRequest(id: number | string, method: string, params: unknown) {
    if (method === "session/request_permission") {
      const req = toRequest(params);
      let outcome: Json = { outcome: "cancelled" };
      try {
        if (this.permission !== null) outcome = toAcpOutcome(req, await this.permission(req));
      } catch {
        outcome = { outcome: "cancelled" };
      }
      this.write({ id, result: { outcome } });
      return;
    }
    this.write({ id, error: { code: -32601, message: `not implemented: ${method}` } });
  }

  initialize(caps: ClientCaps): Promise<unknown> {
    return this.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: { terminal: caps.terminal === true },
    });
  }

  async newSession(cwd: string, mcpServers: McpServerConfig[] = []) {
    const r = await this.request("session/new", { cwd, mcpServers });
    const sessionId = isObject(r) ? r.sessionId : undefined;
    if (typeof sessionId !== "string") throw new Error("session/new returned no sessionId");
    return { sessionId };
  }

  async loadSession(sessionId: string, cwd: string) {
    const from = this.log.length;
    await this.request("session/load", { sessionId, cwd, mcpServers: [] });
    const replay = this.log
      .slice(from)
      .filter(
        (f) => f.dir === "a2c" && isObject(f.msg) && (f.msg as Json).method === "session/update",
      );
    return { replay };
  }

  async prompt(sessionId: string, text: string) {
    if (this.sent >= this.i.maxPrompts) {
      await this.close();
      throw new PromptCapReached(this.i.maxPrompts);
    }
    this.sent++;
    const r = await this.request("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text }],
    });
    const stopReason = isObject(r) && typeof r.stopReason === "string" ? r.stopReason : "unknown";
    return { stopReason };
  }

  onPermission(h: (r: PermissionRequest) => Promise<PermissionAnswer>): void {
    this.permission = h;
  }

  onUpdate(h: (u: unknown) => void): void {
    this.update = h;
  }

  frames(): readonly AcpFrame[] {
    return this.log;
  }

  promptsSent(): number {
    return this.sent;
  }

  partialReason(): string | null {
    return this.partial;
  }

  async close(): Promise<void> {
    this.timer.clear();
    if (!this.exited) {
      this.child.stdin.end();
      const kill = setTimeout(() => this.child.kill("SIGKILL"), 1000);
      await this.exitPromise;
      clearTimeout(kill);
    }
  }
}

export function startRawAcp(i: AcpStartInput): AcpEcho {
  return new RawAcp(i);
}

type SdkStream = Stream;

/**
 * Same interface over `@agentclientprotocol/sdk` (design: "acp-echo client", Q10). The SDK owns
 * JSON-RPC correlation and request dispatch; this class owns the process, the stream tap that
 * writes the frame log, the caps and the approval path (the same `toAcpOutcome` as the raw client).
 */
class SdkAcp implements AcpEcho {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly log: AcpFrame[] = [];
  private readonly started = Date.now();
  private readonly conn: ClientConnection;
  private sent = 0;
  private exited = false;
  private partial: string | null = null;
  private permission: ((r: PermissionRequest) => Promise<PermissionAnswer>) | null = null;
  private update: ((u: unknown) => void) | null = null;
  private readonly timer: TimerHandle;
  private readonly exitPromise: Promise<void>;

  constructor(private readonly i: AcpStartInput) {
    assertAcpInput(i);
    mkdirSync(dirname(i.rawLog), { recursive: true });
    const [command, ...args] = i.argv as [string, ...string[]];
    this.child = spawn(command, args, {
      cwd: i.cwd,
      env: cleanEnv(i.env),
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.exitPromise = new Promise<void>((resolve) => {
      const done = () => {
        this.exited = true;
        this.conn.close(new Error("agent closed"));
        resolve();
      };
      this.child.once("close", done);
      this.child.once("error", done);
    });
    this.child.stdin.on("error", () => {
      // the agent closed its stdin; the close handler ends the connection
    });
    this.child.stderr.resume();
    this.conn = client({ name: "wraith-spike" })
      .onRequest("session/request_permission", async (ctx) => {
        const req = toRequest(ctx.params);
        let outcome: Json = { outcome: "cancelled" };
        try {
          if (this.permission !== null) outcome = toAcpOutcome(req, await this.permission(req));
        } catch {
          outcome = { outcome: "cancelled" };
        }
        return { outcome } as unknown as RequestPermissionResponse;
      })
      .onNotification("session/update", (ctx) => {
        this.update?.((ctx.params as unknown as Json).update);
      })
      .connect(this.makeStream());
    this.timer = (i.setTimer ?? realTimer)(() => {
      this.partial = "max-wall-seconds reached";
      void this.close();
    }, i.killAfterMs);
  }

  private record(dir: AcpFrame["dir"], msg: unknown): void {
    const frame: AcpFrame = { t: Date.now() - this.started, dir, msg };
    this.log.push(frame);
    appendFileSync(this.i.rawLog, `${JSON.stringify(frame)}\n`);
  }

  /** A newline-delimited JSON stream over the child's stdio that records every frame. */
  private makeStream(): SdkStream {
    const decoder = new TextDecoder();
    let buffer = "";
    const readable = new ReadableStream<AnyMessage>({
      start: (controller) => {
        this.child.stdout.on("data", (chunk: Buffer) => {
          buffer += decoder.decode(chunk, { stream: true });
          let at = buffer.indexOf("\n");
          while (at >= 0) {
            const line = buffer.slice(0, at).trim();
            buffer = buffer.slice(at + 1);
            if (line) {
              try {
                const msg = JSON.parse(line) as AnyMessage;
                this.record("a2c", msg);
                controller.enqueue(msg);
              } catch {
                this.record("a2c", { nonJson: line.slice(0, 200) });
              }
            }
            at = buffer.indexOf("\n");
          }
        });
        this.child.stdout.once("close", () => {
          try {
            controller.close();
          } catch {
            // already closed
          }
        });
      },
    });
    const writable = new WritableStream<AnyMessage>({
      write: (msg) => {
        this.record("c2a", msg);
        if (!this.exited) this.child.stdin.write(`${JSON.stringify(msg)}\n`);
      },
    });
    return { readable, writable };
  }

  initialize(caps: ClientCaps): Promise<unknown> {
    return this.conn.agent.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: { terminal: caps.terminal === true },
    });
  }

  async newSession(cwd: string, mcpServers: McpServerConfig[] = []) {
    const r = (await this.conn.agent.request("session/new", {
      cwd,
      mcpServers,
    } as unknown as never)) as unknown;
    const sessionId = isObject(r) ? r.sessionId : undefined;
    if (typeof sessionId !== "string") throw new Error("session/new returned no sessionId");
    return { sessionId };
  }

  async loadSession(sessionId: string, cwd: string) {
    const from = this.log.length;
    await this.conn.agent.request("session/load", { sessionId, cwd, mcpServers: [] });
    const replay = this.log
      .slice(from)
      .filter(
        (f) => f.dir === "a2c" && isObject(f.msg) && (f.msg as Json).method === "session/update",
      );
    return { replay };
  }

  async prompt(sessionId: string, text: string) {
    if (this.sent >= this.i.maxPrompts) {
      await this.close();
      throw new PromptCapReached(this.i.maxPrompts);
    }
    this.sent++;
    const r = (await this.conn.agent.request("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text }],
    })) as unknown;
    const stopReason = isObject(r) && typeof r.stopReason === "string" ? r.stopReason : "unknown";
    return { stopReason };
  }

  onPermission(h: (r: PermissionRequest) => Promise<PermissionAnswer>): void {
    this.permission = h;
  }

  onUpdate(h: (u: unknown) => void): void {
    this.update = h;
  }

  frames(): readonly AcpFrame[] {
    return this.log;
  }

  promptsSent(): number {
    return this.sent;
  }

  partialReason(): string | null {
    return this.partial;
  }

  async close(): Promise<void> {
    this.timer.clear();
    if (!this.exited) {
      this.child.stdin.end();
      const kill = setTimeout(() => this.child.kill("SIGKILL"), 1000);
      await this.exitPromise;
      clearTimeout(kill);
    }
  }
}

export function startSdkAcp(i: AcpStartInput): AcpEcho {
  return new SdkAcp(i);
}
