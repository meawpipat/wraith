import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Source scan (R5.7, R20.3): schemas call the constants from limits.ts and never
// repeat a number. Flags `.min(`, `.max(` and `.length(` whose first argument is a
// numeric literal other than 0 or 1, in src/** outside limits.ts.

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const LIMITS_FILE = "limits.ts";

/**
 * Reviewed exceptions for structural values (not wire limits). Each entry names the
 * file (relative to src/, forward slashes), the exact normalized call text, and why
 * the number is not a limit. Keep this list small; an unused entry fails the suite.
 */
const ALLOWLIST: readonly { file: string; call: string; reason: string }[] = [];

interface Finding {
  call: string;
  line: number;
}

/**
 * Replaces comments, string/template contents and regex literal bodies with spaces
 * (newlines kept), so the scan only sees code and line numbers stay correct.
 */
function blankNonCode(source: string): string {
  const out: string[] = [];
  const n = source.length;
  let i = 0;
  let lastSignificant = "";
  const blank = (s: string) => s.replace(/[^\n]/g, " ");
  while (i < n) {
    const c = source[i] as string;
    const next = source[i + 1];
    if (c === "/" && next === "/") {
      let j = i;
      while (j < n && source[j] !== "\n") j++;
      out.push(blank(source.slice(i, j)));
      i = j;
    } else if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const j = end === -1 ? n : end + 2;
      out.push(blank(source.slice(i, j)));
      i = j;
    } else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < n && source[j] !== c) {
        if (source[j] === "\\") j++;
        j++;
      }
      j = Math.min(j + 1, n);
      out.push(c + blank(source.slice(i + 1, Math.max(i + 1, j - 1))) + (j - 1 > i ? c : ""));
      i = j;
      lastSignificant = c;
    } else if (
      c === "/" &&
      (lastSignificant === "" || "(,=:[!&|?{};+-*%<>~^".includes(lastSignificant))
    ) {
      // Regex literal: skip to the closing slash, honouring escapes and classes.
      let j = i + 1;
      let inClass = false;
      while (j < n && source[j] !== "\n") {
        const d = source[j] as string;
        if (d === "\\") j++;
        else if (d === "[") inClass = true;
        else if (d === "]") inClass = false;
        else if (d === "/" && !inClass) break;
        j++;
      }
      j = Math.min(j + 1, n);
      out.push(blank(source.slice(i, j)));
      i = j;
      lastSignificant = "/";
    } else {
      out.push(c);
      if (!/\s/.test(c)) lastSignificant = c;
      i++;
    }
  }
  return out.join("");
}

// Numeric literal forms: hex/octal/binary, decimal with fraction/exponent, with `_` separators.
const NUMBER =
  "(?:0[xX][0-9a-fA-F](?:_?[0-9a-fA-F])*|0[oO][0-7](?:_?[0-7])*|0[bB][01](?:_?[01])*|(?:\\d(?:_?\\d)*)?\\.?\\d(?:_?\\d)*(?:[eE][+-]?\\d(?:_?\\d)*)?)n?";
const CALL = new RegExp(`\\.\\s*(min|max|length)\\s*\\(\\s*\\+?\\s*(${NUMBER})(?![\\w.])`, "g");

function literalValue(text: string): number {
  return Number(text.replace(/_/g, "").replace(/n$/, ""));
}

/** Returns the calls with a numeric literal other than 0 or 1 in one source. */
function scanSource(source: string): Finding[] {
  const code = blankNonCode(source);
  const findings: Finding[] = [];
  for (const m of code.matchAll(CALL)) {
    const value = literalValue(m[2] as string);
    if (value === 0 || value === 1) continue;
    const index = m.index ?? 0;
    findings.push({
      call: m[0].replace(/\s+/g, ""),
      line: code.slice(0, index).split("\n").length,
    });
  }
  return findings;
}

function srcSources(): { name: string; source: string }[] {
  return readdirSync(SRC_DIR, { recursive: true, encoding: "utf8" })
    .map((p) => p.split("\\").join("/"))
    .filter((p) => /\.(ts|tsx|mts)$/.test(p))
    .filter((p) => p !== LIMITS_FILE)
    .map((name) => ({ name, source: readFileSync(join(SRC_DIR, name), "utf8") }));
}

describe("no literal limits", () => {
  it("self-check: catches literal limits and ignores 0, 1, constants, comments and strings", () => {
    const caught = [
      "z.string().max(4096)",
      "z.string().min(2)",
      "z.array(x).max(1_000)",
      "z.string().max( 0x10 )",
      "z.number().min(1e3)",
      "z.string()\n  .max(\n 64)",
      "z.string().length(32)",
      "z.string().max(1_0)",
      "z.string().max(2n)",
      "z.string().max(1.5)",
    ];
    for (const sample of caught) {
      expect(scanSource(sample), sample).not.toEqual([]);
    }

    const passed = [
      "z.string().min(1)",
      "z.string().min(0).max(1)",
      "z.string().max(0)",
      "z.string().max(0x1)",
      "z.string().max(LIMITS.NAME_CHARS)",
      "z.string().max(KIB * 4)",
      "z.string().max(FOO_CHARS)",
      "// z.string().max(4096)",
      "/* z.string().max(4096) */ z.string()",
      'const s = "x.max(4096)";',
      "const t = `x.min(7)`;",
      "const r = /^[a-z]{0,31}$/;",
      "const r2 = /[/]{2,64}/; z.string().max(MAX)",
      "const ok = a.length * 3 <= 12;",
    ];
    for (const sample of passed) {
      expect(scanSource(sample), sample).toEqual([]);
    }
  });

  it("self-check: reports line numbers and the offending call", () => {
    const found = scanSource("a\n// c\nz.string().max(1_024)\n");
    expect(found).toEqual([{ call: ".max(1_024", line: 3 }]);
  });

  it("allowlist entries carry a reason and a file", () => {
    for (const entry of ALLOWLIST) {
      expect(entry.reason.trim()).not.toBe("");
      expect(entry.file.trim()).not.toBe("");
      expect(entry.file).not.toBe(LIMITS_FILE);
    }
  });

  it("src/** outside limits.ts has no numeric literal other than 0 or 1 in .min/.max/.length", () => {
    const used = new Set<number>();
    const offenders = srcSources().flatMap(({ name, source }) =>
      scanSource(source).flatMap((f) => {
        const idx = ALLOWLIST.findIndex((a) => a.file === name && a.call === f.call);
        if (idx !== -1) {
          used.add(idx);
          return [];
        }
        return [`${name}:${f.line} ${f.call})`];
      }),
    );
    expect(offenders).toEqual([]);
    // A stale allowlist entry hides nothing today but would hide a future violation.
    expect(ALLOWLIST.map((_, i) => i).filter((i) => !used.has(i))).toEqual([]);
  });
});
