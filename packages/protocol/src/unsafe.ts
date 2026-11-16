/**
 * Unsafe tokens (R21.1 to R21.3, SI-1 "Allowed locations", SI-2).
 *
 * This is the only source file that spells an unsafe literal. Validators and
 * hooks import the lists and the matcher; they never retype a token. The module
 * imports nothing, so Node can load it directly with type stripping.
 */

/** A literal substring that must never appear in product code or a launch config. */
export interface UnsafeLiteral {
  readonly id: string;
  readonly literal: string;
  readonly samples: readonly string[];
}

/** A regular expression (source text, no flags) with sample strings that it must match. */
export interface UnsafePattern {
  readonly id: string;
  readonly source: string;
  readonly samples: readonly string[];
}

/** Argv flags that switch an agent to always-approve (SI-2) or skip Claude permissions. */
const ARGV_FLAGS = [
  { id: "trust-all-tools-flag", literal: "--trust-all-tools", samples: ["--trust-all-tools"] },
  { id: "trust-tools-all-flag", literal: "--trust-tools=*", samples: ["--trust-tools=*"] },
  { id: "trust-all-tools", literal: "trust-all-tools", samples: ["trust-all-tools"] },
  { id: "trust-tools-all", literal: "trust-tools=*", samples: ["trust-tools=*"] },
  {
    id: "claude-skip-permissions",
    literal: "--dangerously-skip-permissions",
    samples: ["--dangerously-skip-permissions"],
  },
  {
    id: "claude-allow-skip-permissions",
    literal: "--allow-dangerously-skip-permissions",
    samples: ["--allow-dangerously-skip-permissions"],
  },
] as const satisfies readonly UnsafeLiteral[];

/** Environment variable names that turn on auto approval. */
const ENV_NAMES = [
  { id: "auto-approve-env", literal: "WRAITH_AUTO_APPROVE", samples: ["WRAITH_AUTO_APPROVE"] },
] as const satisfies readonly UnsafeLiteral[];

/** Claude `permissionMode` values that skip or pre-grant asking. */
const SETTINGS_VALUES = [
  { id: "claude-bypass-mode", literal: "bypassPermissions", samples: ["bypassPermissions"] },
  { id: "claude-accept-edits-mode", literal: "acceptEdits", samples: ["acceptEdits"] },
  { id: "claude-dont-ask-mode", literal: "dontAsk", samples: ["dontAsk"] },
] as const satisfies readonly UnsafeLiteral[];

/**
 * Settings shapes that need a pattern. The `approval_mode` value list is the
 * set of Grok values that skip asking; it is pinned here until spike Q38
 * confirms the exact Grok value names.
 */
const PATTERNS = [
  {
    id: "claude-permission-mode-not-default",
    source: "permissionMode[\"']?\\s*[:=]\\s*[\"']?(?!default(?![A-Za-z0-9_-]))[A-Za-z]",
    samples: ['permissionMode: "plan"', "permissionMode=auto", "permissionMode: 'auto'"],
  },
  {
    id: "grok-permission-mode-skips-asking",
    source: "permission_mode\\s*=\\s*[\"'](?:always-approve|auto)[\"']",
    samples: ['permission_mode = "always-approve"', "permission_mode='auto'"],
  },
  {
    id: "grok-yolo",
    source: "yolo\\s*=\\s*true",
    samples: ["yolo = true", "yolo=true"],
  },
  {
    id: "grok-approval-mode-skips-asking",
    source: "approval_mode\\s*=\\s*[\"'](?:always-approve|auto|yolo|never|none|off)[\"']",
    samples: ['approval_mode = "never"', "approval_mode='always-approve'", 'approval_mode="yolo"'],
  },
] as const satisfies readonly UnsafePattern[];

export const UNSAFE_TOKENS = {
  argvFlags: ARGV_FLAGS,
  envNames: ENV_NAMES,
  settingsValues: SETTINGS_VALUES,
  patterns: PATTERNS,
} as const;

export type UnsafeGroup = keyof typeof UNSAFE_TOKENS;

export const UNSAFE_GROUPS: readonly UnsafeGroup[] = [
  "argvFlags",
  "envNames",
  "settingsValues",
  "patterns",
];

export interface UnsafeMatch {
  readonly group: UnsafeGroup;
  readonly index: number;
}

const COMPILED_PATTERNS: readonly RegExp[] = PATTERNS.map((p) => new RegExp(p.source));

/**
 * Returns the group and start index of the earliest unsafe token in `text`, or
 * `null`. Ties go to the group listed first in `UNSAFE_GROUPS`. It never returns
 * the matched literal, so callers log an identifier and not the token.
 */
export function findUnsafeToken(text: string): UnsafeMatch | null {
  let best: UnsafeMatch | null = null;
  const consider = (group: UnsafeGroup, index: number): void => {
    if (index >= 0 && (best === null || index < best.index)) best = { group, index };
  };
  for (const group of UNSAFE_GROUPS) {
    if (group === "patterns") {
      for (const re of COMPILED_PATTERNS) consider(group, text.search(re));
    } else {
      for (const entry of UNSAFE_TOKENS[group]) consider(group, text.indexOf(entry.literal));
    }
  }
  return best;
}
