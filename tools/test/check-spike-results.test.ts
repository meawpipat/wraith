import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { GATE_LIST } from "../lib/spike-ids.ts";
import { formatMetaBlock, type SpikeMeta } from "../lib/spike-meta.ts";
import { type ResultsEntry, renderEntry } from "../lib/spike-results.ts";
import { UNSAFE_TOKENS } from "../lib/unsafe-tokens.ts";
import { RESULTS_SAMPLE } from "./support/results-sample.ts";

// Validates: Requirements 6.9, 7.7, 7.9, 17.1 to 17.3
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI = join(ROOT, "tools", "check-spike-results.ts");
const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tree(results: string = RESULTS_SAMPLE): string {
  const root = mkdtempSync(join(tmpdir(), "spike-check-"));
  dirs.push(root);
  put(root, "docs/spikes/RESULTS.md", results);
  return root;
}

function put(root: string, rel: string, text: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
}

function run(args: string[]): { code: number | null; out: string } {
  const r = spawnSync(process.execPath, ["--experimental-strip-types", CLI, ...args], {
    encoding: "utf8",
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

const META: SpikeMeta = {
  id: "q1",
  group: "A",
  cost: "none",
  runBy: "loop",
  agents: [],
  maxPrompts: 0,
  maxWallSeconds: 60,
  estimateCredits: null,
  claudePrompts: 0,
  human: [],
  depends: [],
  shares: null,
  allowAlways: "never",
  assumption: "",
};

function entry(id: string, result: ResultsEntry["result"]): ResultsEntry {
  const e: ResultsEntry = {
    id,
    question: "question",
    experiment: "hc 0.1.18; kiro-cli 2.1.0; claude code 2.0.1",
    result,
    evidence: result === "pending" ? [] : [`spike/evidence-${id}.json`],
    branch: "main",
    affects: ["P1"],
    notify: "no",
    openHumanSteps: [],
    notes: [],
  };
  if (result === "pending") e.reason = "not run yet";
  return e;
}

describe("check-spike-results CLI", () => {
  it("exits 0 in default mode on a tree with zero entries", () => {
    expect(run(["--root", tree()]).code).toBe(0);
  });

  it("exits 0 in default mode on the real committed tree", () => {
    expect(run([]).code).toBe(0);
  });

  it("reports file and line of a planted token and never the token", () => {
    const root = tree();
    const token = UNSAFE_TOKENS.argvFlags[0].literal;
    put(root, "spike/lib/x.ts", `const a = 1;\nconst b = "${token}";\n`);
    const r = run(["--root", root]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("spike/lib/x.ts:2");
    expect(r.out).not.toContain(token);
  });

  it("exits 1 on a script with a broken metadata block", () => {
    const root = tree();
    put(root, "spike/hc/q1/q1.ts", "// spike-meta\n// id: q1\n// end-spike-meta\n");
    const r = run(["--root", root]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("spike/hc/q1/q1.ts:1");
  });

  it("accepts a script with a valid metadata block", () => {
    const root = tree();
    put(root, "spike/hc/q1/q1.ts", `${formatMetaBlock(META)}\nexport {};\n`);
    expect(run(["--root", root]).code).toBe(0);
  });

  it("exits 1 when spike/ is listed in .gitignore", () => {
    const root = tree();
    put(root, ".gitignore", "node_modules\n/spike/\n");
    const r = run(["--root", root]);
    expect(r.code).toBe(1);
    expect(r.out).toContain(".gitignore:2");
  });

  it("exits 1 when a tools file imports from spike/", () => {
    const root = tree();
    put(root, "tools/lib/bad.ts", `import { x } from "../../${"spike"}/lib/ids.ts";\n`);
    const r = run(["--root", root]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("tools/lib/bad.ts:1");
  });

  it("exits 2 when RESULTS.md is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "spike-check-"));
    dirs.push(root);
    expect(run(["--root", root]).code).toBe(2);
  });

  it("--gate exits 1 when every id is pending", () => {
    const md = `# Spike results\n\n## Entries\n\n${GATE_LIST.map((id) => renderEntry(entry(id, "pending"))).join("\n")}`;
    const r = run(["--root", tree(md), "--gate"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("pending 18");
  });

  it("--gate exits 0 when all 18 ids are answered with evidence", () => {
    const md = `# Spike results\n\n## Entries\n\n${GATE_LIST.map((id) => renderEntry(entry(id, "PASS"))).join("\n")}`;
    const root = tree(md);
    for (const id of GATE_LIST) put(root, `spike/evidence-${id}.json`, "{}\n");
    const r = run(["--root", root, "--gate"]);
    expect(r.out).toContain("PASS 18");
    expect(r.out).toContain("hc: 0.1.18");
    expect(r.code).toBe(0);
  });
});
