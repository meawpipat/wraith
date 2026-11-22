import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UNSAFE_TOKENS } from "../../tools/lib/unsafe-tokens.ts";
import {
  createEvidenceWriter,
  EvidenceSecretError,
  newStamp,
  publishNamedCopy,
} from "../lib/evidence.ts";
import type { SpikeOutcome } from "../lib/outcome.ts";
import type { RedactResult } from "../lib/redact.ts";
import { buildSample } from "./support/samples.ts";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "wraith-evidence-"));
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

const FIXED = new Date(Date.UTC(2026, 10, 18, 9, 5, 7));

function writer(extra: Partial<Parameters<typeof createEvidenceWriter>[0]> = {}) {
  return createEvidenceWriter({
    evidenceRoot: join(root, "spike", "hc", "q2", "evidence"),
    q: "q2",
    now: () => FIXED,
    home: "/Users/someone",
    realHome: "/Users/someone",
    env: {},
    ...extra,
  });
}

function outcome(result: SpikeOutcome["result"], observed = "ok"): SpikeOutcome {
  return {
    result,
    criteria: [{ id: "c1", ok: true, observed }],
    affects: [],
    openHumanSteps: [],
    promptsSent: 0,
    notes: [],
  };
}

const passthrough = (input: string): RedactResult => ({
  text: input,
  lineCount: input.split("\n").length,
  replaced: {},
  homeMasked: 0,
  envMasked: 0,
});

describe("newStamp", () => {
  it("formats UTC time without colons", () => {
    expect(newStamp(FIXED, () => false, "/x")).toBe("20261118T090507Z");
  });

  it("adds a suffix on a clash and never returns an existing folder", () => {
    const taken = new Set(["/x/20261118T090507Z", "/x/20261118T090507Z-2"]);
    const stamp = newStamp(FIXED, (p) => taken.has(p), "/x");
    expect(stamp).toBe("20261118T090507Z-3");
    expect(taken.has(`/x/${stamp}`)).toBe(false);
  });

  it("gives two writers started in the same second different folders", () => {
    expect(writer().dir).not.toBe(writer().dir);
  });
});

describe("EvidenceWriter", () => {
  it("writes a redacted file and records bytes, hash and counts", async () => {
    const w = writer({ home: "/Users/someone" });
    await w.addText("notes.txt", "path /Users/someone/project\nplain\n");
    const text = readFileSync(join(w.dir, "notes.txt"), "utf8");
    expect(text).toBe("path ~/project\nplain\n");
    const index = await w.finish(outcome("PASS"), { id: "q2", runBy: "loop" }, { node: "22" });
    expect(index.files).toHaveLength(1);
    expect(index.files[0]?.bytes).toBe(Buffer.byteLength(text));
    expect(index.files[0]?.redacted).toEqual({ home: 1 });
    expect(existsSync(join(w.dir, "index.json"))).toBe(true);
  });

  it("replaces a planted secret and leaves the evidence clean", async () => {
    const { text: secret } = buildSample("github-token");
    const w = writer();
    await w.addText("a.txt", `before\n${secret}\nafter\n`);
    const written = readFileSync(join(w.dir, "a.txt"), "utf8");
    expect(written).toBe("before\n[REDACTED-LINE:github-token]\nafter\n");
    expect(written).not.toContain(secret);
  });

  it("redacts JSONL input line by line", async () => {
    const { text: secret } = buildSample("aws-access-key");
    async function* lines() {
      yield JSON.stringify({ n: 1 });
      yield JSON.stringify({ v: secret });
    }
    const w = writer();
    await w.addJsonl("f.jsonl", lines());
    expect(readFileSync(join(w.dir, "f.jsonl"), "utf8")).toBe(
      `${JSON.stringify({ n: 1 })}\n[REDACTED-LINE:aws-access-key]\n`,
    );
  });

  it("replaces an SI token line from the imported set", async () => {
    const sample = UNSAFE_TOKENS.argvFlags[0].samples[0];
    const w = writer();
    await w.addText("help.txt", `usage ${sample}\nend\n`);
    expect(readFileSync(join(w.dir, "help.txt"), "utf8")).toBe("[REDACTED-LINE:si-token]\nend\n");
  });

  it("deletes a file whose secret the redactor missed and reports the class only", async () => {
    const { text: secret } = buildSample("github-token");
    const w = writer({ redact: passthrough });
    const err = await w.addText("leak.txt", `${secret}\n`).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EvidenceSecretError);
    expect((err as EvidenceSecretError).cls).toBe("github-token");
    expect((err as Error).message).toBe("secret in evidence: github-token");
    expect((err as Error).message).not.toContain(secret);
    expect(existsSync(join(w.dir, "leak.txt"))).toBe(false);
  });

  it("deletes a file with an SI token the redactor missed", async () => {
    const sample = UNSAFE_TOKENS.argvFlags[0].samples[0];
    const w = writer({ redact: passthrough });
    const err = await w.addText("leak.txt", `${sample}\n`).catch((e: unknown) => e);
    expect((err as EvidenceSecretError).cls).toBe("si-token");
    expect(existsSync(join(w.dir, "leak.txt"))).toBe(false);
  });

  it("redacts the criteria text in the index", async () => {
    const { text: secret } = buildSample("github-token");
    const w = writer();
    const index = await w.finish(
      outcome("PASS", secret),
      { id: "q2", runBy: "owner" },
      { node: "22" },
    );
    expect(index.criteria[0]?.observed).toBe("[REDACTED-LINE:github-token]");
    expect(readFileSync(join(w.dir, "index.json"), "utf8")).not.toContain(secret);
  });

  it("writes stop=false by default and stop=true with a reason when the outcome sets it", async () => {
    const off = await writer().finish(outcome("PASS"), { id: "q2", runBy: "loop" }, { node: "22" });
    expect(off.stop).toBe(false);
    expect(off.stopReason).toBeUndefined();
    const w = writer();
    const on = await w.finish(
      { ...outcome("FAIL"), stop: { reason: "both FAIL" } },
      { id: "q3b", runBy: "loop" },
      { node: "22" },
    );
    expect(on.stop).toBe(true);
    const disk = JSON.parse(readFileSync(join(w.dir, "index.json"), "utf8"));
    expect(disk.stop).toBe(true);
    expect(disk.stopReason).toBe("both FAIL");
  });

  it("records the home-profile option in the index, false by default", async () => {
    const off = await writer().finish(
      outcome("PASS"),
      { id: "q43", runBy: "loop" },
      { node: "22" },
    );
    expect(off.options).toEqual({ allowHomeProfile: false });
    const w = writer();
    const on = await w.finish(
      outcome("PASS"),
      { id: "q43", runBy: "loop", allowHomeProfile: true },
      { node: "22" },
    );
    expect(on.options).toEqual({ allowHomeProfile: true });
    const disk = JSON.parse(readFileSync(join(w.dir, "index.json"), "utf8"));
    expect(disk.options).toEqual({ allowHomeProfile: true });
  });

  it("refuses a file name that leaves the evidence folder", async () => {
    await expect(writer().addText("../x.txt", "a")).rejects.toThrow("invalid evidence file name");
  });
});

describe("publishNamedCopy", () => {
  function source(): string {
    const from = join(root, "src.json");
    writeFileSync(from, "{}\n/Users/someone/x\n");
    return from;
  }

  it("writes a redacted regular-file copy for PASS and PARTIAL", () => {
    for (const result of ["PASS", "PARTIAL"] as const) {
      const target = join(root, "spike", "hc", "schema.json");
      rmSync(target, { force: true });
      const done = publishNamedCopy("q2", source(), {
        repoRoot: root,
        result,
        home: "/Users/someone",
        realHome: "/Users/someone",
        env: {},
      });
      expect(done).toBe(true);
      expect(lstatSync(target).isFile()).toBe(true);
      expect(lstatSync(target).isSymbolicLink()).toBe(false);
      expect(readFileSync(target, "utf8")).toBe("{}\n~/x\n");
    }
  });

  it("writes nothing for FAIL and pending", () => {
    for (const result of ["FAIL", "pending"] as const) {
      const done = publishNamedCopy("q3", source(), { repoRoot: root, result });
      expect(done).toBe(false);
      expect(existsSync(join(root, "spike", "kiro", "q3.jsonl"))).toBe(false);
    }
  });

  it("replaces a symlink at the target with a regular file", () => {
    const target = join(root, "spike", "kiro", "q3.jsonl");
    mkdirSync(join(root, "spike", "kiro"), { recursive: true });
    const other = join(root, "other.txt");
    writeFileSync(other, "keep");
    // The copy must replace the link, not write through it.
    symlinkSync(other, target);
    publishNamedCopy("q3", source(), { repoRoot: root, result: "PASS", env: {} });
    expect(lstatSync(target).isSymbolicLink()).toBe(false);
    expect(readFileSync(other, "utf8")).toBe("keep");
  });
});
