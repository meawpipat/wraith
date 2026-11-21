import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findUnsafeToken, UNSAFE_GROUPS, UNSAFE_TOKENS } from "../lib/unsafe-tokens.ts";

// Example tests for the SI hook scanners. Unsafe samples come only from `samples`
// of UNSAFE_TOKENS; no unsafe token is spelled in this file.
// Validates: Requirements 12.3, 12.4, 12.5, 12.7, 12.8

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TRUST_ALL = "no-trust-all";
const AUTO_APPROVE = "no-auto-approve";

function run(
  script: string,
  args: string[],
  input?: string,
): { code: number; out: string; err: string } {
  const r = spawnSync("node", ["--experimental-strip-types", `tools/${script}.ts`, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    ...(input === undefined ? {} : { input }),
  });
  return { code: r.status ?? -1, out: r.stdout, err: r.stderr };
}

function hook(script: string, payload: unknown): number {
  return run(script, ["--hook-stdin"], JSON.stringify(payload)).code;
}

function firstSample(group: (typeof UNSAFE_GROUPS)[number]): string {
  const s = UNSAFE_TOKENS[group][0]?.samples[0];
  if (s === undefined) throw new Error("no sample");
  return s;
}

const WRITE_TOOLS = ["fsWrite", "fs_write", "fsAppend", "fs_append", "strReplace", "str_replace"];
const SHELL_TOOLS = ["executeBash", "execute_bash"];
const PRODUCT_PATH = "apps/node/src/index.ts";
const ARGV_SAMPLE = firstSample("argvFlags");
const ENV_SAMPLE = firstSample("envNames");

describe("hook-stdin through the CLIs", () => {
  for (const tool of WRITE_TOOLS) {
    it(`blocks a sample in ${tool} content for both hooks and passes clean text`, () => {
      const bad = { tool_name: tool, tool_input: { path: PRODUCT_PATH, text: ARGV_SAMPLE } };
      const clean = { tool_name: tool, tool_input: { path: PRODUCT_PATH, text: "const a = 1;" } };
      for (const h of [TRUST_ALL, AUTO_APPROVE]) {
        expect(hook(h, bad)).toBe(2);
        expect(hook(h, clean)).toBe(0);
      }
    });
  }

  it("accepts snake_case path keys and a sample written directly in tool_input", () => {
    const direct = {
      tool_name: "fs_write",
      tool_input: { file_path: PRODUCT_PATH, content: ARGV_SAMPLE },
    };
    expect(hook(TRUST_ALL, direct)).toBe(2);
    expect(hook(AUTO_APPROVE, direct)).toBe(2);
  });

  it("does not echo the matched text on stderr", () => {
    const r = run(
      TRUST_ALL,
      ["--hook-stdin"],
      JSON.stringify({
        tool_name: "fsWrite",
        tool_input: { path: PRODUCT_PATH, text: ARGV_SAMPLE },
      }),
    );
    expect(r.code).toBe(2);
    expect(r.err).not.toContain(ARGV_SAMPLE);
  });

  for (const tool of SHELL_TOOLS) {
    it(`${tool}: only the trust-all hook reads the command`, () => {
      const bad = { tool_name: tool, tool_input: { command: `run ${ARGV_SAMPLE}` } };
      const clean = { tool_name: tool, tool_input: { command: "pnpm test" } };
      expect(hook(TRUST_ALL, bad)).toBe(2);
      expect(hook(TRUST_ALL, clean)).toBe(0);
      expect(hook(AUTO_APPROVE, bad)).toBe(0);
    });
  }

  it("only the auto-approve hook covers environment names", () => {
    const payload = { tool_name: "fsWrite", tool_input: { path: PRODUCT_PATH, text: ENV_SAMPLE } };
    expect(hook(AUTO_APPROVE, payload)).toBe(2);
    expect(hook(TRUST_ALL, payload)).toBe(0);
  });

  it("scans a payload with no path as product code", () => {
    const payload = { tool_name: "fs_write", tool_input: { text: ARGV_SAMPLE } };
    expect(hook(TRUST_ALL, payload)).toBe(2);
    expect(hook(AUTO_APPROVE, payload)).toBe(2);
  });

  it("passes allowed and non-product locations", () => {
    const paths = [
      "packages/protocol/src/unsafe.ts",
      "packages/protocol/templates/claude-terminal-guard.json",
      ".kiro/agents/architect.json",
      ".kiro/specs/x/design.md",
      "docs/architecture.md",
      "apps/node/src/index.test.ts",
      "/tmp/outside-the-repo.ts",
    ];
    for (const p of paths) {
      const payload = { tool_name: "fsWrite", tool_input: { path: p, text: ARGV_SAMPLE } };
      expect(hook(TRUST_ALL, payload), p).toBe(0);
      expect(hook(AUTO_APPROVE, payload), p).toBe(0);
    }
  });

  it("ignores other tools", () => {
    const payload = {
      tool_name: "readFile",
      tool_input: { path: PRODUCT_PATH, text: ARGV_SAMPLE },
    };
    expect(hook(TRUST_ALL, payload)).toBe(0);
    expect(hook(AUTO_APPROVE, payload)).toBe(0);
  });

  it("exits 2 on unparsable, empty or non-object stdin", () => {
    for (const h of [TRUST_ALL, AUTO_APPROVE]) {
      for (const input of ["{not json", "", "   \n", "[]", "42", "null", '"text"']) {
        expect(run(h, ["--hook-stdin"], input).code, JSON.stringify(input)).toBe(2);
      }
    }
  });
});

describe("unsafe groups block in --hook-stdin and path mode", () => {
  for (const group of UNSAFE_GROUPS) {
    for (const entry of UNSAFE_TOKENS[group]) {
      for (const sample of entry.samples) {
        it(`${group}/${entry.id}: ${JSON.stringify(sample).length} chars is blocked where covered`, () => {
          const payload = {
            tool_name: "fsWrite",
            tool_input: { path: PRODUCT_PATH, text: sample },
          };
          expect(hook(AUTO_APPROVE, payload)).toBe(2);
          expect(hook(TRUST_ALL, payload)).toBe(group === "envNames" ? 0 : 2);
        });
      }
    }
  }
});

describe("Claude asking modes through the hooks (P-SI2-1)", () => {
  // Flag names are built from fragments so this file spells no unsafe token.
  const MODE_FLAG = ["--permission", "mode"].join("-");
  const PROMPTS_FLAG = ["--permission", "prompts"].join("-");
  const send = (h: string, text: string): number =>
    hook(h, { tool_name: "fsWrite", tool_input: { path: PRODUCT_PATH, text } });

  it("passes the asking modes and the host prompts value in both hooks", () => {
    for (const text of [
      `${MODE_FLAG} manual`,
      `${MODE_FLAG}=default`,
      `${PROMPTS_FLAG} host`,
      `args: ["${MODE_FLAG}", "manual", "${PROMPTS_FLAG}", "host"]`,
    ]) {
      for (const h of [TRUST_ALL, AUTO_APPROVE]) expect(send(h, text), text).toBe(0);
    }
  });

  it("blocks any other mode, an unknown mode and any other prompts value in both hooks", () => {
    for (const text of [
      `${MODE_FLAG} acceptable`,
      `${MODE_FLAG}=plan`,
      `${MODE_FLAG} manuals`,
      `${PROMPTS_FLAG} nothing`,
      `${PROMPTS_FLAG}=hostile`,
    ]) {
      for (const h of [TRUST_ALL, AUTO_APPROVE]) expect(send(h, text), text).toBe(2);
    }
  });
});

describe("real tree and runner", () => {
  it("both scanners pass --tree", () => {
    expect(run(TRUST_ALL, ["--tree"]).code).toBe(0);
    expect(run(AUTO_APPROVE, ["--tree"]).code).toBe(0);
  });

  it("the check:si runner exits 0", () => {
    expect(run("check-si", []).code).toBe(0);
  });

  it("exits 2 for an unknown option and for a missing path", () => {
    expect(run(AUTO_APPROVE, ["--bogus"]).code).toBe(2);
    expect(run(AUTO_APPROVE, ["no/such/file.ts"]).code).toBe(2);
  });

  it("the scripts' own sources and this test contain no unsafe token", () => {
    const files = [
      `tools/${TRUST_ALL}.ts`,
      `tools/${AUTO_APPROVE}.ts`,
      "tools/check-si.ts",
      "tools/lib/si-cli.ts",
      "tools/lib/si-rules.ts",
      "tools/lib/hook-stdin.ts",
      "tools/test/si-hooks.test.ts",
    ];
    for (const f of files) {
      expect(findUnsafeToken(readFileSync(resolve(repoRoot, f), "utf8")), f).toBeNull();
    }
  });
});
