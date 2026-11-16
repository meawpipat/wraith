import { execFileSync } from "node:child_process";
import { ToolError } from "./finding.ts";

const MAX_BUFFER = 256 * 1024 * 1024;

/** Runs git with an argv array (no shell). Any failure becomes a fixed-message ToolError. */
function git(cwd: string, argv: readonly string[]): Buffer {
  try {
    return execFileSync("git", [...argv], {
      cwd,
      maxBuffer: MAX_BUFFER,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw new ToolError("git command failed");
  }
}

function splitZ(out: Buffer): string[] {
  return out
    .toString("utf8")
    .split("\0")
    .filter((p) => p !== "");
}

export function stagedPaths(cwd: string): string[] {
  return splitZ(git(cwd, ["diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR"]));
}

/** Content from the index, not the working tree. */
export function stagedContent(cwd: string, path: string): Buffer {
  return git(cwd, ["show", `:${path}`]);
}

export function changedPaths(cwd: string, base: string): string[] {
  return splitZ(git(cwd, ["diff", "--name-only", "-z", "--diff-filter=ACMR", `${base}...HEAD`]));
}

export function trackedPaths(cwd: string): string[] {
  return splitZ(git(cwd, ["ls-files", "-z", "--cached"]));
}

/** Cached plus untracked-not-ignored files, minus files deleted from the working tree. */
export function treePaths(cwd: string): string[] {
  const all = splitZ(git(cwd, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]));
  const deleted = new Set(splitZ(git(cwd, ["ls-files", "-z", "--deleted"])));
  return [...new Set(all)].filter((p) => !deleted.has(p)).sort();
}
