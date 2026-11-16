import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const pkgDir = join(here, "..");
const root = join(pkgDir, "..", "..");

const ALLOWED = new Set(["apps/node", "apps/sprite", "apps/relay-node"]);
const DEP_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

function listDirs(base: string): string[] {
  let names: string[];
  try {
    names = readdirSync(base);
  } catch {
    return [];
  }
  return names.filter((n) => statSync(join(base, n)).isDirectory());
}

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
}

function projects(): string[] {
  const result: string[] = [];
  for (const group of ["apps", "packages"]) {
    for (const d of listDirs(join(root, group))) result.push(`${group}/${d}`);
  }
  return result;
}

describe("platform package structure", () => {
  it("README names the six call groups", () => {
    const readme = readFileSync(join(pkgDir, "README.md"), "utf8").toLowerCase();
    const groups = [
      "local ipc",
      "secret-file creation",
      "login environment",
      "service unit",
      "process control",
      "opening a url",
    ];
    for (const g of groups) expect(readme, g).toContain(g);
  });

  it("package.json has no dependencies and no workspace: value", () => {
    const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
    expect(pkg.dependencies).toBeUndefined();
    for (const field of DEP_FIELDS) {
      for (const value of Object.values(pkg[field] ?? {})) {
        expect(String(value).startsWith("workspace:")).toBe(false);
      }
    }
  });

  it("only node, sprite and relay-node depend on or import @wraith/platform", () => {
    const offenders: string[] = [];
    for (const proj of projects()) {
      if (ALLOWED.has(proj) || proj === "packages/platform") continue;
      const dir = join(root, proj);
      let pkgText: string | undefined;
      try {
        pkgText = readFileSync(join(dir, "package.json"), "utf8");
      } catch {
        pkgText = undefined;
      }
      if (pkgText !== undefined) {
        const pkg = JSON.parse(pkgText);
        for (const field of DEP_FIELDS) {
          if (pkg[field] && "@wraith/platform" in pkg[field])
            offenders.push(`${proj}/package.json`);
        }
      }
      const files: string[] = [];
      try {
        walk(join(dir, "src"), files);
      } catch {
        // no src folder
      }
      for (const f of files) {
        if (readFileSync(f, "utf8").includes("@wraith/platform")) {
          offenders.push(relative(root, f).split(sep).join("/"));
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("root tsconfig.json references ./packages/platform", () => {
    const ts = JSON.parse(readFileSync(join(root, "tsconfig.json"), "utf8"));
    const paths = (ts.references ?? []).map((r: { path: string }) => r.path);
    expect(paths).toContain("./packages/platform");
  });
});
