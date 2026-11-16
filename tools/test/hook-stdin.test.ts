import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ToolError } from "../lib/finding.ts";
import { extractHookText, MAX_HOOK_BYTES } from "../lib/hook-stdin.ts";
import { runSecretScan } from "../secret-scan.ts";
import { pbt } from "./config.ts";
import { buildSample, SECRET_SAMPLES, type SecretSample } from "./support/samples.ts";

// Property 10: Hook input handling is total and fails closed.
// Validates: Requirements 3.9, 3.14

const TOOLS_DIR = fileURLToPath(new URL("..", import.meta.url));
const CLI = fileURLToPath(new URL("../secret-scan.ts", import.meta.url));
const CWD = process.cwd();

const TOOL_NAMES = [
  "fsWrite",
  "fs_write",
  "fsAppend",
  "fs_append",
  "strReplace",
  "str_replace",
  "executeBash",
  "execute_bash",
] as const;
const PATH_KEYS = ["path", "file_path", "filePath", "targetFile"] as const;
const OTHER_KEYS = ["text", "content", "oldStr", "newStr", "items", "meta", "x"] as const;
const WORDS = ["alpha", "beta", "note", "build", "value", "text", "table", "lorem"] as const;

function runCli(input: string): number | null {
  return spawnSync(process.execPath, ["--experimental-strip-types", CLI, "--hook-stdin"], {
    cwd: TOOLS_DIR,
    input,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  }).status;
}

const wordsArb = fc
  .array(fc.constantFrom(...WORDS), { minLength: 0, maxLength: 4 })
  .map((w) => w.join(" "));

/** Any JSON value; keys come from fixed lists so shape is controlled, strings are arbitrary. */
function jsonArb(keys: readonly string[], str: fc.Arbitrary<string>): fc.Arbitrary<unknown> {
  return fc.letrec<{ value: unknown }>((tie) => ({
    value: fc.oneof(
      { depthSize: "small", maxDepth: 4 },
      str,
      fc.integer(),
      fc.boolean(),
      fc.constant(null),
      fc.array(tie("value"), { maxLength: 4 }),
      fc
        .array(fc.tuple(fc.constantFrom(...keys), tie("value")), { maxLength: 4 })
        .map((entries) => Object.fromEntries(entries)),
    ),
  })).value;
}

/** Independent reference: every string, in document order. */
function refStrings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const e of v) refStrings(e, out);
  else if (typeof v === "object" && v !== null) {
    for (const e of Object.values(v)) refStrings(e, out);
  }
  return out;
}

/** Every string held by a path-named key, at any depth. */
function refPaths(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) for (const e of v) refPaths(e, out);
  else if (typeof v === "object" && v !== null) {
    for (const [k, e] of Object.entries(v)) {
      if ((PATH_KEYS as readonly string[]).includes(k) && typeof e === "string") out.push(e);
      refPaths(e, out);
    }
  }
  return out;
}

function bodyArb(sample: SecretSample): fc.Arbitrary<string> {
  return fc
    .array(fc.constantFrom(...sample.alphabet.split("")), {
      minLength: sample.bodyLength,
      maxLength: sample.bodyLength,
    })
    .map((chars) => chars.join(""))
    .filter((body) => new Set(body).size >= 3);
}

const cleanFillerArb = jsonArb(OTHER_KEYS, wordsArb);

interface Step {
  readonly kind: "key" | "index";
  readonly key: string;
  readonly filler: unknown;
}

const stepArb: fc.Arbitrary<Step> = fc.record({
  kind: fc.constantFrom("key" as const, "index" as const),
  key: fc.constantFrom(...OTHER_KEYS),
  filler: cleanFillerArb,
});

function wrap(inner: unknown, steps: readonly Step[]): unknown {
  let out = inner;
  for (const s of steps) {
    out = s.kind === "key" ? { filler: s.filler, [s.key]: out } : [s.filler, out];
  }
  return out;
}

describe("Property 10: Hook input handling is total and fails closed", () => {
  it("Feature: s-ops-packaging, Property 10: extractHookText returns every string and the path", () => {
    const anyArb = jsonArb([...PATH_KEYS, ...OTHER_KEYS], fc.string({ maxLength: 12 }));
    pbt(
      fc.property(anyArb, fc.constantFrom(...TOOL_NAMES), (toolInput, toolName) => {
        const text = extractHookText({ tool_name: toolName, tool_input: toolInput });
        expect([...text.strings]).toEqual(refStrings(toolInput));
        const paths = refPaths(toolInput);
        if (paths.length === 0) expect(text.path).toBeUndefined();
        else expect(paths).toContain(text.path);
        expect(text.toolName).toBe(toolName);
      }),
    );
  });

  it("Feature: s-ops-packaging, Property 10: extractHookText is total over any JSON value", () => {
    const anyArb = jsonArb([...PATH_KEYS, ...OTHER_KEYS], fc.string({ maxLength: 12 }));
    pbt(
      fc.property(anyArb, (value) => {
        const text = extractHookText(value);
        expect(Array.isArray(text.strings)).toBe(true);
        // A bare value (no tool_input) holds nothing to scan.
        if (typeof value !== "object" || value === null || Array.isArray(value)) {
          expect(text.strings).toEqual([]);
          expect(text.path).toBeUndefined();
        }
      }),
    );
  });

  for (const sample of SECRET_SAMPLES) {
    it(`Feature: s-ops-packaging, Property 10: a ${sample.cls} sample at any depth is found`, () => {
      pbt(
        fc.property(
          bodyArb(sample),
          fc.array(stepArb, { maxLength: 6 }),
          fc.boolean(),
          fc.constantFrom(...TOOL_NAMES),
          fc.constantFrom(...PATH_KEYS),
          (body, steps, withPath, toolName, pathKey) => {
            const nested = wrap(sample.build(body), steps);
            const toolInput: Record<string, unknown> = { content: nested };
            if (withPath) toolInput[pathKey] = `src/${sample.fileName}`;
            const payload = JSON.stringify({ tool_name: toolName, tool_input: toolInput });
            const { findings } = runSecretScan({ kind: "hook-stdin" }, CWD, payload);
            expect(findings.length).toBeGreaterThan(0);
          },
        ),
      );
    });
  }

  it("Feature: s-ops-packaging, Property 10: no path and no finding scans clean", () => {
    pbt(
      fc.property(cleanFillerArb, fc.constantFrom(...TOOL_NAMES), (filler, toolName) => {
        const payload = JSON.stringify({ tool_name: toolName, tool_input: { content: filler } });
        const { findings } = runSecretScan({ kind: "hook-stdin" }, CWD, payload);
        expect(findings).toEqual([]);
      }),
    );
  });

  it("Feature: s-ops-packaging, Property 10: valid JSON that is not an object is an error", () => {
    pbt(
      fc.property(cleanFillerArb, (value) => {
        if (typeof value === "object" && value !== null && !Array.isArray(value)) return;
        expect(() => runSecretScan({ kind: "hook-stdin" }, CWD, JSON.stringify(value))).toThrow(
          ToolError,
        );
      }),
    );
  });

  it("Feature: s-ops-packaging, Property 10: input that is not valid JSON or is empty is an error", () => {
    const notJson = fc
      .string({ maxLength: 30 })
      .filter((s) => {
        try {
          JSON.parse(s);
          return false;
        } catch {
          return true;
        }
      })
      .map((s) => s);
    const blank = fc.constantFrom("", " ", "\n", "\t \n");
    pbt(
      fc.property(fc.oneof(notJson, blank), (raw) => {
        expect(() => runSecretScan({ kind: "hook-stdin" }, CWD, raw)).toThrow(ToolError);
      }),
    );
  });

  it("Feature: s-ops-packaging, Property 10: input over the size limit is an error", () => {
    const big = " ".repeat(MAX_HOOK_BYTES + 1);
    expect(() => runSecretScan({ kind: "hook-stdin" }, CWD, big)).toThrow(ToolError);
  });

  describe("CLI exit codes", () => {
    it("exits 2 on a secret sample and 0 on a clean payload", () => {
      const sample = SECRET_SAMPLES[0];
      if (!sample) throw new Error("no samples");
      const body = sample.alphabet.slice(0, sample.bodyLength).padEnd(sample.bodyLength, "a");
      const dirty = JSON.stringify({
        tool_name: "fs_write",
        tool_input: { items: [{ text: sample.build(body) }] },
      });
      const clean = JSON.stringify({ tool_name: "fs_write", tool_input: { text: "alpha beta" } });
      expect(runCli(dirty)).toBe(2);
      expect(runCli(clean)).toBe(0);
    });

    it("exits 2 on invalid JSON, empty and oversized input", () => {
      expect(runCli("{not json")).toBe(2);
      expect(runCli("")).toBe(2);
      expect(runCli(" ".repeat(MAX_HOOK_BYTES + 1))).toBe(2);
    });
  });
});

describe("Hook CLI examples (R3.9, R3.14)", () => {
  const NO_GLOBAL_GIT = {
    ...process.env,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
  };

  function secretText(): string {
    return buildSample("github-token").text;
  }

  function cliStatus(input: string): number | null {
    return spawnSync(process.execPath, ["--experimental-strip-types", CLI, "--hook-stdin"], {
      cwd: TOOLS_DIR,
      input,
      encoding: "utf8",
      env: NO_GLOBAL_GIT,
    }).status;
  }

  function git(cwd: string, args: readonly string[]): void {
    const r = spawnSync(
      "git",
      ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", ...args],
      { cwd, encoding: "utf8", env: NO_GLOBAL_GIT },
    );
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  }

  it("a payload with no path and a secret sample exits 2; the clean twin exits 0", () => {
    const dirty = JSON.stringify({ tool_name: "fs_write", tool_input: { text: secretText() } });
    const clean = JSON.stringify({ tool_name: "fs_write", tool_input: { text: "alpha beta" } });
    expect(cliStatus(dirty)).toBe(2);
    expect(cliStatus(clean)).toBe(0);
  });

  it("unparsable, empty and oversized stdin exit 2", () => {
    expect(cliStatus("{not json")).toBe(2);
    expect(cliStatus("")).toBe(2);
    expect(cliStatus(" ".repeat(MAX_HOOK_BYTES + 1))).toBe(2);
  });

  it("valid JSON that is not an object exits 2", () => {
    for (const raw of ["42", "[]", '"x"', "null", "true"]) expect(cliStatus(raw)).toBe(2);
  });

  describe("line numbers are relative to the matched string", () => {
    function lines(strings: readonly string[]): number[] {
      const payload = JSON.stringify({ tool_name: "fs_write", tool_input: { items: strings } });
      return runSecretScan({ kind: "hook-stdin" }, CWD, payload).findings.map((f) => f.line);
    }

    it("a one-line secret in the first string reports line 1", () => {
      expect(lines([secretText()])).toEqual([1]);
    });

    it("a secret on line 3 of a multi-line string reports line 3", () => {
      expect(lines([`alpha\nbeta\n${secretText()}\ngamma`])).toEqual([3]);
    });

    it("a secret in a later string is not offset by earlier strings", () => {
      expect(lines(["alpha\nbeta\ngamma", "delta", `lorem\n${secretText()}`])).toEqual([2]);
    });
  });

  for (const toolName of TOOL_NAMES) {
    it(`${toolName} is accepted and scanned`, () => {
      const dirty = JSON.stringify({ tool_name: toolName, tool_input: { content: secretText() } });
      const clean = JSON.stringify({ tool_name: toolName, tool_input: { content: "alpha" } });
      expect(cliStatus(dirty)).toBe(2);
      expect(cliStatus(clean)).toBe(0);
    });
  }

  it("an executeBash git commit scans the staged files of a temporary repository", () => {
    const repo = mkdtempSync(join(tmpdir(), "hook-stdin-"));
    try {
      git(repo, ["init", "-q"]);
      writeFileSync(join(repo, "staged.txt"), secretText());
      git(repo, ["add", "staged.txt"]);
      const commit = (cwd: string): string =>
        JSON.stringify({
          tool_name: "executeBash",
          cwd,
          tool_input: { command: 'git commit -m "x"' },
        });
      expect(cliStatus(commit(repo))).toBe(2);

      git(repo, ["rm", "-q", "--cached", "staged.txt"]);
      writeFileSync(join(repo, "staged.txt"), "alpha beta");
      git(repo, ["add", "staged.txt"]);
      expect(cliStatus(commit(repo))).toBe(0);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
