import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/** Header the agent must send (the same name the hook receiver uses). */
export const MCP_TOKEN_HEADER = "x-wraith-spike-token";

const MAX_BODY = 64 * 1024;
const PROTOCOL_VERSION = "2025-03-26";

export interface McpCall {
  /** The tool name from `tools/call` params. */
  tool: string;
  /** Length of the JSON-encoded `arguments`. */
  argsLength: number;
  /** True when the token header was present on the request (the value is never kept). */
  headerPresent: boolean;
}

export interface McpEcho {
  url: string;
  calls(): McpCall[];
  close(): Promise<void>;
}

function tokenMatches(given: string | undefined, expected: string): boolean {
  if (given === undefined || expected.length === 0) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
}

function rpcError(id: unknown, code: number, message: string): unknown {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(null));
  });
}

const ECHO_TOOL = {
  name: "echo",
  description: "Returns the text it was given.",
  inputSchema: {
    type: "object",
    properties: { text: { type: "string" } },
    additionalProperties: false,
  },
};

/** Minimal MCP server over HTTP on 127.0.0.1 (random port); plain JSON replies, token header required. */
export async function startMcpEcho(i: { token: string }): Promise<McpEcho> {
  const recorded: McpCall[] = [];

  const server = createServer((req, res) => {
    void (async () => {
      const header = req.headers[MCP_TOKEN_HEADER];
      const given = typeof header === "string" ? header : undefined;
      if (!tokenMatches(given, i.token)) {
        sendJson(res, 401, rpcError(null, -32001, "unauthorized"));
        req.resume();
        return;
      }
      if (req.method !== "POST") {
        sendJson(res, 405, rpcError(null, -32600, "POST only"));
        req.resume();
        return;
      }
      const raw = await readBody(req);
      if (raw === null) {
        sendJson(res, 413, rpcError(null, -32600, "body too large"));
        return;
      }
      let msg: unknown;
      try {
        msg = JSON.parse(raw);
      } catch {
        sendJson(res, 400, rpcError(null, -32700, "parse error"));
        return;
      }
      if (typeof msg !== "object" || msg === null || Array.isArray(msg)) {
        sendJson(res, 400, rpcError(null, -32600, "invalid request"));
        return;
      }
      const m = msg as { id?: unknown; method?: unknown; params?: unknown };
      const id = m.id;
      if (id === undefined) {
        // A notification (for example notifications/initialized): accepted, no body.
        res.writeHead(202);
        res.end();
        return;
      }
      switch (m.method) {
        case "initialize":
          sendJson(res, 200, {
            jsonrpc: "2.0",
            id,
            result: {
              protocolVersion: PROTOCOL_VERSION,
              capabilities: { tools: {} },
              serverInfo: { name: "wraith-spike-mcp-echo", version: "0.0.0" },
            },
          });
          return;
        case "tools/list":
          sendJson(res, 200, { jsonrpc: "2.0", id, result: { tools: [ECHO_TOOL] } });
          return;
        case "tools/call": {
          const p = (typeof m.params === "object" && m.params !== null ? m.params : {}) as {
            name?: unknown;
            arguments?: unknown;
          };
          const tool = typeof p.name === "string" ? p.name : "";
          const args = p.arguments ?? {};
          recorded.push({
            tool,
            argsLength: JSON.stringify(args).length,
            headerPresent: given !== undefined,
          });
          if (tool !== "echo") {
            sendJson(res, 200, rpcError(id, -32602, "unknown tool"));
            return;
          }
          const text = (args as { text?: unknown }).text;
          sendJson(res, 200, {
            jsonrpc: "2.0",
            id,
            result: { content: [{ type: "text", text: typeof text === "string" ? text : "" }] },
          });
          return;
        }
        default:
          sendJson(res, 200, rpcError(id, -32601, "method not found"));
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const port = (server.address() as AddressInfo).port;

  return {
    url: `http://127.0.0.1:${port}/mcp`,
    calls: () => recorded.map((c) => ({ ...c })),
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
