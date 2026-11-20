import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseMetaBlock, type SpikeMeta } from "../../tools/lib/spike-meta.ts";
import { locate, type SpikeId } from "./ids.ts";

export type ReadMetaResult = { ok: true; meta: SpikeMeta } | { ok: false; reason: string };

const DEFAULT_REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Reads the metadata block from the first 40 lines of a spike script.
 * A missing file or block refuses the run with a reason (R4.2).
 */
export function readSpikeMeta(q: SpikeId, repoRoot: string = DEFAULT_REPO_ROOT): ReadMetaResult {
  const file = join(repoRoot, locate(q).script);
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return { ok: false, reason: `script not found: ${locate(q).script}` };
  }
  return parseMetaBlock(text);
}
