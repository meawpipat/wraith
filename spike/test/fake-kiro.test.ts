import { type ChildProcessWithoutNullStreams, spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { withBinDir } from "./support/bin-dir.ts";
import { type FakeKiroOptions, fakeKiroSource } from "./support/fake-kiro.ts";

interface LogRecord {
  kind?: string;
  names?: string[];
}

interface Msg {
  id?: number | string | undefined;
  method?: string;
  // biome-ignore lint/suspicious/noExplicitAny: loosely typed JSON-RPC test frames
  params?: any;
  // biome-ignore lint/suspicious/noExplicitAny: loosely typed JSON-RPC test frames
  result?: any;
  error?: unknown;
}

class Client {
  readonly messages: Msg[] = [];
  private buffer = "";
  private waiters: Array<() => void> = [];
  constructor(readonly child: ChildProcessWithoutNullStreams) {
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      this.buffer += chunk;
      let at = this.buffer.indexOf("\n");
      while (at >= 0) {
        this.messages.push(JSON.parse(this.buffer.slice(0, at)));
        this.buffer = this.buffer.slice(at + 1);
        at = this.buffer.indexOf("\n");
      }
      for (const w of this.waiters.splice(0)) w();
    });
  }
  write(m: Msg): void {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...m })}\n`);
  }
  async until(pred: (m: Msg) => boolean): Promise<Msg> {
    for (;;) {
      const found = this.messages.find(pred);
      if (found) return found;
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
        setTimeout(resolve, 2000);
      });
      if (!this.child.stdout.readable && !this.messages.find(pred)) throw new Error("closed");
    }
  }
}

async function withAcp<T>(
  opts: Partial<FakeKiroOptions>,
  args: string[],
  fn: (c: Client, log: () => Promise<LogRecord[]>) => Promise<T>,
): Promise<T> {
  const tmp = await mkdtemp(join(tmpdir(), "wraith-fk-"));
  const logFile = join(tmp, "log.jsonl");
  try {
    return await withBinDir(
      {
        "kiro-cli": fakeKiroSource({ version: "2.0.1", listSessionsHelp: "", logFile, ...opts }),
      },
      async (env, dir) => {
        const child = spawn(join(dir, "kiro-cli"), ["acp", ...args], { env, shell: false });
        const client = new Client(child);
        try {
          return await fn(client, async () =>
            (await readFile(logFile, "utf8").catch(() => ""))
              .split("\n")
              .filter(Boolean)
              .map((l) => JSON.parse(l)),
          );
        } finally {
          child.kill();
        }
      },
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

async function open(c: Client, terminal: boolean): Promise<string> {
  c.write({
    id: 1,
    method: "initialize",
    params: { protocolVersion: 1, clientCapabilities: { terminal } },
  });
  await c.until((m) => m.id === 1);
  c.write({ id: 2, method: "session/new", params: { cwd: "/tmp", mcpServers: [] } });
  const res = await c.until((m) => m.id === 2);
  return res.result.sessionId as string;
}

describe("fake-kiro ACP", () => {
  it("echoes the terminal flag, sends commands, and runs the tool only after allow_once", async () => {
    await withAcp({}, ["--agent-engine", "v3"], async (c, log) => {
      c.write({ id: 1, method: "initialize", params: { clientCapabilities: { terminal: true } } });
      const init = await c.until((m) => m.id === 1);
      expect(init.result._meta.clientTerminal).toBe(true);
      expect(init.result.agentCapabilities.mcpCapabilities).toBeDefined();
      c.write({ id: 2, method: "session/new", params: { cwd: "/tmp", mcpServers: [] } });
      const sid = (await c.until((m) => m.id === 2)).result.sessionId;
      await c.until((m) => m.params?.update?.sessionUpdate === "available_commands_update");
      c.write({ id: 3, method: "session/prompt", params: { sessionId: sid, prompt: [] } });
      for (const method of ["terminal/create", "terminal/output"]) {
        const req = await c.until((m) => m.method === method);
        c.write({ id: req.id, error: { code: -32601, message: "no" } });
      }
      const perm = await c.until((m) => m.method === "session/request_permission");
      expect(perm.params.options.length).toBeGreaterThan(1);
      c.write({
        id: perm.id,
        result: { outcome: { outcome: "selected", optionId: "allow-once" } },
      });
      await c.until((m) => m.id === 3);
      const records = await log();
      expect(records).toContainEqual({ kind: "tool", ran: true });
      expect(records.filter((r) => r.kind === "terminal")).toHaveLength(2);
      expect(records.find((r) => r.kind === "env")?.names).toEqual([]);
      c.write({ id: 4, method: "session/prompt", params: { sessionId: sid, prompt: [] } });
      expect((await c.until((m) => m.id === 4)).result.stopReason).toBe("end_turn");
    });
  });

  it("does not run the tool on reject_once and exits on an answer it did not offer", async () => {
    await withAcp({}, [], async (c, log) => {
      const sid = await open(c, false);
      c.write({ id: 3, method: "session/prompt", params: { sessionId: sid, prompt: [] } });
      const perm = await c.until((m) => m.method === "session/request_permission");
      c.write({
        id: perm.id,
        result: { outcome: { outcome: "selected", optionId: "reject-once" } },
      });
      await c.until((m) => m.id === 3);
      expect(await log()).toContainEqual({ kind: "tool", ran: false });
    });
    await withAcp({}, [], async (c, log) => {
      const sid = await open(c, false);
      c.write({ id: 3, method: "session/prompt", params: { sessionId: sid, prompt: [] } });
      const perm = await c.until((m) => m.method === "session/request_permission");
      c.write({ id: perm.id, result: { outcome: { outcome: "selected", optionId: "bogus" } } });
      expect((await c.until((m) => m.id === 3)).error).toBeDefined();
      expect((await log()).some((r) => r.kind === "tool")).toBe(false);
    });
  });

  it("replays stable ids on load, or changed ids when asked", async () => {
    const replayIds = async (changeReplayIds: boolean): Promise<string[][]> =>
      withAcp({ changeReplayIds }, [], async (c) => {
        const sid = await open(c, false);
        const out: string[][] = [];
        for (const id of [10, 11]) {
          const from = c.messages.length;
          c.write({ id, method: "session/load", params: { sessionId: sid, cwd: "/tmp" } });
          await c.until((m) => m.id === id);
          out.push(
            c.messages
              .slice(from)
              .map((m) => m.params?.update)
              .filter((u) => u?.messageId || u?.toolCallId)
              .map((u) => u.messageId ?? u.toolCallId),
          );
        }
        return out;
      });
    const stable = await replayIds(false);
    expect(stable[0]).toEqual(stable[1]);
    const changed = await replayIds(true);
    expect(changed[0]).not.toEqual(changed[1]);
  });

  it("rejects an agent name outside the accepted list and accepts the listed one", async () => {
    const run = (name: string): Promise<number | null> =>
      withBinDir(
        {
          "kiro-cli": fakeKiroSource({
            version: "1",
            listSessionsHelp: "",
            acceptedAgents: ["ok"],
          }),
        },
        (env, dir) =>
          spawnSync(join(dir, "kiro-cli"), ["acp", "--agent", name], {
            env,
            input: "",
            timeout: 5000,
          }).status,
      );
    expect(await run("bad")).toBe(1);
    expect(await run("ok")).toBe(0);
  });
});
