import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createHc,
  createObserveHc,
  decideHc,
  markPreflightPassed,
  readHcVersion,
} from "../lib/hc.ts";
import { newNonce, type OwnMarker, readMarker } from "../lib/own-marker.ts";
import { withBinDir } from "./support/bin-dir.ts";
import { fakeHcSource } from "./support/fake-hc.ts";

let dir = "";
let logFile = "";
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "wraith-hc-test-")));
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

function marker(): OwnMarker {
  return {
    v: 1,
    session: "wsp-q6",
    qs: ["q6"],
    root: dir,
    runnerPid: process.pid,
    startedAt: "2026-11-19T09:30:00.000Z",
    nonce: newNonce(),
    pids: [],
    agentFiles: [],
  };
}

const R110: string[][] = [
  ["server", "stop"],
  ["server", "restart"],
  ["server", "start"],
  ["terminal.create"],
  ["terminal.run", "x"],
  ["terminal.send", "x"],
  ["config", "set", "k", "v"],
];

describe("hc wrapper with the fake hc", () => {
  it("refuses normal mode before the runner marked preflight passed", async () => {
    await withBinDir({ hc: fakeHcSource({ version: "0.1.20", logFile }) }, async (env) => {
      const hc = createHc({
        mode: "normal",
        session: "wsp-q6",
        root: dir,
        baseEnv: env,
        marker: marker(),
      });
      await expect(hc.run(["server", "status"])).rejects.toThrow(/preflight/);
      expect(calls()).toEqual([]);
    });
  });

  it("observe mode runs server status only, with no HC_*, HERDR_* or XDG_* name", async () => {
    await withBinDir({ hc: fakeHcSource({ version: "0.1.20", logFile }) }, async (env) => {
      const hc = createObserveHc({
        baseEnv: { ...env, HC_SESSION: "default", HERDR_X: "1", HC_SCOPE: "s" },
      });
      const r = await hc.run(["server", "status"]);
      expect(r.code).toBe(0);
      expect(r.stdout).toContain("ok");
      expect(calls()).toEqual([{ argv: ["server", "status"], envNames: [] }]);
    });
  });

  it("observe mode refuses ls, ls --all and the seven R1.10 commands before anything runs", async () => {
    await withBinDir({ hc: fakeHcSource({ version: "0.1.20", logFile }) }, async (env) => {
      const hc = createObserveHc({ baseEnv: env });
      for (const args of [["ls"], ["ls", "--all"], ...R110]) {
        await expect(hc.run(args)).rejects.toThrow(/refused/);
      }
      expect(() => hc.spawnLong(["ls"])).toThrow(/refused/);
      expect(calls()).toEqual([]);
    });
  });

  it("normal mode refuses session default and records the started pid in the marker", async () => {
    await withBinDir({ hc: fakeHcSource({ version: "0.1.20", logFile }) }, async (env) => {
      markPreflightPassed();
      const bad = createHc({
        mode: "normal",
        session: "default",
        root: dir,
        baseEnv: env,
        marker: marker(),
      });
      await expect(bad.run(["server", "status"])).rejects.toThrow(/refused/);
      expect(calls()).toEqual([]);

      const m = marker();
      const hc = createHc({
        mode: "normal",
        session: "wsp-q6",
        root: dir,
        baseEnv: env,
        marker: m,
      });
      await expect(hc.run(["machine", "ls"])).rejects.toThrow(/refused/);
      expect((await hc.run(["server", "status"])).code).toBe(0);
      const logged = calls();
      expect(logged).toHaveLength(1);
      expect(logged[0]?.envNames).toEqual(["HC_SESSION", "XDG_CONFIG_HOME", "XDG_STATE_HOME"]);
      expect(m.pids).toHaveLength(1);
      expect(readMarker(dir)?.pids).toEqual(m.pids);
    });
  });

  it("readHcVersion reads the fake's version and returns null without hc", async () => {
    await withBinDir({ hc: fakeHcSource({ version: "0.1.20", logFile }) }, async (env) => {
      expect(await readHcVersion(env)).toBe("0.1.20");
      expect(calls()).toEqual([{ argv: ["--version"], envNames: [] }]);
    });
    await withBinDir({}, async (env) => {
      expect(await readHcVersion(env)).toBeNull();
    });
  });

  it("refuses remote targets in both modes and the fake's log stays empty", async () => {
    await withBinDir({ hc: fakeHcSource({ version: "0.1.20", logFile }) }, async (env) => {
      markPreflightPassed();
      const normal = createHc({
        mode: "normal",
        session: "wsp-q6",
        root: dir,
        baseEnv: env,
        marker: marker(),
      });
      const observe = createObserveHc({ baseEnv: env });
      const bad = [
        ["run", "--on", "vps", "ls"],
        ["run", "--on=vps", "ls"],
        ["terminal.send", "vps/t7", "x"],
        ["terminal.read", "--target=vps/t7"],
      ];
      for (const args of bad) {
        await expect(normal.run(args)).rejects.toThrow(/refused/);
        await expect(observe.run(args)).rejects.toThrow(/refused/);
      }
      await expect(observe.run(["server", "status", "--on", "vps"])).rejects.toThrow(/refused/);
      expect(() => normal.spawnLong(["run", "--on", "vps"])).toThrow(/refused/);
      expect(calls()).toEqual([]);
      const d = decideHc(["terminal.send", "vps/t7"], { mode: "normal", session: "wsp-q6" });
      expect(d.allow).toBe(false);
      if (!d.allow) expect(d.reason).not.toContain("vps");
    });
  });

  it("decideHc refuses a single-string command line", () => {
    expect(decideHc(["server stop"], { mode: "normal", session: "wsp-q6" }).allow).toBe(false);
    expect(decideHc(["server", "stop"], { mode: "normal", session: "wsp-q6" }).allow).toBe(true);
  });
});
