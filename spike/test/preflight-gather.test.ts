import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type OwnMarker, writeMarker } from "../lib/own-marker.ts";
import { gatherPreflightInput } from "../lib/preflight.ts";
import { withBinDir } from "./support/bin-dir.ts";
import { fakeHcSource } from "./support/fake-hc.ts";

let prefix = "";

beforeEach(() => {
  prefix = mkdtempSync(join(tmpdir(), "wraith-gather-"));
});
afterEach(() => {
  rmSync(prefix, { recursive: true, force: true });
});

async function gather(q: string, version: string, home = "/home/u") {
  const logFile = join(prefix, "hc.log");
  const input = await withBinDir({ hc: fakeHcSource({ version, logFile }) }, (env) =>
    gatherPreflightInput(q, { ...env, HOME: home }, { rootPrefix: prefix }),
  );
  return { input, logFile };
}

function marker(root: string, runnerPid: number): OwnMarker {
  return {
    v: 1,
    session: "wsp-q2",
    qs: ["q2"],
    root,
    runnerPid,
    startedAt: new Date().toISOString(),
    nonce: "0".repeat(32),
    pids: [],
    agentFiles: [],
  };
}

describe("gatherPreflightInput", () => {
  it("reads 0.1.20 and accepts it for a non-Q1 spike; runs only hc --version", async () => {
    const { input, logFile } = await gather("q2", "0.1.20");
    expect(input.session).toBe("wsp-q2");
    expect(input.hcVersion).toBe("hc 0.1.20");
    expect(input.needsHcAtLeast).toEqual([0, 1, 18]);
    expect(input.rootState).toEqual({ kind: "absent" });
    expect(input.scriptTreeViolations).toEqual([]);
    const calls = readFileSync(logFile, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { argv: string[]; envNames: string[] });
    expect(calls).toEqual([{ argv: ["--version"], envNames: [] }]);
  });

  it("reports 0.1.17 below the minimum for q2 but not for q1", async () => {
    const q2 = await gather("q2", "0.1.17");
    expect(q2.input.needsHcAtLeast).toEqual([0, 1, 18]);
    expect(q2.input.hcVersion).toBe("hc 0.1.17");
    const q1 = await gather("q1", "0.1.17");
    expect(q1.input.needsHcAtLeast).toEqual([0, 1, 17]);
  });

  it("reports a root with a dead runner pid as stale", async () => {
    const root = join(prefix, "q2");
    mkdirSync(root);
    const dead = spawnSync(process.execPath, ["-e", ""]).pid;
    writeMarker(marker(realpathSync(root), dead ?? 0));
    const { input } = await gather("q2", "0.1.20");
    expect(input.rootState).toEqual({ kind: "stale", markerOk: true });
  });

  it("reports a root with a live runner pid as live", async () => {
    const root = join(prefix, "q2");
    mkdirSync(root);
    writeMarker(marker(realpathSync(root), process.pid));
    const { input } = await gather("q2", "0.1.20");
    expect(input.rootState).toEqual({ kind: "live" });
  });

  it("reports a root without a marker as foreign", async () => {
    mkdirSync(join(prefix, "q2"));
    const { input } = await gather("q2", "0.1.20");
    expect(input.rootState).toEqual({ kind: "foreign" });
  });
});
