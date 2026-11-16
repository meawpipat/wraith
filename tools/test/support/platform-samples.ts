import type { PlatformTokenId } from "../../check-platform.ts";

export interface TokenSample {
  readonly id: PlatformTokenId;
  /** One code line that must be flagged with this token. */
  readonly line: string;
  /** 1-based column of the token in `line`. */
  readonly column: number;
}

export const TOKEN_SAMPLES: readonly TokenSample[] = [
  { id: "process-platform", line: "const p = process.platform;", column: 11 },
  { id: "os-platform", line: "const p = os.platform();", column: 11 },
  { id: "os-type", line: "const t = os.type();", column: 11 },
  { id: "launchctl", line: 'run("launchctl", ["list"]);', column: 6 },
  { id: "systemctl", line: 'run("systemctl", ["status"]);', column: 6 },
  { id: "chmod", line: 'run("chmod", ["600", f]);', column: 6 },
  { id: "sighup", line: 'process.kill(pid, "SIGHUP");', column: 20 },
  { id: "sigterm", line: 'process.kill(pid, "SIGTERM");', column: 20 },
  { id: "tmp-path", line: 'const d = "/tmp/wraith";', column: 12 },
];

export const OUTSIDE_PATH = "packages/relay-core/src/sample.ts";
export const INSIDE_PATH = "packages/platform/src/sample.ts";
