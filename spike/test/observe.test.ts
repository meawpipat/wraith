import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { liveMarkerExists, observeLockHeld, observeLockPath, runObserve } from "../lib/observe.ts";
import { newNonce, type OwnMarker, writeMarker } from "../lib/own-marker.ts";
import { withBinDir } from "./support/bin-dir.ts";
import { fakeHcSource } from "./support/fake-hc.ts";

let dir = "";
let roots = "";
let logFile = "";
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "wraith-observe-test-")));
  roots = join(dir, "hcw");
  mkdirSync(roots);
  logFile = join(dir, "calls.log");
  writeFileSync(logFile, "");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const calls = (): { argv: string[]; envNames: string[] }[] =>
  readFileSync(logFile, "utf8")
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => JSON.parse(l) as { argv: string[]; envNames: string[] });

function plantMarker(pid: number): void {
  const root = join(roots, "q6");
  mkdirSync(root);
  const m: OwnMarker = {
    v: 1,
    session: "wsp-q6",
    qs: ["q6"],
    root: realpathSync(root),
    runnerPid: pid,
    startedAt: "2026-11-19T09:30:00.000Z",
    nonce: newNonce(),
    pids: [],
    agentFiles: [],
  };
  writeMarker(m);
}

const io = (env: NodeJS.ProcessEnv, over: { in?: boolean; out?: boolean } = {}) => ({
  stdinIsTTY: over.in ?? true,
  stdoutIsTTY: over.out ?? true,
  baseEnv: env,
  rootsDir: roots,
  print: () => {},
});

describe("runObserve", () => {
  it("refuses a non-TTY run and starts nothing", async () => {
    await withBinDir({ hc: fakeHcSource({ version: "0.1.20", logFile }) }, async (env) => {
      for (const o of [{ in: false }, { out: false }]) {
        const r = await runObserve(io(env, o));
        expect(r).toEqual({ ok: false, reason: "needs interactive terminal" });
      }
      expect(calls()).toEqual([]);
      expect(existsSync(observeLockPath(roots))).toBe(false);
    });
  });

  it("refuses while a live Own_Marker exists, and ignores a dead one", async () => {
    await withBinDir({ hc: fakeHcSource({ version: "0.1.20", logFile }) }, async (env) => {
      plantMarker(process.pid);
      expect(liveMarkerExists(roots)).toBe(true);
      const r = await runObserve(io(env));
      expect(r.ok).toBe(false);
      expect(calls()).toEqual([]);
      expect(observeLockHeld(roots)).toBe(false);
      rmSync(join(roots, "q6"), { recursive: true, force: true });
      plantMarker(2 ** 22 + 12345);
      expect(liveMarkerExists(roots)).toBe(false);
    });
  });

  it("holds the lock during the run (another spike is refused) and removes it afterwards", async () => {
    await withBinDir({ hc: fakeHcSource({ version: "0.1.20", logFile }) }, async (env) => {
      let heldDuring = false;
      let second: unknown = null;
      const r = await runObserve({
        ...io(env),
        run: async () => {
          heldDuring = observeLockHeld(roots);
          second = await runObserve(io(env));
        },
      });
      expect(r).toEqual({ ok: true });
      expect(heldDuring).toBe(true);
      expect(second).toEqual({ ok: false, reason: "observe lock is held" });
      expect(observeLockHeld(roots)).toBe(false);
    });
  });

  it("removes the lock when the work throws", async () => {
    await withBinDir({ hc: fakeHcSource({ version: "0.1.20", logFile }) }, async (env) => {
      await expect(
        runObserve({
          ...io(env),
          run: async () => {
            throw new Error("boom");
          },
        }),
      ).rejects.toThrow("boom");
      expect(observeLockHeld(roots)).toBe(false);
    });
  });

  it("runs only `server status` and passes no HC_* or HERDR_* name to the fake", async () => {
    await withBinDir({ hc: fakeHcSource({ version: "0.1.20", logFile }) }, async (env) => {
      const r = await runObserve({
        ...io({ ...env, HC_SESSION: "default", HERDR_X: "1", HC_SCOPE: "s" }),
        run: async (hc) => {
          await hc.run(["server", "status"]);
          await expect(hc.run(["ls"])).rejects.toThrow(/refused/);
          await expect(hc.run(["server", "stop"])).rejects.toThrow(/refused/);
        },
      });
      expect(r.ok).toBe(true);
      const logged = calls();
      expect(logged).toHaveLength(1);
      expect(logged[0]?.argv).toEqual(["server", "status"]);
      expect(logged[0]?.envNames.filter((n) => /^(HC_|HERDR_)/.test(n))).toEqual([]);
    });
  });

  it("by default makes one `server status` call", async () => {
    await withBinDir({ hc: fakeHcSource({ version: "0.1.20", logFile }) }, async (env) => {
      expect(await runObserve(io(env))).toEqual({ ok: true });
      expect(calls().map((c) => c.argv)).toEqual([["server", "status"]]);
    });
  });
});
