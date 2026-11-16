import * as fc from "fast-check";
import { describe, it } from "vitest";
import { checkPlatformSource, isScannedPath } from "../check-platform.ts";
import { pbt } from "./config.ts";

// Property 4: The Platform_Check reports exactly the non-comment tokens.
// Validates: Requirements 5.2, 5.5, 5.10

const TOKENS = [
  { id: "process-platform", text: "process.platform" },
  { id: "os-platform", text: "os.platform()" },
  { id: "os-type", text: "os.type()" },
  { id: "launchctl", text: "launchctl" },
  { id: "systemctl", text: "systemctl" },
  { id: "chmod", text: "chmod" },
  { id: "sighup", text: "SIGHUP" },
  { id: "sigterm", text: "SIGTERM" },
  { id: "tmp-path", text: "/tmp/" },
] as const;

type Kind = "benign" | "code" | "string" | "template" | "line" | "block" | "multi";

interface Placement {
  readonly kind: Kind;
  readonly token: number;
}

const placementArb: fc.Arbitrary<Placement> = fc.record({
  kind: fc.constantFrom<Kind>("benign", "code", "string", "template", "line", "block", "multi"),
  token: fc.nat(TOKENS.length - 1),
});

const PATH = "packages/demo/src/sample.ts";

// Builds the text and the expected (line:rule) set from the model only.
function build(placements: readonly Placement[]): { lines: string[]; expected: string[] } {
  const lines: string[] = [];
  const expected: string[] = [];
  for (const p of placements) {
    const tok = TOKENS[p.token] as (typeof TOKENS)[number];
    const hit = (): void => {
      expected.push(`${lines.length}:platform/${tok.id}`);
    };
    switch (p.kind) {
      case "benign":
        lines.push("const a = 1;");
        break;
      case "code":
        lines.push(`${tok.text};`);
        hit();
        break;
      case "string":
        lines.push(`const s = "${tok.text}";`);
        hit();
        break;
      case "template":
        lines.push(`const t = \`${tok.text}\`;`);
        hit();
        break;
      case "line":
        lines.push(`const c = 2; // ${tok.text}`);
        break;
      case "block":
        lines.push(`/* ${tok.text} */ const d = 3;`);
        break;
      case "multi":
        lines.push("/*", ` * ${tok.text}`, " */");
        break;
    }
  }
  return { lines, expected };
}

// `hit` runs after the push, so lines.length is already the 1-based line number.
function pairs(findings: readonly { line: number; rule: string }[]): string[] {
  return findings.map((f) => `${f.line}:${f.rule}`).sort();
}

describe("Property 4: Platform_Check reports exactly the non-comment tokens", () => {
  it("equals the model's code, string and template placements and ignores comments", () => {
    pbt(
      fc.property(fc.array(placementArb, { maxLength: 30 }), (placements) => {
        const { lines, expected } = build(placements);
        const got = pairs(checkPlatformSource(PATH, lines.join("\n")));
        return JSON.stringify(got) === JSON.stringify([...expected].sort());
      }),
    );
  });

  it("is unchanged when equal lines are swapped", () => {
    pbt(
      fc.property(
        fc.array(placementArb, { maxLength: 30 }),
        fc.nat(),
        fc.nat(),
        (placements, a, b) => {
          const { lines } = build(placements);
          if (lines.length < 2) return true;
          const i = a % lines.length;
          const j = b % lines.length;
          if (lines[i] !== lines[j]) return true;
          const swapped = [...lines];
          swapped[i] = lines[j] as string;
          swapped[j] = lines[i] as string;
          return (
            JSON.stringify(pairs(checkPlatformSource(PATH, lines.join("\n")))) ===
            JSON.stringify(pairs(checkPlatformSource(PATH, swapped.join("\n"))))
          );
        },
      ),
    );
  });
});

// Property 5: The Platform_Check scope is exactly the stated tree.
// Validates: Requirements 5.3, 9.9

const TOP_SEGMENTS = ["apps", "packages", "spike", "tools", "docs"] as const;
const MID_SEGMENTS = [
  "platform",
  "fakes",
  "node_modules",
  "dist",
  "generated",
  "test",
  "src",
  "lib",
] as const;
const EXCLUDED_DIRS: readonly string[] = ["node_modules", "dist", "generated", "test"];
const SCOPE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".css",
  ".test.ts",
  ".test.tsx",
  ".d.ts",
] as const;
const SCANNED_EXTS: readonly string[] = [".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"];
const NON_SCANNED_SUFFIXES: readonly string[] = [".test.ts", ".test.tsx", ".d.ts"];

// The stated predicate, written from the design text and not from the scanner.
function inScope(top: string, mids: readonly string[], ext: string): boolean {
  if (top !== "apps" && top !== "packages") return false;
  if (!SCANNED_EXTS.includes(ext)) return false;
  if (NON_SCANNED_SUFFIXES.includes(ext)) return false;
  if (top === "packages" && (mids[0] === "platform" || mids[0] === "fakes")) return false;
  return !mids.some((m) => EXCLUDED_DIRS.includes(m));
}

describe("Property 5: Platform_Check scope is exactly the stated tree", () => {
  it("scans a path and reports findings if and only if the stated predicate holds", () => {
    pbt(
      fc.property(
        fc.constantFrom(...TOP_SEGMENTS),
        fc.array(fc.constantFrom(...MID_SEGMENTS), { maxLength: 4 }),
        fc.constantFrom(...SCOPE_EXTENSIONS),
        (top, mids, ext) => {
          const path = [top, ...mids, `file${ext}`].join("/");
          const expected = inScope(top, mids, ext);
          const findings = checkPlatformSource(path, "process.platform;");
          return (
            isScannedPath(path) === expected &&
            findings.length > 0 === expected &&
            (top !== "spike" && top !== "tools" ? true : !isScannedPath(path))
          );
        },
      ),
    );
  });
});
