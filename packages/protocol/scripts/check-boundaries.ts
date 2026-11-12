// Runtime-independence check for @wraith/protocol (R22.1 to R22.4).
// Node-only script: not part of src/, never imported by it.
// Run: node --experimental-strip-types scripts/check-boundaries.ts

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export interface SourceFile {
  readonly path: string;
  readonly text: string;
}

export interface Violation {
  readonly file: string;
  readonly line: number;
  readonly message: string;
}

const FORBIDDEN_MODULE = /^(node|cloudflare|bun):/;
const FORBIDDEN_IDENTIFIERS = ["Buffer", "window", "document", "localStorage"] as const;
const REGEX_PRECEDING_KEYWORDS = new Set([
  "return",
  "typeof",
  "case",
  "in",
  "of",
  "instanceof",
  "void",
  "delete",
  "throw",
  "new",
  "else",
  "do",
  "yield",
  "await",
]);

interface Scanned {
  /** Comments, string/template contents and regex bodies blanked (same offsets as the source). */
  readonly code: string;
  /** Comments blanked only; string contents kept (same offsets as the source). */
  readonly noComments: string;
}

const blank = (ch: string): string => (ch === "\n" || ch === "\r" ? ch : " ");

/** Lexical pass that separates code from comments, strings, templates and regex literals. */
export function scan(src: string): Scanned {
  const code: string[] = [];
  const noComments: string[] = [];
  // Stack of template nesting: each entry is the brace depth at which a `${` opened.
  const templateStack: number[] = [];
  let braceDepth = 0;
  let lastSignificant = ""; // last non-space code char
  let lastWord = ""; // last identifier-like word, when lastSignificant ends a word

  const emit = (c: string, n: string): void => {
    code.push(c);
    noComments.push(n);
  };
  const emitCode = (ch: string): void => emit(ch, ch);
  const emitMasked = (ch: string): void => emit(blank(ch), ch);
  const emitComment = (ch: string): void => emit(blank(ch), blank(ch));

  let i = 0;
  const n = src.length;

  // Reads template characters until the closing backtick or a `${`.
  const readTemplate = (): void => {
    while (i < n) {
      const ch = src[i] as string;
      if (ch === "\\") {
        emitMasked(ch);
        i++;
        if (i < n) emitMasked(src[i] as string);
        i++;
        continue;
      }
      if (ch === "`") {
        emitCode(ch);
        i++;
        lastSignificant = "`";
        lastWord = "";
        return;
      }
      if (ch === "$" && src[i + 1] === "{") {
        emitCode("$");
        emitCode("{");
        i += 2;
        templateStack.push(braceDepth);
        braceDepth++;
        lastSignificant = "{";
        lastWord = "";
        return;
      }
      emitMasked(ch);
      i++;
    }
  };

  while (i < n) {
    const ch = src[i] as string;
    const next = src[i + 1];

    if (ch === "/" && next === "/") {
      while (i < n && src[i] !== "\n") {
        emitComment(src[i] as string);
        i++;
      }
      continue;
    }
    if (ch === "/" && next === "*") {
      emitComment("/");
      emitComment("*");
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        emitComment(src[i] as string);
        i++;
      }
      if (i < n) {
        emitComment("*");
        emitComment("/");
        i += 2;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      emitCode(ch);
      i++;
      while (i < n && src[i] !== ch && src[i] !== "\n") {
        if (src[i] === "\\") {
          emitMasked("\\");
          i++;
          if (i < n) {
            emitMasked(src[i] as string);
            i++;
          }
          continue;
        }
        emitMasked(src[i] as string);
        i++;
      }
      if (i < n && src[i] === ch) {
        emitCode(ch);
        i++;
      }
      lastSignificant = ch;
      lastWord = "";
      continue;
    }
    if (ch === "`") {
      emitCode(ch);
      i++;
      readTemplate();
      continue;
    }
    if (
      ch === "}" &&
      templateStack.length > 0 &&
      templateStack[templateStack.length - 1] === braceDepth - 1
    ) {
      templateStack.pop();
      braceDepth--;
      emitCode(ch);
      i++;
      readTemplate();
      continue;
    }
    if (ch === "/") {
      const isRegex =
        lastSignificant === "" ||
        !/[\w$)\]}'"`]/.test(lastSignificant) ||
        (lastWord !== "" && REGEX_PRECEDING_KEYWORDS.has(lastWord));
      if (isRegex) {
        emitCode("/");
        i++;
        let inClass = false;
        while (i < n && src[i] !== "\n") {
          const c = src[i] as string;
          if (c === "\\") {
            emitMasked(c);
            i++;
            if (i < n && src[i] !== "\n") {
              emitMasked(src[i] as string);
              i++;
            }
            continue;
          }
          if (c === "[") inClass = true;
          else if (c === "]") inClass = false;
          else if (c === "/" && !inClass) break;
          emitMasked(c);
          i++;
        }
        if (i < n && src[i] === "/") {
          emitCode("/");
          i++;
        }
        lastSignificant = "/";
        lastWord = "";
        continue;
      }
    }

    if (ch === "{") braceDepth++;
    else if (ch === "}") braceDepth--;
    emitCode(ch);
    i++;
    if (/\s/.test(ch)) continue;
    lastSignificant = ch;
    if (/[\w$]/.test(ch)) {
      // accumulate the word that ends here
      let j = i - 1;
      while (j >= 0 && /[\w$]/.test(src[j] as string)) j--;
      lastWord = src.slice(j + 1, i);
    } else {
      lastWord = "";
    }
  }
  return { code: code.join(""), noComments: noComments.join("") };
}

const lineOf = (text: string, offset: number): number => {
  let line = 1;
  for (let k = 0; k < offset; k++) if (text[k] === "\n") line++;
  return line;
};

/** Pure check of in-memory sources. Paths are used only in messages. */
export function checkSources(files: readonly SourceFile[]): Violation[] {
  const out: Violation[] = [];
  for (const file of files) {
    const { code, noComments } = scan(file.text);
    const add = (offset: number, message: string): void => {
      out.push({ file: file.path, line: lineOf(file.text, offset), message });
    };

    // Module specifiers: quote positions are in `code`, contents in `noComments`.
    const specifier = /(?:\bfrom\s*|\bimport\s*\(?\s*|\bimport\s+)(["'])/g;
    for (let m = specifier.exec(code); m !== null; m = specifier.exec(code)) {
      const start = m.index + m[0].length;
      const quote = m[1] as string;
      const end = noComments.indexOf(quote, start);
      if (end < 0) continue;
      const spec = noComments.slice(start, end);
      if (FORBIDDEN_MODULE.test(spec)) {
        add(m.index, `forbidden import of "${spec}" (R22.3)`);
      }
    }

    const req = /\brequire\s*\(/g;
    for (let m = req.exec(code); m !== null; m = req.exec(code)) {
      add(m.index, "forbidden require( (R22.3)");
    }

    for (const id of FORBIDDEN_IDENTIFIERS) {
      const re = new RegExp(`(?<![\\w$.])${id}(?![\\w$])`, "g");
      for (let m = re.exec(code); m !== null; m = re.exec(code)) {
        add(m.index, `forbidden identifier ${id} (R22.1)`);
      }
    }
  }
  return out;
}

/** Pure check of a parsed package.json: `dependencies` may list only `zod` (R22.2). */
export function checkPackageJson(json: unknown, file = "package.json"): Violation[] {
  const deps = (json as { dependencies?: unknown } | null)?.dependencies;
  if (deps === undefined) return [];
  if (typeof deps !== "object" || deps === null || Array.isArray(deps)) {
    return [{ file, line: 1, message: "dependencies must be an object (R22.2)" }];
  }
  return Object.keys(deps)
    .filter((name) => name !== "zod")
    .map((name) => ({
      file,
      line: 1,
      message: `dependency "${name}" is not allowed; only zod (R22.2)`,
    }));
}

function listTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTs(p));
    else if (/\.(ts|tsx|mts|cts)$/.test(entry.name)) out.push(p);
  }
  return out.sort();
}

/** Runs both checks against the real package tree. */
export function checkTree(packageRoot: string): Violation[] {
  const srcDir = join(packageRoot, "src");
  const files = listTs(srcDir).map((p) => ({
    path: relative(packageRoot, p),
    text: readFileSync(p, "utf8"),
  }));
  const pkg: unknown = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
  return [...checkSources(files), ...checkPackageJson(pkg)];
}

const invoked = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (invoked) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const violations = checkTree(root);
  if (violations.length > 0) {
    for (const v of violations) console.error(`${v.file}:${v.line}: ${v.message}`);
    console.error(`check-boundaries: ${violations.length} violation(s)`);
    process.exit(1);
  }
  console.log("check-boundaries: ok");
}
