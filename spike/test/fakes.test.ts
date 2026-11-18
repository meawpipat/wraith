import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { withBinDir } from "./support/bin-dir.ts";
import { FAKE_HC_SERVER_STATUS, fakeHcSource } from "./support/fake-hc.ts";
import { fakeKiroSource } from "./support/fake-kiro.ts";

function run(env: Record<string, string>, file: string, args: string[]): string {
  return execFileSync(file, args, { env, encoding: "utf8" });
}

describe("fake binaries", () => {
  it("fake hc logs argv and env names, prints the version and the server status", async () => {
    const logDir = mkdtempSync(join(tmpdir(), "wraith-fakelog-"));
    const logFile = join(logDir, "hc.log");
    try {
      await withBinDir({ hc: fakeHcSource({ version: "0.1.18", logFile }) }, (env) => {
        const childEnv = {
          ...env,
          HC_SESSION: "secret-session-value",
          HERDR_TOKEN: "secret-token-value",
          XDG_RUNTIME_DIR: "/secret/xdg/value",
          OTHER_VAR: "secret-other-value",
        };
        expect(run(childEnv, "hc", ["--version"])).toBe("hc 0.1.18\n");
        expect(run(childEnv, "hc", ["server", "status"])).toBe(FAKE_HC_SERVER_STATUS);
      });
      const text = readFileSync(logFile, "utf8");
      const lines = text
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l) as { argv: string[]; envNames: string[] });
      expect(lines.map((l) => l.argv)).toEqual([["--version"], ["server", "status"]]);
      expect(lines[0]?.envNames).toEqual(["HC_SESSION", "HERDR_TOKEN", "XDG_RUNTIME_DIR"]);
      expect(text).not.toMatch(/secret|OTHER_VAR/);
    } finally {
      rmSync(logDir, { recursive: true, force: true });
    }
  });

  it("fake kiro-cli prints its version and the supplied help text; the temp folder is removed", async () => {
    let seen = "";
    await withBinDir(
      { "kiro-cli": fakeKiroSource({ version: "2.0.1", listSessionsHelp: "help text\n" }) },
      (env, dir) => {
        seen = dir;
        expect(existsSync(dir)).toBe(true);
        expect(run(env, "kiro-cli", ["--version"])).toBe("kiro-cli 2.0.1\n");
        expect(run(env, "kiro-cli", ["chat", "--list-sessions", "--help"])).toBe("help text\n");
      },
    );
    expect(seen).not.toBe("");
    expect(existsSync(seen)).toBe(false);
  });
});
