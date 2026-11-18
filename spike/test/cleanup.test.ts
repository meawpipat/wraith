import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupRun, planDeletion } from "../lib/cleanup.ts";
import type { Hc, HcResult } from "../lib/hc.ts";
import { newNonce, type OwnMarker } from "../lib/own-marker.ts";

let prefix = "";
let root = "";

function marker(over: Partial<OwnMarker> = {}): OwnMarker {
  return {
    v: 1,
    session: "wsp-q6",
    qs: ["q6"],
    root,
    runnerPid: process.pid,
    startedAt: "2026-11-19T09:30:00.000Z",
    nonce: newNonce(),
    pids: [],
    agentFiles: [],
    ...over,
  };
}

function stubHc(): Hc {
  const ok: HcResult = { code: 0, stdout: "{}", stderr: "", ms: 0 };
  return {
    session: "wsp-q6",
    mode: "normal",
    run: async () => ok,
    spawnLong: () => {
      throw new Error("not used");
    },
  };
}

beforeEach(() => {
  prefix = realpathSync(mkdtempSync(join(tmpdir(), "cl-")));
  root = join(prefix, "run");
  mkdirSync(root);
});

afterEach(() => {
  rmSync(prefix, { recursive: true, force: true });
});

describe("planDeletion", () => {
  it("allows paths under a root with a valid marker", () => {
    const p = join(root, "a", "b");
    const plan = planDeletion(root, marker(), [p, root, join(prefix, "other")], [prefix]);
    expect(plan.delete).toEqual([p]);
    expect(plan.refuse.map((r) => r.path)).toEqual([root, join(prefix, "other")]);
  });

  it("deletes nothing without a marker or with a mismatched one", () => {
    const p = join(root, "a");
    expect(planDeletion(root, null, [p], [prefix]).delete).toEqual([]);
    expect(planDeletion(root, marker({ root: join(prefix, "x") }), [p], [prefix]).delete).toEqual(
      [],
    );
  });

  it("refuses a root outside the allowed prefix, and `..`, empty and relative paths", () => {
    const p = join(root, "a");
    expect(planDeletion(root, marker(), [p], [join(prefix, "elsewhere")]).delete).toEqual([]);
    const plan = planDeletion(root, marker(), ["", "a/b", `${root}/../run/a`], [prefix]);
    expect(plan.delete).toEqual([]);
    expect(plan.refuse).toHaveLength(3);
  });
});

describe("cleanupRun", () => {
  it("deletes a root with a valid marker", async () => {
    writeFileSync(join(root, "file"), "x");
    const r = await cleanupRun({
      hc: stubHc(),
      marker: marker(),
      children: [],
      rootPrefixes: [prefix],
    });
    expect(r).toEqual({ stopped: true, removed: true });
    expect(existsSync(root)).toBe(false);
  });

  it("does not delete a root outside the allowed prefix", async () => {
    const r = await cleanupRun({
      hc: null,
      marker: marker(),
      children: [],
      rootPrefixes: [join(prefix, "elsewhere")],
    });
    expect(r.removed).toBe(false);
    expect(existsSync(root)).toBe(true);
  });

  it("refuses a symlinked root", async () => {
    const target = join(prefix, "target");
    mkdirSync(target);
    writeFileSync(join(target, "keep"), "x");
    const link = join(prefix, "link");
    symlinkSync(target, link);
    const r = await cleanupRun({
      hc: null,
      marker: marker({ root: link }),
      children: [],
      rootPrefixes: [prefix],
    });
    expect(r.removed).toBe(false);
    expect(existsSync(join(target, "keep"))).toBe(true);
  });

  it("removes the agent files in the marker and no other file in their folder", async () => {
    const dir = join(prefix, "agents");
    mkdirSync(dir);
    const mine = join(dir, "wraith-spike-q6.json");
    const other = join(dir, "wraith-keep.json");
    writeFileSync(mine, "{}");
    writeFileSync(other, "{}");
    await cleanupRun({
      hc: null,
      marker: marker({ agentFiles: [{ path: mine, created: true }] }),
      children: [],
      rootPrefixes: [prefix],
    });
    expect(existsSync(mine)).toBe(false);
    expect(existsSync(other)).toBe(true);
  });

  describe("with a core that stays up", () => {
    let server: Server | null = null;
    afterEach(() => {
      server?.close();
      server = null;
    });

    it("leaves the root and returns stopped:false", async () => {
      const sock = join(prefix, "s");
      server = createServer();
      await new Promise<void>((resolve) => server?.listen(sock, resolve));
      const lines: string[] = [];
      const r = await cleanupRun({
        hc: stubHc(),
        marker: marker(),
        children: [],
        socketPath: sock,
        rootPrefixes: [prefix],
        waitMs: 10,
        log: (l) => lines.push(l),
      });
      expect(r).toEqual({ stopped: false, removed: false });
      expect(existsSync(root)).toBe(true);
      expect(lines.join("\n")).toContain(root);
    });
  });
});
