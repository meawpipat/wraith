import { resolve } from "node:path";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { findDirectHcSpawn, scanSpikeTree } from "../lib/no-direct-hc.ts";
import { pbt } from "./config.ts";

// Feature: s-spikes, Property 10: The direct-spawn detector

const FNS = ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"];
const SHELL_FNS = ["exec", "execSync"];
const BAD = ["hc", "herdr-core", "hold"];
const OK = ["node", "git", "ls", "echo", "tsc"];
const KILL = ["pkill", "killall"];

interface Snippet {
  code: string;
  hit: boolean;
}

const pick = (xs: string[]): fc.Arbitrary<string> => fc.constantFrom(...xs);

const snippet: fc.Arbitrary<Snippet> = fc.oneof(
  fc.tuple(pick(FNS), pick(BAD)).map(([f, p]) => ({ code: `${f}("${p}", ["a"]);`, hit: true })),
  fc.tuple(pick(FNS), pick(OK)).map(([f, p]) => ({ code: `${f}("${p}", ["a"]);`, hit: false })),
  fc
    .tuple(pick(SHELL_FNS), pick(BAD))
    .map(([f, p]) => ({ code: `${f}("${p} ls --all");`, hit: true })),
  fc.tuple(pick(SHELL_FNS), pick(OK), pick(BAD)).map(([f, a, p]) => ({
    code: `${f}("${a} x && ${p} y");`,
    hit: true,
  })),
  fc.tuple(pick(SHELL_FNS), pick(OK)).map(([f, p]) => ({ code: `${f}("${p} a");`, hit: false })),
  fc.tuple(pick(FNS), pick(KILL), pick(BAD)).map(([f, k, p]) => ({
    code: `${f}("${k}", ["-f", "${p}"]);`,
    hit: true,
  })),
  fc.tuple(pick(SHELL_FNS), pick(KILL), pick(BAD)).map(([f, k, p]) => ({
    code: `${f}("${k} -f ${p}");`,
    hit: true,
  })),
  fc.tuple(pick(FNS), pick(KILL), pick(OK)).map(([f, k, p]) => ({
    code: `${f}("${k}", ["${p}"]);`,
    hit: false,
  })),
  // program held in a variable; a name only in the argument list is not the program
  fc.tuple(pick(FNS), pick(BAD)).map(([f, p]) => ({ code: `${f}(prog, ["${p}"]);`, hit: false })),
  // strings that are not spawn arguments
  pick(BAD).map((p) => ({ code: `const s = "${p}";`, hit: false })),
  pick(BAD).map((p) => ({ code: `log("${p} ls");`, hit: false })),
  // comments
  fc.tuple(pick(FNS), pick(BAD)).map(([f, p]) => ({ code: `// ${f}("${p}", [])`, hit: false })),
  fc
    .tuple(pick(FNS), pick(BAD))
    .map(([f, p]) => ({ code: `/* ${f}("${p}") */ const x = 1;`, hit: false })),
);

const lineOf = (hit: string): number => Number(hit.slice(hit.lastIndexOf(":") + 1));

describe("no-direct-hc detector", () => {
  it("Property 10: reports exactly the lines whose call names the program", () => {
    pbt(
      fc.property(fc.array(snippet, { minLength: 1, maxLength: 12 }), (snippets) => {
        const text = snippets.map((s) => s.code).join("\n");
        const expected = snippets.flatMap((s, i) => (s.hit ? [i + 1] : []));
        const got = findDirectHcSpawn("spike/hc/probe.ts", text).map(lineOf);
        expect(got).toEqual(expected);
      }),
    );
  });

  it("Property 10: lib/hc.ts is exempt by path", () => {
    pbt(
      fc.property(snippet, ({ code }) => {
        const bad = `${"spawn"}("${"hc"}", [])\n${code}`;
        expect(findDirectHcSpawn("spike/lib/hc.ts", bad)).toEqual([]);
        expect(findDirectHcSpawn("lib/hc.ts", bad)).toEqual([]);
        expect(findDirectHcSpawn("spike/lib/other.ts", bad).length).toBeGreaterThan(0);
      }),
    );
  });

  it("flags a call that spans lines on the line of the call name", () => {
    const text = ["const a = 1;", `${"spawn"}(`, `  "${"herdr-core"}",`, ");"].join("\n");
    expect(findDirectHcSpawn("spike/x.ts", text)).toEqual(["spike/x.ts:2"]);
  });

  it("flags no file of the real spike tree outside lib/hc.ts", () => {
    const root = resolve(import.meta.dirname, "../..");
    expect(scanSpikeTree(root)).toEqual([]);
  });
});
