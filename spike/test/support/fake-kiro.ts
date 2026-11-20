export interface FakeKiroOptions {
  /** Printed for `--version` as `kiro-cli <version>`. */
  readonly version: string;
  /** Printed for `chat --list-sessions --help`. */
  readonly listSessionsHelp: string;
  /** JSON-lines file the fake appends its records to (argv, env names, answers). */
  readonly logFile?: string;
  /** Names accepted after `--agent`; any other name exits 1 (Q43 `FAIL` path). Omit to accept all. */
  readonly acceptedAgents?: readonly string[];
  /** When true, `session/load` replays updates with ids that differ from the earlier replay (Q23). */
  readonly changeReplayIds?: boolean;
  /** When false, no `session/request_permission` is sent (Q43 `FAIL`: no request arrives). Default true. */
  readonly askPermission?: boolean;
}

/**
 * Fake `kiro-cli`: `--version`, `chat --list-sessions --help`, and a small ACP agent for
 * `acp [--agent-engine v3] [--agent <name>]` speaking newline-delimited JSON-RPC on stdio.
 * It never reads the real `~/.kiro`. Log records (one JSON per line, when `logFile` is set):
 * `argv`, `env` (names only), `permission` (the answer received), `tool` (whether it ran),
 * `terminal` (method), `mcp` (HTTP status), `prompt` (number).
 */
export function fakeKiroSource(opts: FakeKiroOptions): string {
  const config = {
    version: opts.version,
    listSessionsHelp: opts.listSessionsHelp,
    logFile: opts.logFile ?? null,
    acceptedAgents: opts.acceptedAgents ?? null,
    changeReplayIds: opts.changeReplayIds ?? false,
    askPermission: opts.askPermission ?? true,
  };
  return `const CONFIG = ${JSON.stringify(config)};\n${ACP_BODY}`;
}

const ACP_BODY = String.raw`const fs = require("node:fs");
const argv = process.argv.slice(2);

function log(record) {
  if (CONFIG.logFile) fs.appendFileSync(CONFIG.logFile, JSON.stringify(record) + "\n");
}

if (argv.length === 1 && argv[0] === "--version") {
  process.stdout.write("kiro-cli " + CONFIG.version + "\n");
} else if (argv.join(" ") === "chat --list-sessions --help") {
  process.stdout.write(CONFIG.listSessionsHelp);
} else if (argv[0] === "acp") {
  runAcp();
}

function runAcp() {
  log({ kind: "argv", argv });
  log({
    kind: "env",
    names: Object.keys(process.env)
      .filter((n) => /^(HC_|HERDR_|XDG_)/.test(n))
      .sort(),
  });
  const agentAt = argv.indexOf("--agent");
  if (agentAt >= 0) {
    const name = argv[agentAt + 1];
    if (CONFIG.acceptedAgents && !CONFIG.acceptedAgents.includes(name)) {
      process.stderr.write("unknown agent: " + name + "\n");
      process.exit(1);
    }
  }

  let nextOutId = 1;
  let sessionCount = 0;
  let loadCount = 0;
  let terminalDeclared = false;
  const sessions = new Map();
  const pending = new Map();
  let buffer = "";

  function send(message) {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
  }
  function notify(sessionId, update) {
    send({ method: "session/update", params: { sessionId, update } });
  }
  function request(method, params) {
    const id = "agent-" + nextOutId++;
    return new Promise((resolve) => {
      pending.set(id, resolve);
      send({ id, method, params });
    });
  }
  function commands(sessionId) {
    notify(sessionId, {
      sessionUpdate: "available_commands_update",
      availableCommands: [{ name: "status", description: "Show status" }],
    });
  }
  function fail(id, code, message) {
    send({ id, error: { code, message } });
  }
  function exitAfterFlush(code) {
    process.stdout.write("", () => process.exit(code));
  }

  async function callMcp(session) {
    const server = (session.mcpServers || []).find((s) => s && s.type === "http");
    if (!server) return;
    const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };
    for (const h of server.headers || []) headers[h.name] = h.value;
    try {
      const res = await fetch(server.url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "echo", arguments: { text: "hi" } },
        }),
      });
      log({ kind: "mcp", name: server.name, status: res.status });
    } catch (error) {
      log({ kind: "mcp", name: server.name, error: String(error && error.message) });
    }
  }

  async function firstPrompt(id, sessionId, session) {
    notify(sessionId, {
      sessionUpdate: "agent_message_chunk",
      messageId: "m-" + sessionId + "-1",
      content: { type: "text", text: "working" },
    });
    await callMcp(session);
    if (terminalDeclared) {
      for (const method of ["terminal/create", "terminal/output"]) {
        const params = method === "terminal/create"
          ? { sessionId, command: "echo", args: ["hi"] }
          : { sessionId, terminalId: "t-1" };
        log({ kind: "terminal", method });
        await request(method, params);
      }
    }
    let status = "completed";
    if (CONFIG.askPermission) {
      const options = [
        { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
        { optionId: "reject-once", name: "Reject", kind: "reject_once" },
      ];
      notify(sessionId, {
        sessionUpdate: "tool_call",
        toolCallId: "tc-1",
        title: "read file",
        kind: "read",
        status: "pending",
      });
      const answer = await request("session/request_permission", {
        sessionId,
        toolCall: { toolCallId: "tc-1", title: "read file", kind: "read" },
        options,
      });
      const outcome = answer && answer.result && answer.result.outcome;
      log({ kind: "permission", answer: outcome === undefined ? null : outcome });
      const chosen = outcome && outcome.outcome === "selected"
        ? options.find((o) => o.optionId === outcome.optionId)
        : undefined;
      const cancelled = outcome && outcome.outcome === "cancelled";
      if (!chosen && !cancelled) {
        fail(id, -32602, "unrecognised permission answer");
        exitAfterFlush(3);
        return false;
      }
      const ran = Boolean(chosen && chosen.kind === "allow_once");
      log({ kind: "tool", ran });
      status = ran ? "completed" : "failed";
      notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "tc-1", status });
    }
    return true;
  }

  async function onRequest(msg) {
    const p = msg.params || {};
    if (msg.method === "initialize") {
      terminalDeclared = Boolean(p.clientCapabilities && p.clientCapabilities.terminal);
      send({
        id: msg.id,
        result: {
          protocolVersion: 1,
          agentCapabilities: {
            loadSession: true,
            mcpCapabilities: { http: true, sse: false },
          },
          authMethods: [],
          _meta: { clientTerminal: terminalDeclared },
        },
      });
    } else if (msg.method === "session/new") {
      const sessionId = "sess-" + ++sessionCount;
      sessions.set(sessionId, { mcpServers: p.mcpServers || [], prompts: 0 });
      send({ id: msg.id, result: { sessionId } });
      commands(sessionId);
    } else if (msg.method === "session/load") {
      const session = sessions.get(p.sessionId);
      if (!session) return fail(msg.id, -32602, "unknown session");
      if (p.mcpServers) session.mcpServers = p.mcpServers;
      loadCount++;
      const tag = CONFIG.changeReplayIds ? "-r" + loadCount : "";
      notify(p.sessionId, {
        sessionUpdate: "user_message_chunk",
        content: { type: "text", text: "earlier prompt" },
      });
      notify(p.sessionId, {
        sessionUpdate: "agent_message_chunk",
        messageId: "m-" + p.sessionId + "-1" + tag,
        content: { type: "text", text: "working" },
      });
      notify(p.sessionId, {
        sessionUpdate: "tool_call",
        toolCallId: "tc-1" + tag,
        title: "read file",
        kind: "read",
        status: "completed",
      });
      send({ id: msg.id, result: {} });
      commands(p.sessionId);
    } else if (msg.method === "session/prompt") {
      const session = sessions.get(p.sessionId);
      if (!session) return fail(msg.id, -32602, "unknown session");
      session.prompts++;
      log({ kind: "prompt", number: session.prompts });
      if (session.prompts === 1) {
        if (!(await firstPrompt(msg.id, p.sessionId, session))) return;
      } else {
        notify(p.sessionId, {
          sessionUpdate: "agent_message_chunk",
          messageId: "m-" + p.sessionId + "-" + session.prompts,
          content: { type: "text", text: "second" },
        });
      }
      send({ id: msg.id, result: { stopReason: "end_turn" } });
    } else {
      fail(msg.id, -32601, "method not found: " + msg.method);
    }
  }

  function onLine(line) {
    if (!line.trim()) return;
    const msg = JSON.parse(line);
    if (msg.method === undefined && msg.id !== undefined) {
      const resolve = pending.get(msg.id);
      if (resolve) {
        pending.delete(msg.id);
        resolve(msg);
      }
    } else if (msg.id !== undefined) {
      void onRequest(msg);
    }
  }

  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    let at;
    while ((at = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, at);
      buffer = buffer.slice(at + 1);
      onLine(line);
    }
  });
  process.stdin.on("end", () => process.exit(0));
}
`;
