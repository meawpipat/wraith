import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkPlatformSource } from "../check-platform.ts";
import { INSIDE_PATH, OUTSIDE_PATH, TOKEN_SAMPLES } from "./support/platform-samples.ts";

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "check-platform.ts");

function runCli(root: string): { status: number | null; out: string } {
  const r = spawnSync("node", ["--experimental-strip-types", SCRIPT, "--root", root], {
    encoding: "utf8",
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

function withTree(files: Record<string, string>, fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "wraith-cp-"));
  try {
    for (const [rel, text] of Object.entries(files)) {
      const abs = join(root, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, text);
    }
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("token table", () => {
  for (const s of TOKEN_SAMPLES) {
    it(`flags ${s.id} outside packages/platform`, () => {
      const findings = checkPlatformSource(OUTSIDE_PATH, `${s.line}\n`);
      expect(findings).toEqual([
        { file: OUTSIDE_PATH, line: 1, column: s.column, rule: `platform/${s.id}` },
      ]);
    });
    it(`accepts ${s.id} inside packages/platform`, () => {
      expect(checkPlatformSource(INSIDE_PATH, `${s.line}\n`)).toEqual([]);
    });
  }

  it("does not flag os.tmpdir()", () => {
    expect(checkPlatformSource(OUTSIDE_PATH, "const d = os.tmpdir();\n")).toEqual([]);
  });
});

describe("CLI", () => {
  it("exits 1 with a file:line:col rule line for process.platform", () => {
    const sample = TOKEN_SAMPLES.find((s) => s.id === "process-platform");
    withTree({ [OUTSIDE_PATH]: `${sample?.line}\n` }, (root) => {
      const r = runCli(root);
      expect(r.status).toBe(1);
      expect(r.out).toContain(`${OUTSIDE_PATH}:1:11 platform/process-platform`);
    });
  });

  it("exits 1 with a file:line:col rule line for SIGHUP", () => {
    const sample = TOKEN_SAMPLES.find((s) => s.id === "sighup");
    withTree({ [OUTSIDE_PATH]: `// header\n${sample?.line}\n` }, (root) => {
      const r = runCli(root);
      expect(r.status).toBe(1);
      expect(r.out).toContain(`${OUTSIDE_PATH}:2:20 platform/sighup`);
    });
  });

  it("lists every finding of a file with several violations", () => {
    const text = TOKEN_SAMPLES.map((s) => s.line).join("\n");
    withTree({ [OUTSIDE_PATH]: `${text}\n` }, (root) => {
      const r = runCli(root);
      expect(r.status).toBe(1);
      for (const [i, s] of TOKEN_SAMPLES.entries()) {
        expect(r.out).toContain(`${OUTSIDE_PATH}:${i + 1}:${s.column} platform/${s.id}`);
      }
      expect(r.out).toContain(`check-platform: ${TOKEN_SAMPLES.length} finding(s)`);
    });
  });

  it("exits 0 for a clean tree and for the exempt folder", () => {
    const sample = TOKEN_SAMPLES.find((s) => s.id === "chmod");
    withTree(
      { [OUTSIDE_PATH]: "export const a = 1;\n", [INSIDE_PATH]: `${sample?.line}\n` },
      (root) => {
        expect(runCli(root).status).toBe(0);
      },
    );
  });

  it("exits 2 and names an unreadable file", () => {
    withTree({ [OUTSIDE_PATH]: "export const a = 1;\n" }, (root) => {
      const abs = join(root, OUTSIDE_PATH);
      chmodSync(abs, 0o000);
      try {
        const r = runCli(root);
        expect(r.status).toBe(2);
        expect(r.out).toContain(OUTSIDE_PATH);
      } finally {
        chmodSync(abs, 0o644);
      }
    });
  });
});
