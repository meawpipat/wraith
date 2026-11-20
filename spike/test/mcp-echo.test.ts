import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MCP_TOKEN_HEADER, type McpEcho, startMcpEcho } from "../lib/mcp-echo.ts";

const TOKEN = "t".repeat(32);
let srv: McpEcho;

beforeEach(async () => {
  srv = await startMcpEcho({ token: TOKEN });
});
afterEach(async () => {
  await srv.close();
});

async function rpc(body: unknown, token: string | null = TOKEN): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== null) headers[MCP_TOKEN_HEADER] = token;
  return fetch(srv.url, { method: "POST", headers, body: JSON.stringify(body) });
}

describe("mcp-echo", () => {
  it("refuses a request without the token or with a wrong one", async () => {
    const none = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize" }, null);
    expect(none.status).toBe(401);
    const wrong = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize" }, "x");
    expect(wrong.status).toBe(401);
    expect(srv.calls()).toEqual([]);
  });

  it("answers initialize, tools/list and tools/call", async () => {
    const init = (await (await rpc({ jsonrpc: "2.0", id: 1, method: "initialize" })).json()) as {
      result: { capabilities: { tools: object } };
    };
    expect(init.result.capabilities.tools).toBeDefined();

    const list = (await (await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" })).json()) as {
      result: { tools: { name: string }[] };
    };
    expect(list.result.tools.map((t) => t.name)).toEqual(["echo"]);

    const call = await rpc({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "echo", arguments: { text: "hi" } },
    });
    expect(call.headers.get("content-type")).toContain("application/json");
    const body = (await call.json()) as { result: { content: { text: string }[] } };
    expect(body.result.content[0]?.text).toBe("hi");
  });

  it("records one tool call without the token", async () => {
    await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    await rpc({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "echo", arguments: { text: "hello" } },
    });
    const calls = srv.calls();
    expect(calls).toEqual([{ tool: "echo", argsLength: 16, headerPresent: true }]);
    expect(JSON.stringify(calls)).not.toContain(TOKEN);
  });

  it("binds 127.0.0.1 only", () => {
    expect(new URL(srv.url).hostname).toBe("127.0.0.1");
  });
});
