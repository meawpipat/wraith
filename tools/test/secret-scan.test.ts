import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SECRET_RULES } from "../lib/secret-rules.ts";
import { buildSample, DECOYS, SECRET_SAMPLES } from "./support/samples.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const script = join(repoRoot, "tools", "secret-scan.ts");
const vectors = join(repoRoot, "fixtures", "crypto", "known-answers.json");

const savedGlobal = process.env.GIT_CONFIG_GLOBAL;
const savedSystem = process.env.GIT_CONFIG_SYSTEM;
const dirs: string[] = [];

function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

function scan(cwd: string, ...args: string[]): { code: number; out: string; err: string } {
  const r = spawnSync("node", ["--experimental-strip-types", script, ...args], {
    cwd,
    encoding: "utf8",
    env: process.env,
  });
  return { code: r.status ?? -1, out: r.stdout, err: r.stderr };
}

function git(cwd: string, ...argv: string[]): void {
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
    { cwd, stdio: "ignore" },
  );
}

function put(dir: string, rel: string, text: string): void {
  const full = join(dir, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
}

beforeAll(() => {
  process.env.GIT_CONFIG_GLOBAL = "/dev/null";
  process.env.GIT_CONFIG_SYSTEM = "/dev/null";
});

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  if (savedGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
  else process.env.GIT_CONFIG_GLOBAL = savedGlobal;
  if (savedSystem === undefined) delete process.env.GIT_CONFIG_SYSTEM;
  else process.env.GIT_CONFIG_SYSTEM = savedSystem;
});

describe("paths mode, one failing sample per class", () => {
  it("covers every rule class", () => {
    expect(SECRET_SAMPLES.map((s) => s.cls).sort()).toEqual(SECRET_RULES.map((r) => r.cls).sort());
  });

  for (const s of SECRET_SAMPLES) {
    it(`exits 1 and names ${s.cls} with file and line, never the content`, () => {
      const dir = tmp("wraith-ss-fail-");
      const { fileName, text } = buildSample(s.cls);
      put(dir, fileName, `first line\n${text}\n`);
      const r = scan(dir, fileName);
      expect(r.code).toBe(1);
      expect(r.out).toContain(`${fileName}:`);
      expect(r.out).toContain(`secret/${s.cls}`);
      expect(r.out).toContain("1 file(s) scanned");
      expect(r.out).not.toContain(text.slice(0, 20));
    });
  }
});

describe("paths mode, passing samples", () => {
  for (const d of DECOYS) {
    it(`exits 0 for the ${d.kind} decoy`, () => {
      const dir = tmp("wraith-ss-pass-");
      put(dir, d.fileName, d.build());
      const r = scan(dir, d.fileName);
      expect(r.code).toBe(0);
      expect(r.out).toContain("1 file(s) scanned, 0 finding(s)");
    });
  }

  it("passes fixtures/crypto/known-answers.json", () => {
    const r = scan(repoRoot, vectors);
    expect(r.code).toBe(0);
  });
});

describe("errors exit 2 and name the path", () => {
  it("missing path", () => {
    const dir = tmp("wraith-ss-err-");
    put(dir, "ok.txt", "fine\n");
    const r = scan(dir, "ok.txt", "no-such-file.txt");
    expect(r.code).toBe(2);
    expect(r.err).toContain("no-such-file.txt");
  });

  it("directory path", () => {
    const dir = tmp("wraith-ss-err-");
    mkdirSync(join(dir, "sub"));
    const r = scan(dir, "sub");
    expect(r.code).toBe(2);
    expect(r.err).toContain("sub");
  });

  it("bad usage", () => {
    const dir = tmp("wraith-ss-err-");
    expect(scan(dir).code).toBe(2);
    expect(scan(dir, "--bogus").code).toBe(2);
    expect(scan(dir, "--changed").code).toBe(2);
  });

  it("git failure outside a repository", () => {
    const dir = tmp("wraith-ss-nogit-");
    const r = scan(dir, "--staged");
    expect(r.code).toBe(2);
  });
});

describe("skipped folders", () => {
  it("does not scan node_modules, dist or .git paths", () => {
    const dir = tmp("wraith-ss-skip-");
    const { text } = buildSample("github-token");
    for (const seg of ["node_modules", "dist", ".git"]) put(dir, `${seg}/x.txt`, text);
    put(dir, "clean.txt", "fine\n");
    const r = scan(dir, "node_modules/x.txt", "dist/x.txt", ".git/x.txt", "clean.txt");
    expect(r.code).toBe(0);
    expect(r.out).toContain("1 file(s) scanned, 0 finding(s)");
  });
});

describe("git modes against a temporary repository", () => {
  let repo = "";
  const secret = buildSample("github-token").text;

  beforeAll(() => {
    repo = tmp("wraith-ss-repo-");
    git(repo, "init", "-q");
    put(repo, "base.txt", "base\n");
    git(repo, "add", "base.txt");
    git(repo, "commit", "-q", "-m", "base");
    git(repo, "branch", "-M", "main");
  });

  it("--staged is clean with nothing staged", () => {
    const r = scan(repo, "--staged");
    expect(r.code).toBe(0);
    expect(r.out).toContain("0 file(s) scanned");
  });

  it("--staged reads the index, so a cleaned working copy cannot hide a secret", () => {
    put(repo, "staged.txt", `${secret}\n`);
    git(repo, "add", "staged.txt");
    put(repo, "staged.txt", "cleaned\n");
    const r = scan(repo, "--staged");
    expect(r.code).toBe(1);
    expect(r.out).toContain("staged.txt:1 secret/github-token");
    git(repo, "rm", "-q", "-f", "staged.txt");
  });

  it("--tracked scans committed files and finds a committed secret", () => {
    expect(scan(repo, "--tracked").code).toBe(0);
    put(repo, "tracked.txt", `x\n${secret}\n`);
    git(repo, "checkout", "-q", "-b", "feature");
    git(repo, "add", "tracked.txt");
    git(repo, "commit", "-q", "-m", "feature");
    const r = scan(repo, "--tracked");
    expect(r.code).toBe(1);
    expect(r.out).toContain("tracked.txt:2 secret/github-token");
  });

  it("--changed scans only files changed against the base", () => {
    const r = scan(repo, "--changed", "main");
    expect(r.code).toBe(1);
    expect(r.out).toContain("tracked.txt:2 secret/github-token");
    expect(r.out).toContain("1 file(s) scanned");
    expect(scan(repo, "--changed", "no-such-ref").code).toBe(2);
  });

  it("--tree includes untracked files that are not ignored", () => {
    put(repo, ".gitignore", "ignored.txt\n");
    put(repo, "ignored.txt", `${secret}\n`);
    put(repo, "untracked.txt", `${secret}\n`);
    const r = scan(repo, "--tree");
    expect(r.code).toBe(1);
    expect(r.out).toContain("untracked.txt:1 secret/github-token");
    expect(r.out).not.toContain("ignored.txt");
  });
});

describe("real tree", () => {
  it("passes with --tree", () => {
    const r = scan(repoRoot, "--tree");
    expect(r.out).not.toMatch(/secret\//);
    expect(r.code).toBe(0);
  });
});
