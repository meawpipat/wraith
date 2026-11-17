import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { EXIT_ERROR, EXIT_FINDINGS, EXIT_OK } from "./lib/finding.ts";
import { mainSi } from "./lib/si-cli.ts";
import { HOOK_AUTO_APPROVE, HOOK_TRUST_ALL } from "./lib/si-rules.ts";

/** Runs both SI scanners in tree mode. File names come from the hook constants. */
export function main(cwd: string): number {
  const codes = [HOOK_TRUST_ALL, HOOK_AUTO_APPROVE].map((h) => mainSi(h, ["--tree"], cwd));
  if (codes.includes(EXIT_ERROR)) return EXIT_ERROR;
  return codes.includes(EXIT_FINDINGS) ? EXIT_FINDINGS : EXIT_OK;
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href) {
  process.exitCode = main(process.cwd());
}
