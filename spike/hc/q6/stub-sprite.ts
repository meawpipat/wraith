import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * Q6 stub sprite: a tiny program that keeps running, writes its pid to a file, and exits 75 on
 * SIGHUP or SIGTERM (like the real sprite, §7.6). It speaks no protocol and starts no agent.
 * Run as `node --experimental-strip-types stub-sprite.ts --bot <id> --session <s> --pid-file <f>`.
 */

export const EXIT_LOST = 75;

export interface StubArgs {
  bot: string;
  session: string;
  pidFile: string | null;
  /** Exit by itself after this many ms (used for the "exited 0" case). */
  exitAfterMs: number | null;
  exitCode: number;
}

export function parseStubArgs(argv: readonly string[]): StubArgs {
  const out: StubArgs = { bot: "", session: "main", pidFile: null, exitAfterMs: null, exitCode: 0 };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i + 1];
    switch (argv[i]) {
      case "--bot":
        out.bot = v ?? "";
        i++;
        break;
      case "--session":
        out.session = v ?? "main";
        i++;
        break;
      case "--pid-file":
        out.pidFile = v ?? null;
        i++;
        break;
      case "--exit-after-ms": {
        const n = Number(v);
        out.exitAfterMs = Number.isInteger(n) && n >= 0 ? n : null;
        i++;
        break;
      }
      case "--exit-code": {
        const n = Number(v);
        out.exitCode = Number.isInteger(n) && n >= 0 && n <= 255 ? n : 0;
        i++;
        break;
      }
      default:
        break;
    }
  }
  return out;
}

export function startStub(
  args: StubArgs,
  io: {
    exit(code: number): void;
    on(signal: "SIGHUP" | "SIGTERM", fn: () => void): void;
    pid: number;
    write(text: string): void;
    setTimer(fn: () => void, ms: number): void;
  },
): void {
  if (args.pidFile !== null) writeFileSync(args.pidFile, `${io.pid}\n`, { mode: 0o600 });
  io.write(`stub-sprite bot=${args.bot} session=${args.session} pid=${io.pid}\n`);
  io.on("SIGHUP", () => io.exit(EXIT_LOST));
  io.on("SIGTERM", () => io.exit(EXIT_LOST));
  if (args.exitAfterMs !== null) io.setTimer(() => io.exit(args.exitCode), args.exitAfterMs);
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  // Keeps the event loop alive until a signal or the optional timer ends the process.
  const keepAlive = setInterval(() => {}, 60_000);
  startStub(parseStubArgs(process.argv.slice(2)), {
    exit: (code) => {
      clearInterval(keepAlive);
      process.exit(code);
    },
    on: (signal, fn) => {
      process.on(signal, fn);
    },
    pid: process.pid,
    write: (text) => {
      process.stdout.write(text);
    },
    setTimer: (fn, ms) => {
      setTimeout(fn, ms);
    },
  });
}
