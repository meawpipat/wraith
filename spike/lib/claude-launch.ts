import {
  CLAUDE_ASKING_MODES,
  CLAUDE_PERMISSION_PROMPTS,
  findUnsafeToken,
  isClaudeAskingMode,
} from "../../tools/lib/unsafe-tokens.ts";

/**
 * Launch options for the Claude Agent SDK. UNVERIFIED (🧪): the field names are
 * WORKING NAMES. Task 13.8 reads the real names from the installed SDK types.
 */
export interface ClaudeLaunchView {
  /** Filesystem setting sources. Must be empty. */
  readonly settingSources: readonly string[];
  /** Must be an asking mode (`CLAUDE_ASKING_MODES`: `manual`, or `default` on older versions); any other value is refused. */
  readonly permMode: string;
  /** Who answers prompts. Absent (the CLI default is `host`) or exactly `host`; anything else is refused. */
  readonly permPrompts?: string;
  /** Tools that run without asking. Read-only tools only, or absent. */
  readonly allowedTools?: readonly string[];
  /** Allow rules. Must be empty. */
  readonly allowRules: readonly string[];
  /** A settings file path or object. Must be absent. */
  readonly settings?: unknown;
  readonly cwd?: string;
  /** Permission callback (owner gate). Not serialised. */
  readonly askOwner?: unknown;
}

/** Working name, unverified (🧪). */
export const READ_ONLY_CLAUDE_TOOLS: readonly string[] = ["Read", "Glob", "Grep", "LS"];

export interface BuildClaudeLaunchInput {
  readonly cwd: string;
  readonly askOwner: unknown;
}

export function buildClaudeLaunch(input: BuildClaudeLaunchInput): ClaudeLaunchView {
  return {
    settingSources: [],
    permMode: CLAUDE_ASKING_MODES[0],
    permPrompts: CLAUDE_PERMISSION_PROMPTS,
    allowedTools: [...READ_ONLY_CLAUDE_TOOLS],
    allowRules: [],
    cwd: input.cwd,
    askOwner: input.askOwner,
  };
}

/** Throws when the launch options could run a tool without the owner's tap (R7.11). */
export function assertSafeClaudeLaunch(opts: ClaudeLaunchView): void {
  if (opts.settingSources.length > 0)
    throw new Error("spike-claude-unsafe: setting sources not empty");
  if (!isClaudeAskingMode(opts.permMode)) throw new Error("spike-claude-unsafe: permission mode");
  if (opts.permPrompts !== undefined && opts.permPrompts !== CLAUDE_PERMISSION_PROMPTS) {
    throw new Error("spike-claude-unsafe: permission prompts must be host");
  }
  if (opts.allowRules.length > 0) throw new Error("spike-claude-unsafe: allow rules not empty");
  for (const tool of opts.allowedTools ?? []) {
    if (tool.includes("*") || !READ_ONLY_CLAUDE_TOOLS.includes(tool)) {
      throw new Error("spike-claude-unsafe: allowed tool is not read-only");
    }
  }
  if (opts.settings !== undefined && opts.settings !== null) {
    throw new Error("spike-claude-unsafe: settings file or object");
  }
  const serialised = JSON.stringify(opts, (k, v) => (k === "askOwner" ? undefined : v));
  if (findUnsafeToken(serialised) !== null) throw new Error("spike-claude-unsafe: unsafe token");
}
