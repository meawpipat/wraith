import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { walkFiles } from "../lib/walk.ts";
import { buildSample } from "./support/samples.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const hooksDir = join(repoRoot, ".githooks");
const hookFile = join(hooksDir, "pre-commit");
const selfRel = "tools/test/pre-commit.test.ts";

let repo = "";

function git(cwd: string, argv: readonly string[]): { status: number; out: string } {
  const r = spawnSync("git", argv, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
  });
  return { status: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
}

function commit(message: string): { status: number; out: string } {
  return git(repo, [
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "-c",
    `core.hooksPath=${hooksDir}`,
    "commit",
    "-q",
    "-m",
    message,
  ]);
}

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "wraith-precommit-test-"));
  expect(git(repo, ["init", "-q"]).status).toBe(0);
});

afterAll(() => {
  if (repo !== "") rmSync(repo, { recursive: true, force: true });
});

describe("pre-commit hook", () => {
  it("blocks a commit that stages a secret and prints no secret text", () => {
    const sample = buildSample("github-token");
    writeFileSync(join(repo, sample.fileName), sample.text);
    expect(git(repo, ["add", sample.fileName]).status).toBe(0);
    const r = commit("secret");
    expect(r.status).not.toBe(0);
    expect(r.out).not.toContain(sample.text);
    expect(git(repo, ["rm", "-q", "--cached", sample.fileName]).status).toBe(0);
    rmSync(join(repo, sample.fileName));
  });

  it("allows a commit of a clean file", () => {
    writeFileSync(join(repo, "clean.txt"), "nothing to see\n");
    expect(git(repo, ["add", "clean.txt"]).status).toBe(0);
    expect(commit("clean").status).toBe(0);
  });

  it("has an execute bit, and mode 100755 when git tracks it", () => {
    expect(statSync(hookFile).mode & 0o111).not.toBe(0);
    const listed = git(repoRoot, ["ls-files", "-s", "--", ".githooks/pre-commit"]);
    if (listed.status === 0 && listed.out.trim() !== "") {
      expect(listed.out.startsWith("100755 ")).toBe(true);
    }
  });

  it("is a POSIX sh script that runs the staged scan", () => {
    const text = readFileSync(hookFile, "utf8");
    expect(text.startsWith("#!/bin/sh\n")).toBe(true);
    expect(text).toContain("--staged");
  });

  it("no file of the repository except this test calls git config", () => {
    const skip = new Set(["node_modules", "dist", ".git", ".kiro", "docs"]);
    const files = walkFiles({ root: repoRoot, dirs: ["."], skipDirNames: skip }).filter(
      (f) => f !== selfRel && /\.(ts|mts|js|mjs|cjs|sh|json|ya?ml)$|^\.githooks\//.test(f),
    );
    const shellForm = new RegExp(["\\bgit", "\\s+", "config\\b"].join(""));
    const argvForm = new RegExp(["[\"']git[\"']\\s*,[^\\n]*", "[\"']", "config", "[\"']"].join(""));
    const offenders = files.filter((f) => {
      const text = readFileSync(join(repoRoot, f), "utf8");
      return shellForm.test(text) || argvForm.test(text);
    });
    expect(offenders).toEqual([]);
  });
});
