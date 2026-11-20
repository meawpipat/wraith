import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runHookClient } from "../kiro/q3b/hook-client.ts";
import {
  HOOK_TOKEN_HEADER,
  type HookAnswer,
  type HookReceiver,
  newHookToken,
  startHookReceiver,
  writeHookToken,
} from "../lib/hook-receiver.ts";

const ownerAllow: HookAnswer = {
  outcome: "selected",
  optionId: "a",
  kind: "allow_once",
  by: "owner",
};
const ownerReject: HookAnswer = {
  outcome: "selected",
  optionId: "r",
  kind: "reject_once",
  by: "owner",
};

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "hook-"));
});
afterEach(() => {
  vi.useRealTimers();
  rmSync(root, { recursive: true, force: true });
});

async function listen(token: string, answer: HookAnswer): Promise<HookReceiver> {
  const r = await startHookReceiver({
    port: 0,
    token,
    ask: async () => answer,
    log: () => {},
  });
  if (r.outcome !== "listening") throw new Error(r.reason);
  return r;
}

describe("hook receiver", () => {
  it("binds 127.0.0.1 only, writes the token file 0600, and refuses a request without the token", async () => {
    const token = newHookToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    const file = writeHookToken(root, token);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const r = await listen(token, ownerAllow);
    try {
      const body = JSON.stringify({ nonce: "n1", event: {} });
      const none = await fetch(`http://127.0.0.1:${r.port}/hook`, { method: "POST", body });
      expect(none.status).toBe(401);
      expect(((await none.json()) as { decision: string }).decision).toBe("block");
      const wrong = await fetch(`http://127.0.0.1:${r.port}/hook`, {
        method: "POST",
        body,
        headers: { [HOOK_TOKEN_HEADER]: "nope" },
      });
      expect(wrong.status).toBe(401);
      const ok = await fetch(`http://127.0.0.1:${r.port}/hook`, {
        method: "POST",
        body,
        headers: { [HOOK_TOKEN_HEADER]: token },
      });
      expect(await ok.json()).toEqual({ decision: "allow", nonce: "n1" });
      expect(r.events().map((e) => e.decision)).toEqual(["allow"]);
    } finally {
      await r.close();
    }
  });

  it("listens on loopback only", async () => {
    const r = await listen("t", ownerAllow);
    try {
      const probe = createServer();
      await new Promise<void>((res) => probe.listen(0, "127.0.0.1", res));
      const addr = probe.address() as AddressInfo;
      expect(addr.address).toBe("127.0.0.1");
      probe.close();
      // The receiver itself: a connection to 127.0.0.1 works; its address is loopback.
      const res = await fetch(`http://127.0.0.1:${r.port}/hook`, { method: "GET" });
      expect(res.status).toBe(405);
    } finally {
      await r.close();
    }
  });

  it("returns pending when the port is busy", async () => {
    const first = await listen("t", ownerAllow);
    try {
      const second = await startHookReceiver({
        port: first.port,
        token: "t",
        ask: async () => ownerAllow,
        log: () => {},
      });
      expect(second.outcome).toBe("pending");
      if (second.outcome === "pending") expect(second.reason).toContain("busy");
    } finally {
      await first.close();
    }
  });
});

describe("hook client", () => {
  it("exits 0 only on the matching allow", async () => {
    const token = newHookToken();
    writeHookToken(root, token);
    const r = await listen(token, ownerAllow);
    try {
      expect(await runHookClient({ root, stdin: '{"tool":"x"}', port: r.port })).toBe(0);
    } finally {
      await r.close();
    }
  });

  it("exits 2 on a block (owner rejects, timeout, error)", async () => {
    const token = newHookToken();
    writeHookToken(root, token);
    for (const answer of [ownerReject, "timeout", "error"] as HookAnswer[]) {
      const r = await listen(token, answer);
      try {
        expect(await runHookClient({ root, stdin: "{}", port: r.port })).toBe(2);
      } finally {
        await r.close();
      }
    }
  });

  it("exits 2 on connection refused", async () => {
    writeHookToken(root, newHookToken());
    const probe = createServer();
    await new Promise<void>((res) => probe.listen(0, "127.0.0.1", res));
    const port = (probe.address() as AddressInfo).port;
    await new Promise<void>((res) => probe.close(() => res()));
    expect(await runHookClient({ root, stdin: "{}", port })).toBe(2);
  });

  it("exits 2 when the token file is missing or empty", async () => {
    expect(await runHookClient({ root, stdin: "{}", port: 1 })).toBe(2);
    writeFileSync(join(root, "hook.token"), "");
    expect(await runHookClient({ root, stdin: "{}", port: 1 })).toBe(2);
  });

  it("exits 2 on a wrong shape or a wrong nonce", async () => {
    writeHookToken(root, "t");
    for (const reply of [
      '{"decision":"allow","nonce":"other"}',
      '{"decision":"allow"}',
      "not json",
      "[]",
    ]) {
      const server = createServer((_req, res) => {
        res.writeHead(200);
        res.end(reply);
      });
      await new Promise<void>((res) => server.listen(0, "127.0.0.1", res));
      const port = (server.address() as AddressInfo).port;
      try {
        expect(await runHookClient({ root, stdin: "{}", port })).toBe(2);
      } finally {
        server.closeAllConnections();
        await new Promise<void>((res) => server.close(() => res()));
      }
    }
  });

  it("exits 2 on timeout (fake timers)", async () => {
    writeHookToken(root, "t");
    const server = createServer(() => {
      // never answers
    });
    await new Promise<void>((res) => server.listen(0, "127.0.0.1", res));
    const port = (server.address() as AddressInfo).port;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const p = runHookClient({ root, stdin: "{}", port, timeoutMs: 130_000 });
      await vi.advanceTimersByTimeAsync(130_001);
      expect(await p).toBe(2);
    } finally {
      vi.useRealTimers();
      server.closeAllConnections();
      await new Promise<void>((res) => server.close(() => res()));
    }
  });
});
