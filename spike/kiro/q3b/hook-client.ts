import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { HOOK_PORT, HOOK_TOKEN_FILE, HOOK_TOKEN_HEADER } from "../../lib/hook-receiver.ts";

/**
 * Q3b hook command (D11). Run as `node --experimental-strip-types hook-client.ts <root>`.
 * Exit 0 only on a JSON `{decision:"allow", nonce}` that matches this request.
 * Every other case exits 2: timeout, connection error, wrong shape, `block`.
 */

export interface HookClientOptions {
  root: string;
  stdin: string;
  port?: number;
  /** Must be longer than the owner's 120 s tap window. */
  timeoutMs?: number;
}

export const CLIENT_TIMEOUT_MS = 130_000;

export function isMatchingAllow(reply: unknown, nonce: string): boolean {
  if (typeof reply !== "object" || reply === null || Array.isArray(reply)) return false;
  const r = reply as Record<string, unknown>;
  return r.decision === "allow" && typeof r.nonce === "string" && r.nonce === nonce;
}

function post(
  port: number,
  token: string,
  payload: string,
  timeoutMs: number,
): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: string | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(v);
    };
    const req = request(
      {
        host: "127.0.0.1",
        port,
        method: "POST",
        path: "/hook",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload),
          [HOOK_TOKEN_HEADER]: token,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => done(res.statusCode === 200 ? Buffer.concat(chunks).toString() : null));
        res.on("error", () => done(null));
      },
    );
    const timer = setTimeout(() => {
      req.destroy();
      done(null);
    }, timeoutMs);
    req.on("error", () => done(null));
    req.end(payload);
  });
}

export async function runHookClient(o: HookClientOptions): Promise<0 | 2> {
  try {
    const token = readFileSync(join(o.root, HOOK_TOKEN_FILE), "utf8").trim();
    if (token.length === 0) return 2;
    let event: unknown;
    try {
      event = JSON.parse(o.stdin);
    } catch {
      event = { raw: o.stdin.slice(0, 4096) };
    }
    const nonce = randomBytes(16).toString("hex");
    const text = await post(
      o.port ?? HOOK_PORT,
      token,
      JSON.stringify({ nonce, event }),
      o.timeoutMs ?? CLIENT_TIMEOUT_MS,
    );
    if (text === null) return 2;
    let reply: unknown;
    try {
      reply = JSON.parse(text);
    } catch {
      return 2;
    }
    return isMatchingAllow(reply, nonce) ? 0 : 2;
  } catch {
    return 2;
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  const root = process.argv[2];
  if (root === undefined || root.length === 0) {
    process.exit(2);
  }
  readStdin()
    .then((stdin) => runHookClient({ root, stdin }))
    .then((code) => process.exit(code))
    .catch(() => process.exit(2));
}
