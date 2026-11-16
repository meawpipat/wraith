import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatFinding, ToolError } from "../lib/finding.ts";
import { scanText } from "../lib/secret-rules.ts";
import { main, parseArgs, runSecretScan } from "../secret-scan.ts";
import { pbt } from "./config.ts";
import { DECOYS, SECRET_SAMPLES, type SecretSample } from "./support/samples.ts";

// Property 1: The Secret_Scan finds every embedded secret at its line.
// Validates: Requirements 3.1, 3.2, 3.3

const WORDS = ["alpha", "beta", "note", "build", "value", "text", "table", "lorem"] as const;

const benignLineArb = fc
  .array(fc.constantFrom(...WORDS), { minLength: 0, maxLength: 5 })
  .map((words) => words.join(" "));

function bodyArb(sample: SecretSample): fc.Arbitrary<string> {
  return fc
    .array(fc.constantFrom(...sample.alphabet.split("")), {
      minLength: sample.bodyLength,
      maxLength: sample.bodyLength,
    })
    .map((chars) => chars.join(""))
    .filter((body) => new Set(body).size >= 3);
}

interface Embedding {
  readonly body: string;
  readonly prefix: string;
  readonly gap: readonly string[];
}

function embeddingArb(sample: SecretSample): fc.Arbitrary<Embedding> {
  return fc.record({
    body: bodyArb(sample),
    prefix: fc.constantFrom("", "alpha ", "beta note "),
    gap: fc.array(benignLineArb, { minLength: 0, maxLength: 3 }),
  });
}

describe("Property 1: The Secret_Scan finds every embedded secret at its line", () => {
  for (const sample of SECRET_SAMPLES) {
    const multiLine = sample.cls === "pem-private-key";
    const single = sample.cls === "node-key";

    it(`Feature: s-ops-packaging, Property 1: ${sample.cls}`, () => {
      if (single) {
        // The node.key file name selects the class: one finding at the first non-blank line.
        pbt(
          fc.property(
            bodyArb(sample),
            fc.nat(4),
            fc.array(benignLineArb, { maxLength: 3 }),
            (body, blanks, after) => {
              const text = [...Array<string>(blanks).fill(""), sample.build(body), ...after].join(
                "\n",
              );
              const found = scanText(sample.fileName, text);
              return (
                found.length === 1 &&
                found[0]?.rule === `secret/${sample.cls}` &&
                found[0]?.line === blanks + 1
              );
            },
          ),
        );
        return;
      }

      pbt(
        fc.property(
          fc.array(embeddingArb(sample), { minLength: 1, maxLength: 4 }),
          fc.array(benignLineArb, { maxLength: 3 }),
          (embeddings, lead) => {
            const lines: string[] = [...lead];
            let lineCount = lead.length;
            const expected: number[] = [];
            for (const e of embeddings) {
              for (const g of e.gap) {
                lines.push(g);
                lineCount += 1;
              }
              expected.push(lineCount + 1);
              const built = (multiLine ? "" : e.prefix) + sample.build(e.body);
              lines.push(built);
              // A multi-line sample occupies several lines.
              lineCount += built.split("\n").length;
            }
            const text = lines.join("\n");
            const found = scanText(sample.fileName, text);
            const lineNumbers = found.map((f) => f.line);
            return (
              found.length === expected.length &&
              found.every((f) => f.rule === `secret/${sample.cls}`) &&
              lineNumbers.join(",") === expected.join(",")
            );
          },
        ),
      );
    });
  }
});

// Property 2: Reports never contain scanned content.
// Validates: Requirements 3.1, 3.13, 3.17

const MIN_LEAK = 8;

function windows(source: string): string[] {
  const out: string[] = [];
  for (let i = 0; i + MIN_LEAK <= source.length; i++) out.push(source.slice(i, i + MIN_LEAK));
  return out;
}

describe("Property 2: Reports never contain scanned content", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  for (const sample of SECRET_SAMPLES) {
    it(`Feature: s-ops-packaging, Property 2: ${sample.cls}`, () => {
      const dir = mkdtempSync(join(tmpdir(), "wraith-scan-"));
      try {
        pbt(
          fc.property(
            bodyArb(sample),
            fc.array(benignLineArb, { minLength: 1, maxLength: 3 }),
            fc.array(benignLineArb, { maxLength: 3 }),
            (body, lead, tail) => {
              const secret = sample.build(body);
              const text = [...lead, secret, ...tail].join("\n");
              writeFileSync(join(dir, sample.fileName), text);

              const result = runSecretScan({ kind: "paths", paths: [sample.fileName] }, dir);
              const lines = result.findings.map(formatFinding);

              const logged: string[] = [];
              const errors: string[] = [];
              vi.spyOn(console, "log").mockImplementation((m: unknown) => {
                logged.push(String(m));
              });
              vi.spyOn(console, "error").mockImplementation((m: unknown) => {
                errors.push(String(m));
              });
              main([sample.fileName], dir);
              main([`--${body}`], dir);
              main([join("missing", body.slice(0, 4))], dir);
              vi.restoreAllMocks();

              const messages: string[] = [];
              try {
                parseArgs([`--${body}`]);
              } catch (e) {
                if (e instanceof ToolError) messages.push(e.message);
              }
              try {
                runSecretScan({ kind: "paths", paths: ["."] }, dir);
              } catch (e) {
                if (e instanceof ToolError) messages.push(e.message);
              }

              const reports = [...lines, ...logged, ...errors, ...messages];
              const needles = new Set<string>();
              for (const src of [secret, body, text, ...lead, ...tail]) {
                for (const w of windows(src)) needles.add(w);
              }
              const leaks = reports.some((r) => [...needles].some((n) => r.includes(n)));

              const keysOk = result.findings.every((f) =>
                Object.keys(f).every((k) => ["file", "line", "column", "rule"].includes(k)),
              );
              return !leaks && keysOk && result.findings.length >= 1 && messages.length === 2;
            },
          ),
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
      expect(true).toBe(true);
    });
  }
});

// Property 3: Decoys and near-misses are accepted.
// Validates: Requirements 3.5, 3.6

describe("Property 3: Decoys and near-misses are accepted", () => {
  for (const decoy of DECOYS) {
    it(`Feature: s-ops-packaging, Property 3: ${decoy.kind}`, () => {
      pbt(
        fc.property(
          fc.array(benignLineArb, { maxLength: 3 }),
          fc.array(benignLineArb, { maxLength: 3 }),
          (lead, tail) => {
            const text = [...lead, decoy.build(), ...tail].join("\n");
            return scanText(decoy.fileName, text).length === 0;
          },
        ),
      );
    });
  }
});
