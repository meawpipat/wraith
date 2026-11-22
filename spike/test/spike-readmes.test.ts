import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseArgs } from "../run.ts";

const SPIKE_DIR = fileURLToPath(new URL("..", import.meta.url));

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "test" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const COMMAND = /pnpm spike((?: +(?:--[a-z-]+|[a-z][a-z0-9-]*))*)/g;

interface Found {
  file: string;
  line: number;
  command: string;
  argv: string[];
}

function commandsIn(file: string): Found[] {
  const found: Found[] = [];
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((text, i) => {
    for (const m of text.matchAll(COMMAND)) {
      const argv = (m[1] ?? "").split(/\s+/).filter((a) => a !== "");
      if (argv.length === 0) continue; // `pnpm spike` alone, or followed by a placeholder
      found.push({
        file: relative(SPIKE_DIR, file),
        line: i + 1,
        command: `pnpm spike ${argv.join(" ")}`,
        argv,
      });
    }
  });
  return found;
}

const files = walk(SPIKE_DIR, []);
const readmes = files.filter((f) => f.endsWith("README.md"));
const sources = files.filter((f) => f.endsWith(".ts"));

describe("spike README and source command forms", () => {
  it("finds the READMEs and the commands in them", () => {
    expect(readmes.length).toBeGreaterThanOrEqual(10);
    expect(readmes.flatMap(commandsIn).length).toBeGreaterThan(10);
  });

  it("accepts every `pnpm spike ...` command in a README with parseArgs", () => {
    const bad = readmes
      .flatMap(commandsIn)
      .filter((c) => "error" in parseArgs(c.argv))
      .map((c) => `${c.file}:${c.line} ${c.command}`);
    expect(bad).toEqual([]);
  });

  it("accepts every `pnpm spike ...` command in the strings of spike/**/*.ts", () => {
    const bad = sources
      .flatMap(commandsIn)
      .filter((c) => "error" in parseArgs(c.argv))
      .map((c) => `${c.file}:${c.line} ${c.command}`);
    expect(bad).toEqual([]);
  });

  it("rejects the old `run` subcommand form", () => {
    expect(parseArgs(["run", "q3"])).toHaveProperty("error");
  });
});
