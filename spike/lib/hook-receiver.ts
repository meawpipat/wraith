import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import type { PermissionAnswer } from "./approval.ts";

/** Q3b hook receiver (design: "Hook receiver", D11). Not product code. */

export const HOOK_PORT = 7782;
export const HOOK_TOKEN_HEADER = "x-wraith-spike-token";
export const HOOK_TOKEN_FILE = "hook.token";
const MAX_BODY_BYTES = 256 * 1024;

export interface HookDecision {
  decision: "block" | "allow";
  nonce: string;
}

export type HookAnswer = PermissionAnswer | "timeout" | "error";

export interface HookEvent {
  at: string;
  nonce: string;
  decision: "block" | "allow";
  /** Why it was blocked, or "owner-allow-once". */
  why: string;
  tokenOk: boolean;
  event: unknown;
}

export interface HookResult {
  status: number;
  body: HookDecision;
  exitCode: 0 | 2;
}

/** A well-formed body is `{nonce: non-empty string, event: anything}`. */
function nonceOf(body: unknown): string | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const nonce = (body as Record<string, unknown>).nonce;
  if (typeof nonce !== "string" || nonce.length === 0 || nonce.length > 128) return null;
  if (!("event" in body)) return null;
  return nonce;
}

function digest(s: string): Buffer {
  return createHash("sha256").update(s).digest();
}

function tokenMatches(given: string | undefined, expected: string): boolean {
  if (typeof given !== "string" || typeof expected !== "string" || expected.length === 0) {
    return false;
  }
  return timingSafeEqual(digest(given), digest(expected));
}

function isOwnerAllowOnce(answer: unknown): boolean {
  if (typeof answer !== "object" || answer === null) return false;
  const a = answer as Record<string, unknown>;
  return a.outcome === "selected" && a.kind === "allow_once" && a.by === "owner";
}

/**
 * Pure and total. Anything other than "token valid, body well formed, owner selected
 * allow_once" is a block with exit code 2.
 */
export function decideHook(
  req: { token: string | undefined; body: unknown },
  expectedToken: string,
  answer: HookAnswer,
): HookResult {
  try {
    const nonce = nonceOf(req.body);
    const block = (status: number): HookResult => ({
      status,
      body: { decision: "block", nonce: nonce ?? "" },
      exitCode: 2,
    });
    if (!tokenMatches(req.token, expectedToken)) return block(401);
    if (nonce === null) return block(400);
    if (!isOwnerAllowOnce(answer)) return block(200);
    return { status: 200, body: { decision: "allow", nonce }, exitCode: 0 };
  } catch {
    return { status: 500, body: { decision: "block", nonce: "" }, exitCode: 2 };
  }
}

export function newHookToken(): string {
  return randomBytes(32).toString("hex");
}

/** Writes `<root>/hook.token` with mode 0600. */
export function writeHookToken(root: string, token: string): string {
  mkdirSync(root, { recursive: true });
  const file = join(root, HOOK_TOKEN_FILE);
  writeFileSync(file, token, { mode: 0o600 });
  chmodSync(file, 0o600);
  return file;
}

export interface HookReceiverInput {
  /** 7782 in a real run; a test may pass 0 for any free port. */
  port: number;
  token: string;
  ask: (e: unknown) => Promise<HookAnswer>;
  log: (e: unknown) => void;
}

export interface HookReceiver {
  outcome: "listening";
  port: number;
  close(): Promise<void>;
  events(): HookEvent[];
}

export interface HookReceiverPending {
  outcome: "pending";
  reason: string;
}

function readBody(req: NodeJS.ReadableStream): Promise<{ ok: true; text: string } | { ok: false }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let dead = false;
    req.on("data", (c: Buffer) => {
      if (dead) return;
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        dead = true;
        resolve({ ok: false });
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!dead) resolve({ ok: true, text: Buffer.concat(chunks).toString("utf8") });
    });
    req.on("error", () => {
      if (!dead) resolve({ ok: false });
    });
  });
}

export function startHookReceiver(
  i: HookReceiverInput,
): Promise<HookReceiver | HookReceiverPending> {
  const events: HookEvent[] = [];
  const record = (e: HookEvent): void => {
    events.push(e);
    i.log(e);
  };

  const server: Server = createServer((req, res) => {
    const send = (status: number, body: HookDecision): void => {
      const text = JSON.stringify(body);
      res.writeHead(status, {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(text),
      });
      res.end(text);
    };
    const handle = async (): Promise<void> => {
      const header = req.headers[HOOK_TOKEN_HEADER];
      const token = typeof header === "string" ? header : undefined;
      if (req.method !== "POST") {
        send(405, { decision: "block", nonce: "" });
        return;
      }
      // Refuse before reading anything when the token is wrong.
      if (!tokenMatches(token, i.token)) {
        send(401, { decision: "block", nonce: "" });
        return;
      }
      const raw = await readBody(req);
      let body: unknown = null;
      if (raw.ok) {
        try {
          body = JSON.parse(raw.text);
        } catch {
          body = null;
        }
      }
      const nonce = nonceOf(body);
      let answer: HookAnswer = "error";
      if (nonce !== null) {
        try {
          answer = await i.ask((body as { event: unknown }).event);
        } catch {
          answer = "error";
        }
      }
      const result = decideHook({ token, body }, i.token, answer);
      let why = "owner-allow-once";
      if (result.exitCode === 2) {
        if (nonce === null) why = "malformed-body";
        else if (answer === "timeout" || answer === "error") why = answer;
        else if (typeof answer === "object") why = `owner-${answer.outcome}`;
        else why = "blocked";
      }
      record({
        at: new Date().toISOString(),
        nonce: result.body.nonce,
        decision: result.body.decision,
        why,
        tokenOk: true,
        event: body === null ? null : (body as { event?: unknown }).event,
      });
      send(result.status, result.body);
    };
    handle().catch(() => {
      if (!res.headersSent) send(500, { decision: "block", nonce: "" });
      else res.end();
    });
  });

  return new Promise((resolve) => {
    server.once("error", (err: NodeJS.ErrnoException) => {
      const code = err.code ?? "error";
      resolve({
        outcome: "pending",
        reason:
          code === "EADDRINUSE"
            ? `port ${i.port} on 127.0.0.1 is busy; free it and rerun`
            : `hook receiver could not listen on 127.0.0.1:${i.port} (${code})`,
      });
    });
    server.listen(i.port, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr !== null ? addr.port : i.port;
      resolve({
        outcome: "listening",
        port,
        events: () => events.slice(),
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
            server.closeAllConnections();
          }),
      });
    });
  });
}
