import { readSync } from "node:fs";
import { ToolError } from "./finding.ts";

/** Stdin limit for hook mode (4 MiB). */
export const MAX_HOOK_BYTES = 4 * 1024 * 1024;

const WRITE_TOOLS: ReadonlySet<string> = new Set([
  "fsWrite",
  "fs_write",
  "fsAppend",
  "fs_append",
  "strReplace",
  "str_replace",
]);
const SHELL_TOOLS: ReadonlySet<string> = new Set(["executeBash", "execute_bash"]);
const PATH_KEYS: ReadonlySet<string> = new Set(["path", "file_path", "filePath", "targetFile"]);

export function isWriteTool(name: string | undefined): boolean {
  return name !== undefined && WRITE_TOOLS.has(name);
}

export function isShellTool(name: string | undefined): boolean {
  return name !== undefined && SHELL_TOOLS.has(name);
}

/** `git … commit` as a command word sequence, for example `git -C x commit -m y`. */
export function isGitCommit(command: string): boolean {
  return /(?:^|[\s;&|(])git(?:\s+\S+)*?\s+commit(?:\s|$)/.test(command);
}

export interface HookText {
  readonly toolName?: string;
  /** First string held by a path-named key of tool_input, at any depth. */
  readonly path?: string;
  /** Every string value of tool_input, at any depth, in document order. */
  readonly strings: readonly string[];
  /** tool_input.command when it is a string. */
  readonly command?: string;
  /** Working directory from the payload when it is a string. */
  readonly cwd?: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Total over any JSON value. Iterative, so nesting depth cannot overflow the stack. */
export function extractHookText(json: unknown): HookText {
  const strings: string[] = [];
  let path: string | undefined;
  let command: string | undefined;
  let toolName: string | undefined;
  let cwd: string | undefined;
  let toolInput: unknown;
  if (isRecord(json)) {
    if (typeof json.tool_name === "string") toolName = json.tool_name;
    if (typeof json.cwd === "string") cwd = json.cwd;
    toolInput = json.tool_input;
    if (isRecord(toolInput) && typeof toolInput.command === "string") command = toolInput.command;
  }
  const stack: unknown[] = [toolInput];
  while (stack.length > 0) {
    const v = stack.pop();
    if (typeof v === "string") {
      strings.push(v);
    } else if (Array.isArray(v)) {
      for (let i = v.length - 1; i >= 0; i--) stack.push(v[i]);
    } else if (isRecord(v)) {
      const entries = Object.entries(v);
      for (const [k, val] of entries) {
        if (path === undefined && PATH_KEYS.has(k) && typeof val === "string") path = val;
      }
      for (let i = entries.length - 1; i >= 0; i--) stack.push(entries[i]?.[1]);
    }
  }
  return {
    ...(toolName === undefined ? {} : { toolName }),
    ...(path === undefined ? {} : { path }),
    strings,
    ...(command === undefined ? {} : { command }),
    ...(cwd === undefined ? {} : { cwd }),
  };
}

/** Parses hook stdin text. Empty, oversized or unparsable input is an error (fail closed). */
export function parseHookInput(raw: string): unknown {
  if (Buffer.byteLength(raw, "utf8") > MAX_HOOK_BYTES) throw new ToolError("hook input too large");
  if (raw.trim() === "") throw new ToolError("hook input empty");
  try {
    return JSON.parse(raw);
  } catch {
    throw new ToolError("hook input is not valid JSON");
  }
}

/** Reads fd 0 up to the limit. More than the limit is an error; the payload is never echoed. */
export function readHookStdin(): string {
  const chunks: Buffer[] = [];
  let total = 0;
  const buf = Buffer.allocUnsafe(64 * 1024);
  for (;;) {
    let n: number;
    try {
      n = readSync(0, buf, 0, buf.length, null);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EOF") break;
      if ((e as NodeJS.ErrnoException).code === "EAGAIN") continue;
      throw new ToolError("cannot read hook input");
    }
    if (n === 0) break;
    total += n;
    if (total > MAX_HOOK_BYTES) throw new ToolError("hook input too large");
    chunks.push(Buffer.from(buf.subarray(0, n)));
  }
  return Buffer.concat(chunks).toString("utf8");
}
