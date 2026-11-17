import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { mainSi } from "./lib/si-cli.ts";
import { HOOK_TRUST_ALL } from "./lib/si-rules.ts";

export function main(argv: readonly string[], cwd: string): number {
  return mainSi(HOOK_TRUST_ALL, argv, cwd);
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href) {
  process.exitCode = main(process.argv.slice(2), process.cwd());
}
