// Runtime-independence check for @wraith/crypto (R2.4 to R2.6).
// Node-only script: not part of src/, never imported by it.
// Reuses the pure scanner of the protocol script; see design "Boundary_Check".
// Run: node --experimental-strip-types scripts/check-boundaries.ts
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { Violation } from "../../protocol/scripts/check-boundaries.ts";
import { checkSources } from "../../protocol/scripts/check-boundaries.ts";

const PREFIX = "@wraith/crypto";
const ALLOWED_DEPENDENCIES = ["@wraith/protocol"];

/** Protocol's messages cite its own requirement ids (R22.x); they mean nothing here. */
const stripProtocolIds = (message: string): string => message.replace(/ \(R22\.\d+\)$/, "");

function listTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTs(p));
    else if (/\.(ts|tsx|mts|cts)$/.test(entry.name)) out.push(p);
  }
  return out.sort();
}

/** Pure check of a parsed package.json: `dependencies` may list only `@wraith/protocol` (R1.4). */
export function checkPackageJson(json: unknown, file = "package.json"): Violation[] {
  const deps = (json as { dependencies?: unknown } | null)?.dependencies;
  if (deps === undefined) return [];
  if (typeof deps !== "object" || deps === null || Array.isArray(deps)) {
    return [{ file, line: 1, message: "dependencies must be an object (R1.4)" }];
  }
  return Object.keys(deps)
    .filter((name) => !ALLOWED_DEPENDENCIES.includes(name))
    .map((name) => ({
      file,
      line: 1,
      message: `dependency "${name}" is not allowed; only @wraith/protocol (R1.4)`,
    }));
}

/** Runs the source scan and the dependency rule against the real package tree. */
export function checkTree(packageRoot: string): Violation[] {
  const files = listTs(join(packageRoot, "src")).map((p) => ({
    path: relative(packageRoot, p),
    text: readFileSync(p, "utf8"),
  }));
  const pkg: unknown = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
  return [
    ...checkSources(files).map((v) => ({ ...v, message: stripProtocolIds(v.message) })),
    ...checkPackageJson(pkg),
  ];
}

const invoked = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (invoked) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const violations = checkTree(root);
  if (violations.length > 0) {
    for (const v of violations) console.error(`${PREFIX}: ${v.file}:${v.line}: ${v.message}`);
    console.error(`${PREFIX} check-boundaries: ${violations.length} violation(s)`);
    process.exit(1);
  }
  console.log(`${PREFIX} check-boundaries: ok`);
}
