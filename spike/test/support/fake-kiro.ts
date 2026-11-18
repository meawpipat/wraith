export interface FakeKiroOptions {
  /** Printed for `--version` as `kiro-cli <version>`. */
  readonly version: string;
  /** Printed for `chat --list-sessions --help`. */
  readonly listSessionsHelp: string;
}

/** Minimal fake `kiro-cli`. ACP behaviour is added by task 8.2. */
export function fakeKiroSource(opts: FakeKiroOptions): string {
  return `const argv = process.argv.slice(2);
if (argv.length === 1 && argv[0] === "--version") {
  process.stdout.write("kiro-cli " + ${JSON.stringify(opts.version)} + "\\n");
} else if (argv.join(" ") === "chat --list-sessions --help") {
  process.stdout.write(${JSON.stringify(opts.listSessionsHelp)});
}
`;
}
