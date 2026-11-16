import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface WalkOptions {
  readonly root: string;
  readonly dirs: readonly string[];
  readonly skipDirNames: ReadonlySet<string>;
}

/** Sorted repo-relative posix paths of regular files. Uses lstat, never follows symlinks. */
export function walkFiles(o: WalkOptions): string[] {
  const out: string[] = [];
  const visit = (rel: string): void => {
    const st = lstatSync(join(o.root, rel), { throwIfNoEntry: false });
    if (st === undefined || st.isSymbolicLink()) return;
    if (st.isFile()) {
      out.push(rel);
      return;
    }
    if (!st.isDirectory()) return;
    for (const name of readdirSync(join(o.root, rel))) {
      const child = rel === "" ? name : `${rel}/${name}`;
      const cst = lstatSync(join(o.root, child), { throwIfNoEntry: false });
      if (cst === undefined || cst.isSymbolicLink()) continue;
      if (cst.isDirectory() && o.skipDirNames.has(name)) continue;
      visit(child);
    }
  };
  for (const d of o.dirs) {
    const start = d.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
    visit(start === "." ? "" : start);
  }
  return [...new Set(out)].sort();
}
