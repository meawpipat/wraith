// Source-rule scan of packages/crypto/src (design: "Module dependency rules and diagram", "Failure guard").
// Validates: Requirements 1.1, 1.3, 1.4, 1.5, 3.1, 3.2, 4.7, 6.16, 2.9
// Node-only: reads src from disk. Reuses the comment-masking scanner of the protocol script.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { scan } from "../../protocol/scripts/check-boundaries.ts";

interface SourceFile {
  readonly path: string; // relative to src, e.g. "keys.ts"
  readonly text: string;
}
interface Hit {
  readonly file: string;
  readonly rule: string;
  readonly message: string;
}

const PROTOCOL = "@wraith/protocol";
const PROTOCOL_IMPORTERS = ["keys.ts", "scope-bytes.ts", "sign.ts", "request-hash.ts", "errors.ts"];
/** Relative imports each constrained module may have (owner decision: bytes and webcrypto may use errors). */
const RELATIVE_ALLOWED: Readonly<Record<string, readonly string[]>> = {
  "errors.ts": [],
  "guard.ts": [],
  "webcrypto.ts": ["./errors.js"],
  "bytes.ts": ["./errors.js"],
  "p256.ts": [],
  "jcs.ts": ["./utf8.js", "./errors.js"],
};
const VERIFIERS = ["verify", "verifyBytes"];
/** Identifiers that must never be an argument of a p256 call in keys.ts (only coordinates and the parity bit). */
const SECRET_IDENTIFIERS = ["d", "privateKey", "private", "secret", "sig", "signature", "scalar"];
const P256_FUNCTIONS = ["bigIntToBytes32", "bytesToBigInt", "decompress", "isOnCurve"];

interface Import {
  readonly spec: string;
  readonly typeOnly: boolean;
}

function importsOf(text: string): Import[] {
  const { code, noComments } = scan(text);
  const out: Import[] = [];
  const re = /(?:\bfrom\s*|\bimport\s*\(?\s*)(["'])/g;
  for (let m = re.exec(code); m !== null; m = re.exec(code)) {
    const start = m.index + m[0].length;
    const end = noComments.indexOf(m[1] as string, start);
    if (end < 0) continue;
    const head = code.slice(0, m.index);
    const stmtStart = Math.max(head.lastIndexOf("import"), head.lastIndexOf("export"));
    const stmt = code.slice(Math.max(stmtStart, 0), m.index);
    out.push({
      spec: noComments.slice(start, end),
      typeOnly: /^(?:import|export)\s+type\b/.test(stmt),
    });
  }
  return out;
}

function balancedEnd(s: string, open: number): number {
  const pair: Record<string, string> = { "(": ")", "{": "}", "[": "]" };
  const o = s[open] as string;
  const c = pair[o] as string;
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === o) depth++;
    else if (s[i] === c && --depth === 0) return i;
  }
  return -1;
}

function checkImports(files: readonly SourceFile[]): Hit[] {
  const hits: Hit[] = [];
  for (const f of files) {
    const add = (rule: string, message: string): void => {
      hits.push({ file: f.path, rule, message });
    };
    const allowedRel = RELATIVE_ALLOWED[f.path];
    for (const imp of importsOf(f.text)) {
      const { spec } = imp;
      if (spec === PROTOCOL || spec.startsWith(`${PROTOCOL}/`)) {
        if (spec !== PROTOCOL) add("protocol-bare", `deep import "${spec}"`);
        if (!PROTOCOL_IMPORTERS.includes(f.path))
          add("protocol-importers", `${f.path} imports ${PROTOCOL}`);
        if (f.path === "errors.ts" && !imp.typeOnly)
          add("errors-types-only", "errors.ts imports a value from protocol");
      } else if (spec.startsWith(".")) {
        if (/(^|\/)(scripts|test)(\/|$)/.test(spec) || spec.startsWith("../")) {
          add("no-scripts-test", `imports "${spec}"`);
        }
        if (allowedRel !== undefined && !allowedRel.includes(spec))
          add("relative-imports", `imports "${spec}"`);
      } else {
        if (/^(zod|@noble\/)/.test(spec)) add("forbidden-module", `imports "${spec}"`);
        if (allowedRel !== undefined) add("relative-imports", `imports external "${spec}"`);
      }
    }
  }
  return hits;
}

function checkTokens(files: readonly SourceFile[]): Hit[] {
  const hits: Hit[] = [];
  const tokens: [string, RegExp][] = [
    ["Math.random", /\bMath\s*\.\s*random\b/],
    ["JSON.stringify", /\bJSON\s*\.\s*stringify\b/],
    ["console.", /\bconsole\s*\./],
  ];
  for (const f of files) {
    const { code } = scan(f.text);
    for (const [name, re] of tokens) {
      if (re.test(code))
        hits.push({ file: f.path, rule: "forbidden-token", message: `uses ${name}` });
    }
  }
  return hits;
}

function checkIndex(files: readonly SourceFile[]): Hit[] {
  const hits: Hit[] = [];
  for (const f of files.filter((x) => x.path === "index.ts")) {
    const { code } = scan(f.text);
    const rest = code.replace(
      /\bexport\s+(?:type\s+)?(?:\{[^}]*\}|\*(?:\s+as\s+\w+)?)\s*from\s*(["'])[ ]*\1\s*;?/g,
      "",
    );
    if (rest.trim() !== "")
      hits.push({ file: f.path, rule: "index-reexports-only", message: rest.trim().slice(0, 40) });
  }
  return hits;
}

function checkKeysP256Calls(files: readonly SourceFile[]): Hit[] {
  const hits: Hit[] = [];
  for (const f of files.filter((x) => x.path === "keys.ts")) {
    const { code } = scan(f.text);
    const re = new RegExp(`\\b(${P256_FUNCTIONS.join("|")})\\s*\\(`, "g");
    for (let m = re.exec(code); m !== null; m = re.exec(code)) {
      const open = m.index + m[0].length - 1;
      const end = balancedEnd(code, open);
      const args = end < 0 ? "" : code.slice(open + 1, end);
      for (const id of SECRET_IDENTIFIERS) {
        if (new RegExp(`(?<![\\w.])${id}(?![\\w])`).test(args)) {
          hits.push({
            file: f.path,
            rule: "p256-coordinates-only",
            message: `${m[1]}(${args.trim()}) uses ${id}`,
          });
        }
      }
    }
  }
  return hits;
}

/** Exported verifiers (functions or const arrow functions) whose name starts with `verify`. */
function exportedVerifiers(f: SourceFile): { name: string; body: string | null }[] {
  const { code } = scan(f.text);
  const out: { name: string; body: string | null }[] = [];
  const fn = /\bexport\s+(?:async\s+)?function\s+(verify\w*)\s*(?:<[^>]*>)?\s*\(/g;
  for (let m = fn.exec(code); m !== null; m = fn.exec(code)) {
    const closeParen = balancedEnd(code, m.index + m[0].length - 1);
    const brace = closeParen < 0 ? -1 : code.indexOf("{", closeParen);
    const end = brace < 0 ? -1 : balancedEnd(code, brace);
    out.push({ name: m[1] as string, body: end < 0 ? null : code.slice(brace + 1, end) });
  }
  const other = /\bexport\s+(?:const|let|var)\s+(verify\w*)\b/g;
  for (let m = other.exec(code); m !== null; m = other.exec(code))
    out.push({ name: m[1] as string, body: null });
  return out;
}

function isSingleFailClosedReturn(body: string): boolean {
  const t = body.trim().replace(/;$/, "").trim();
  const head = /^return\s+failClosed\s*\(/.exec(t);
  if (head === null) return false;
  return balancedEnd(t, head[0].length - 1) === t.length - 1;
}

function checkVerifiers(files: readonly SourceFile[], list: readonly string[]): Hit[] {
  const hits: Hit[] = [];
  const found = new Set<string>();
  for (const f of files) {
    for (const v of exportedVerifiers(f)) {
      found.add(v.name);
      if (!list.includes(v.name))
        hits.push({ file: f.path, rule: "verifier-list", message: `${v.name} not in list` });
      if (v.body === null || !isSingleFailClosedReturn(v.body)) {
        hits.push({
          file: f.path,
          rule: "verifier-body",
          message: `${v.name} is not a single return failClosed(...)`,
        });
      }
    }
  }
  for (const name of list) {
    if (!found.has(name))
      hits.push({
        file: "(src)",
        rule: "verifier-list",
        message: `${name} listed but not exported`,
      });
  }
  return hits;
}

function allRules(files: readonly SourceFile[], list: readonly string[]): Hit[] {
  return [
    ...checkImports(files),
    ...checkTokens(files),
    ...checkIndex(files),
    ...checkKeysP256Calls(files),
    ...checkVerifiers(files, list),
  ];
}

function listTs(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...listTs(p));
    else if (e.name.endsWith(".ts")) out.push(p);
  }
  return out.sort();
}

const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const srcFiles: SourceFile[] = listTs(srcDir).map((p) => ({
  path: relative(srcDir, p),
  text: readFileSync(p, "utf8"),
}));

describe("source rules on packages/crypto/src", () => {
  it("scans the real source files", () => {
    expect(srcFiles.length).toBeGreaterThan(10);
  });

  it("reports no violation", () => {
    expect(allRules(srcFiles, VERIFIERS)).toEqual([]);
  });
});

describe("source rules self-check (each rule reports a violation)", () => {
  const rule = (hits: Hit[], name: string): boolean => hits.some((h) => h.rule === name);
  const one = (path: string, text: string): SourceFile[] => [{ path, text }];

  it("flags a relative import outside the allowed edges", () => {
    expect(
      rule(checkImports(one("guard.ts", 'import { x } from "./errors.js";')), "relative-imports"),
    ).toBe(true);
    expect(
      rule(checkImports(one("bytes.ts", 'import { x } from "./utf8.js";')), "relative-imports"),
    ).toBe(true);
    expect(
      rule(checkImports(one("jcs.ts", 'import { x } from "./bytes.js";')), "relative-imports"),
    ).toBe(true);
    expect(checkImports(one("bytes.ts", 'import { x } from "./errors.js";'))).toEqual([]);
    expect(
      checkImports(
        one("jcs.ts", 'import { x } from "./utf8.js";\nimport { y } from "./errors.js";'),
      ),
    ).toEqual([]);
  });

  it("flags protocol imports from a non-importer, deep paths and value imports in errors.ts", () => {
    expect(
      rule(
        checkImports(one("jcs.ts", 'import type { A } from "@wraith/protocol";')),
        "protocol-importers",
      ),
    ).toBe(true);
    expect(
      rule(
        checkImports(one("sign.ts", 'import { A } from "@wraith/protocol/dist/x.js";')),
        "protocol-bare",
      ),
    ).toBe(true);
    expect(
      rule(
        checkImports(one("errors.ts", 'import { A } from "@wraith/protocol";')),
        "errors-types-only",
      ),
    ).toBe(true);
    expect(checkImports(one("errors.ts", 'import type { A } from "@wraith/protocol";'))).toEqual(
      [],
    );
  });

  it("flags imports of scripts/ or test/", () => {
    expect(
      rule(checkImports(one("sign.ts", 'import { x } from "../scripts/a.js";')), "no-scripts-test"),
    ).toBe(true);
    expect(
      rule(checkImports(one("sign.ts", 'import { x } from "./test/a.js";')), "no-scripts-test"),
    ).toBe(true);
  });

  it("flags zod and @noble imports", () => {
    expect(rule(checkImports(one("sign.ts", 'import { z } from "zod";')), "forbidden-module")).toBe(
      true,
    );
    expect(
      rule(
        checkImports(one("sign.ts", 'import { p } from "@noble/curves/p256";')),
        "forbidden-module",
      ),
    ).toBe(true);
  });

  it("flags forbidden tokens and ignores comments and strings", () => {
    expect(rule(checkTokens(one("a.ts", "const r = Math.random();")), "forbidden-token")).toBe(
      true,
    );
    expect(rule(checkTokens(one("a.ts", "const r = JSON.stringify(x);")), "forbidden-token")).toBe(
      true,
    );
    expect(rule(checkTokens(one("a.ts", 'console.log("x");')), "forbidden-token")).toBe(true);
    expect(
      checkTokens(one("a.ts", '// Math.random()\nconst s = "JSON.stringify console.log";')),
    ).toEqual([]);
  });

  it("flags non re-export content in index.ts", () => {
    expect(
      rule(
        checkIndex(one("index.ts", 'export { a } from "./a.js";\nconst x = 1;')),
        "index-reexports-only",
      ),
    ).toBe(true);
    expect(
      checkIndex(
        one("index.ts", '// c\nexport { a } from "./a.js";\nexport type { B } from "./b.js";'),
      ),
    ).toEqual([]);
  });

  it("flags a p256 call that receives a secret", () => {
    expect(
      rule(
        checkKeysP256Calls(one("keys.ts", "const n = bytesToBigInt(d);")),
        "p256-coordinates-only",
      ),
    ).toBe(true);
    expect(
      checkKeysP256Calls(one("keys.ts", "const n = bytesToBigInt(x); decompress(prefix, n);")),
    ).toEqual([]);
  });

  it("flags verifiers outside the list or not a single failClosed return", () => {
    const good =
      "export async function verifyA(a: unknown): Promise<boolean> {\n  return failClosed(async () => impl(a));\n}";
    expect(checkVerifiers(one("s.ts", good), ["verifyA"])).toEqual([]);
    expect(rule(checkVerifiers(one("s.ts", good), []), "verifier-list")).toBe(true);
    expect(rule(checkVerifiers([], ["verifyA"]), "verifier-list")).toBe(true);
    const twoStatements =
      "export async function verifyA(a: unknown): Promise<boolean> {\n  log();\n  return failClosed(() => true);\n}";
    expect(rule(checkVerifiers(one("s.ts", twoStatements), ["verifyA"]), "verifier-body")).toBe(
      true,
    );
    const trailing =
      "export async function verifyA(a: unknown): Promise<boolean> {\n  return failClosed(() => true) && x;\n}";
    expect(rule(checkVerifiers(one("s.ts", trailing), ["verifyA"]), "verifier-body")).toBe(true);
    const arrow = "export const verifyA = async () => failClosed(() => true);";
    expect(rule(checkVerifiers(one("s.ts", arrow), ["verifyA"]), "verifier-body")).toBe(true);
  });
});
