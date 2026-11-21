import { describe, expect, it } from "vitest";
import { defaultRunKiro, hasJsonOption, judgeQ7, NO_JSON_BRANCH, run } from "../../kiro/q7/q7.ts";
import { readSpikeMeta } from "../../lib/meta.ts";
import type { SpikeContext } from "../../lib/outcome.ts";
import { withBinDir } from "../support/bin-dir.ts";
import { fakeKiroSource } from "../support/fake-kiro.ts";

const WITH_JSON =
  "Usage: kiro-cli chat --list-sessions\n  --format <FORMAT>  Output format [possible values: plain, json]\n";
const WITHOUT_JSON = "Usage: kiro-cli chat --list-sessions\n  --verbose  More output\n";

function makeCtx(env: Record<string, string>): { ctx: SpikeContext; files: Map<string, string> } {
  const files = new Map<string, string>();
  const ctx = {
    q: "q7",
    env: () => env,
    evidence: {
      async addText(name: string, text: string) {
        files.set(name, text);
      },
    },
  } as unknown as SpikeContext;
  return { ctx, files };
}

// Real fake binary on PATH; the spike runs it through its default runner.
async function runWithHelp(help: string) {
  return withBinDir(
    { "kiro-cli": fakeKiroSource({ version: "2.0.1", listSessionsHelp: help }) },
    async (env) => {
      const { ctx, files } = makeCtx(env);
      const calls: string[][] = [];
      const out = await run(ctx, async (args, e) => {
        calls.push([...args]);
        return defaultRunKiro(args, e);
      });
      return { out, files, calls };
    },
  );
}

describe("Q7 helpers", () => {
  it("has a valid metadata block", () => {
    const m = readSpikeMeta("q7");
    expect(m.ok && m.meta.cost).toBe("none");
    expect(m.ok && m.meta.maxPrompts).toBe(0);
    expect(m.ok && m.meta.maxWallSeconds).toBe(300);
  });
  it("detects a JSON option only on a --format line", () => {
    expect(hasJsonOption(WITH_JSON)).toBe(true);
    expect(hasJsonOption(WITHOUT_JSON)).toBe(false);
    expect(hasJsonOption("json is nice\n--format text")).toBe(false);
    expect(judgeQ7("", "").branch).toBe(NO_JSON_BRANCH);
  });
});

describe("Q7 script (fake kiro-cli)", () => {
  it("passes when the help offers --format json, running only help commands", async () => {
    const { out, files, calls } = await runWithHelp(WITH_JSON);
    expect(out.result).toBe("PASS");
    expect(out.promptsSent).toBe(0);
    expect(calls).toEqual([
      ["chat", "--list-sessions", "--help"],
      ["chat", "--list-sessions", "--format", "json", "--help"],
    ]);
    expect(calls.every((c) => c.at(-1) === "--help")).toBe(true);
    expect([...files.keys()].sort()).toEqual([
      "help-format-json.txt",
      "help-plain.txt",
      "summary.json",
    ]);
    expect(files.get("help-plain.txt")).toContain("--format <FORMAT>");
  });
  it("fails with the ACP session/list branch when no JSON option exists", async () => {
    const { out } = await runWithHelp(WITHOUT_JSON);
    expect(out.result).toBe("FAIL");
    expect(out.branch).toBe(NO_JSON_BRANCH);
  });
  it("replaces a help line that holds an imported SI token", async () => {
    // Token built from fragments so no unsafe token is spelled in this file.
    const unsafe = ["--trust", "all", "tools"].join("-");
    const help = `${WITH_JSON}  ${unsafe}  skip every prompt\n`;
    const { out, files } = await runWithHelp(help);
    expect(out.result).toBe("PASS");
    const text = files.get("help-plain.txt") ?? "";
    expect(text).not.toContain(unsafe);
    expect(text).toContain("[REDACTED-LINE:si-token]");
    expect(text).toContain("--format <FORMAT>");
  });
  it("stays pending when kiro-cli is not found", async () => {
    const { ctx } = makeCtx({ PATH: "/nonexistent-wraith-dir" });
    const out = await run(ctx);
    expect(out.result).toBe("pending");
    expect(out.reason).toContain("kiro-cli");
  });
});
