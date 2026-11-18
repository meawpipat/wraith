import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MARKER_FILE,
  newNonce,
  type OwnMarker,
  pidAlive,
  readMarker,
  writeMarker,
} from "../lib/own-marker.ts";

let root = "";

function sample(over: Partial<OwnMarker> = {}): OwnMarker {
  return {
    v: 1,
    session: "wsp-q6",
    qs: ["q6"],
    root,
    runnerPid: process.pid,
    startedAt: "2026-11-19T09:30:00.000Z",
    nonce: newNonce(),
    pids: [4301],
    agentFiles: [],
    ...over,
  };
}

function writeRaw(m: unknown): void {
  writeFileSync(join(root, MARKER_FILE), JSON.stringify(m));
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "own-marker-")));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("own marker", () => {
  it("round-trips write then read", () => {
    const m = sample({ agentFiles: [{ path: "/x/wraith-spike-q6.json", created: true }] });
    writeMarker(m);
    expect(readMarker(root)).toEqual(m);
  });

  it("writes with mode 0600", () => {
    writeMarker(sample());
    expect(statSync(join(root, MARKER_FILE)).mode & 0o777).toBe(0o600);
  });

  it("reads null for a missing marker", () => {
    expect(readMarker(root)).toBeNull();
  });

  it("reads null for a bad session", () => {
    writeRaw(sample({ session: "default" }));
    expect(readMarker(root)).toBeNull();
  });

  it("reads null when root differs from the folder", () => {
    writeRaw(sample({ root: join(root, "other") }));
    expect(readMarker(root)).toBeNull();
  });

  it("reads null for an unknown spike id", () => {
    writeRaw(sample({ qs: ["q999"] }));
    expect(readMarker(root)).toBeNull();
  });

  it("reads null for a short nonce", () => {
    writeRaw(sample({ nonce: "abcd" }));
    expect(readMarker(root)).toBeNull();
  });

  it("pidAlive: own pid true, finished child false", () => {
    expect(pidAlive(process.pid)).toBe(true);
    const child = spawnSync(process.execPath, ["-e", "0"]);
    expect(child.pid).toBeGreaterThan(0);
    expect(pidAlive(child.pid)).toBe(false);
  });
});
