export const FAKE_HC_SERVER_STATUS = "fake-hc server status: ok\n";

export interface FakeHcOptions {
  /** Version printed for `--version` as `hc <version>`. */
  readonly version: string;
  /** File the fake appends one JSON line per call to. */
  readonly logFile: string;
}

/** Source of a fake `hc`. It never opens a socket and logs env NAMES only, never values. */
export function fakeHcSource(opts: FakeHcOptions): string {
  return `const fs = require("node:fs");
const argv = process.argv.slice(2);
const names = Object.keys(process.env)
  .filter((n) => /^(HC_|HERDR_|XDG_)/.test(n))
  .sort();
fs.appendFileSync(${JSON.stringify(opts.logFile)}, JSON.stringify({ argv, envNames: names }) + "\\n");
if (argv.length === 1 && argv[0] === "--version") {
  process.stdout.write("hc " + ${JSON.stringify(opts.version)} + "\\n");
} else if (argv.length === 2 && argv[0] === "server" && argv[1] === "status") {
  process.stdout.write(${JSON.stringify(FAKE_HC_SERVER_STATUS)});
}
`;
}
