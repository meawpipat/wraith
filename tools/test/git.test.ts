import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ToolError } from "../lib/finding.ts";
import { changedPaths, stagedContent, stagedPaths, trackedPaths, treePaths } from "../lib/git.ts";

const savedGlobal = process.env.GIT_CONFIG_GLOBAL;
const savedSystem = process.env.GIT_CONFIG_SYSTEM;
let repo = "";
let plain = "";

function git(...argv: string[]): void {
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "-c",
      "commit.gpgsign=false",
      ...argv,
    ],
    { cwd: repo, stdio: "ignore" },
  );
}

beforeAll(() => {
  process.env.GIT_CONFIG_GLOBAL = "/dev/null";
  process.env.GIT_CONFIG_SYSTEM = "/dev/null";
  repo = mkdtempSync(join(tmpdir(), "wraith-git-test-"));
  plain = mkdtempSync(join(tmpdir(), "wraith-nogit-test-"));
  git("init", "-q");
  writeFileSync(join(repo, ".gitignore"), "ignored.txt\n");
  writeFileSync(join(repo, "a.txt"), "base\n");
  writeFileSync(join(repo, "gone.txt"), "bye\n");
  mkdirSync(join(repo, "sub"));
  writeFileSync(join(repo, "sub", "b.txt"), "b\n");
  git("add", ".gitignore", "a.txt", "gone.txt", "sub/b.txt");
  git("commit", "-q", "-m", "base");
  git("branch", "-M", "main");
  git("checkout", "-q", "-b", "feature");
  writeFileSync(join(repo, "c.txt"), "c\n");
  git("add", "c.txt");
  git("commit", "-q", "-m", "feature");
});

afterAll(() => {
  if (savedGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
  else process.env.GIT_CONFIG_GLOBAL = savedGlobal;
  if (savedSystem === undefined) delete process.env.GIT_CONFIG_SYSTEM;
  else process.env.GIT_CONFIG_SYSTEM = savedSystem;
  rmSync(repo, { recursive: true, force: true });
  rmSync(plain, { recursive: true, force: true });
});

describe("git helpers", () => {
  it("reads staged content from the index, not the working copy", () => {
    writeFileSync(join(repo, "a.txt"), "staged\n");
    git("add", "a.txt");
    writeFileSync(join(repo, "a.txt"), "working copy differs\n");
    expect(stagedPaths(repo)).toEqual(["a.txt"]);
    expect(stagedContent(repo, "a.txt").toString("utf8")).toBe("staged\n");
  });

  it("does not list deleted files in treePaths and still tracks them", () => {
    unlinkSync(join(repo, "gone.txt"));
    expect(trackedPaths(repo)).toContain("gone.txt");
    expect(treePaths(repo)).not.toContain("gone.txt");
    expect(treePaths(repo)).toContain("sub/b.txt");
  });

  it("lists an untracked file but not an ignored one", () => {
    writeFileSync(join(repo, "untracked.txt"), "u\n");
    writeFileSync(join(repo, "ignored.txt"), "i\n");
    const tree = treePaths(repo);
    expect(tree).toContain("untracked.txt");
    expect(tree).not.toContain("ignored.txt");
  });

  it("lists paths changed since a base", () => {
    expect(changedPaths(repo, "main")).toEqual(["c.txt"]);
  });

  it("throws ToolError outside a repository", () => {
    expect(() => stagedPaths(plain)).toThrow(ToolError);
    expect(() => treePaths(plain)).toThrow("git command failed");
  });
});
