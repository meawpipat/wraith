import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { checkWorkflowsDir } from "../check-workflow-pins.ts";

// Validates: Requirements 2.1 to 2.14, 2.16, 3.11, 10.1, 10.9
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TEXT = readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8");

interface Step {
  uses?: string;
  run?: string;
  name?: string;
  with?: Record<string, unknown>;
  [k: string]: unknown;
}
interface Workflow {
  on: { pull_request: unknown; push: { branches: string[] } };
  permissions: Record<string, string>;
  concurrency: Record<string, unknown>;
  jobs: Record<string, Record<string, unknown> & { steps: Step[] }>;
}
const wf = parse(TEXT) as Workflow;
const jobs = Object.values(wf.jobs);
const steps = jobs.flatMap((j) => j.steps);
const runs = steps.map((s) => s.run).filter((r): r is string => typeof r === "string");

const SHAS: Record<string, string> = {
  "actions/checkout": "3d3c42e5aac5ba805825da76410c181273ba90b1",
  "actions/setup-node": "949feb2413d6458794dcd2491c4babbbce0c15c1",
};

describe("ci.yml structure", () => {
  it("triggers on pull_request and push to main", () => {
    expect(wf.on.pull_request).toBeDefined();
    expect(wf.on.push.branches).toEqual(["main"]);
  });

  it("runs one job on exactly both free runners", () => {
    expect(jobs).toHaveLength(1);
    const job = jobs[0] as unknown as { strategy: { matrix: { os: string[] } }; "runs-on": string };
    expect(job.strategy.matrix.os).toEqual(["ubuntu-latest", "macos-latest"]);
    expect(job["runs-on"]).toBe(`\${{ matrix.os }}`);
    expect(TEXT).not.toMatch(/self-hosted|larger|-(xl|[0-9]+-core)\b/);
  });

  it("uses the Node major from .nvmrc", () => {
    const major = readFileSync(join(ROOT, ".nvmrc"), "utf8").trim().replace(/^v/, "").split(".")[0];
    const setup = steps.find((s) => s.uses?.startsWith("actions/setup-node@"));
    expect(String(setup?.with?.["node-version"])).toBe(major);
    expect(major).toBe("22");
  });

  it("installs pnpm 9.15.0 with npm after setup-node, no pnpm action, no corepack", () => {
    const iSetup = steps.findIndex((s) => s.uses?.startsWith("actions/setup-node@"));
    const iPnpm = steps.findIndex((s) => s.run === "npm install -g pnpm@9.15.0");
    const iInstall = steps.findIndex((s) => s.run === "pnpm install --frozen-lockfile");
    expect(iSetup).toBeGreaterThanOrEqual(0);
    expect(iPnpm).toBeGreaterThan(iSetup);
    expect(iInstall).toBeGreaterThan(iPnpm);
    expect(TEXT).not.toMatch(/pnpm\/action-setup|corepack/i);
  });

  it("has the pnpm version equality step before install", () => {
    const i = steps.findIndex(
      (s) => s.run?.includes("pnpm --version") && s.run.includes("packageManager"),
    );
    const iPnpm = steps.findIndex((s) => s.run === "npm install -g pnpm@9.15.0");
    const iInstall = steps.findIndex((s) => s.run === "pnpm install --frozen-lockfile");
    expect(i).toBeGreaterThan(iPnpm);
    expect(i).toBeLessThan(iInstall);
  });

  it("runs the required commands in order", () => {
    const order = [
      "pnpm install --frozen-lockfile",
      "pnpm lint",
      "pnpm typecheck",
      "pnpm -r --if-present check",
      "pnpm -r build",
      "pnpm -r test",
      "pnpm check:platform",
      "pnpm check:secrets",
      "pnpm check:pins",
      "pnpm check:suites",
    ];
    let from = 0;
    for (const cmd of order) {
      const idx = runs.findIndex((r, i) => i >= from && r.startsWith(cmd));
      expect(idx, cmd).toBeGreaterThanOrEqual(from);
      from = idx + 1;
    }
  });

  it("has workflow-level read-only permissions and none per job", () => {
    expect(wf.permissions).toEqual({ contents: "read" });
    for (const j of jobs) expect(j.permissions).toBeUndefined();
  });

  it("cancels superseded runs", () => {
    expect(wf.concurrency["cancel-in-progress"]).toBe(true);
    expect(wf.concurrency.group).toBeTypeOf("string");
  });

  it("has no escape hatches, secrets, environment or push", () => {
    for (const j of jobs) {
      expect(j.environment).toBeUndefined();
      expect(j["continue-on-error"]).toBeUndefined();
      expect(j.if).toBeUndefined();
    }
    for (const s of steps) {
      expect(s["continue-on-error"]).toBeUndefined();
      expect(s.if).toBeUndefined();
    }
    expect(TEXT).not.toMatch(/secrets\./);
    expect(TEXT).not.toMatch(/git push/);
    expect(TEXT).not.toMatch(/gitleaks/i);
  });

  it("uses only checkout and setup-node, pinned to the verified SHAs with tag comments", () => {
    const lines = TEXT.split("\n").filter((l) => /\buses:/.test(l));
    expect(lines).toHaveLength(2);
    const seen: string[] = [];
    for (const line of lines) {
      const m = /uses:\s*([^@\s]+)@([0-9a-f]{40})\s+# v\d+\.\d+\.\d+\s*$/.exec(line);
      expect(m, line).not.toBeNull();
      const [, repo, sha] = m as RegExpExecArray;
      expect(SHAS[repo as string]).toBe(sha);
      seen.push(repo as string);
    }
    expect(seen.sort()).toEqual(Object.keys(SHAS));
  });

  it("passes the Pin_Check on the real workflows folder", () => {
    expect(checkWorkflowsDir(ROOT)).toEqual([]);
  });
});
