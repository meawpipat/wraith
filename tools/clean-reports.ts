import { readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SKIP = new Set(["node_modules", ".git", "dist"]);

/** Removes every `.reports` folder below `dir`; returns the removed paths. */
function clean(dir: string, removed: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.name === ".reports") {
      rmSync(full, { recursive: true, force: true });
      removed.push(full);
    } else {
      clean(full, removed);
    }
  }
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const removed: string[] = [];
clean(root, removed);
rmSync(join(root, ".reports"), { recursive: true, force: true });
process.stdout.write(`removed ${removed.length} .reports folder(s)\n`);
