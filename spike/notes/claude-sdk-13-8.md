# Task 13.8: Claude Agent SDK facts (read from installed `sdk.d.ts`)

Installed: `@anthropic-ai/claude-agent-sdk` 0.3.330 (exact pin, devDependency of `@wraith/spike` only, RD-11).
Its `package.json` field `claudeCodeVersion` is 2.1.330. `CLAUDE_CODE_CHECKED_MIN` is 2.1.323, so the SDK's bundled
Claude Code is inside the checked range (2.1.330 >= 2.1.323). No `claude` binary was run.

## (a) Option names

| View field | SDK `Options` name | Notes |
|---|---|---|
| setting sources | `settingSources?: SettingSource[]` | `SettingSource` = `user`, `project`, `local`. `[]` disables filesystem settings ("SDK isolation mode"). Omitted = all sources load. |
| asking mode (view: `permMode`) | the SDK's `PermissionMode` option (long name starts `permission` + `Mode`) | Asking mode is named `default`. It is in `CLAUDE_ASKING_MODES` (`manual`, `default`), so `unsafe.ts` is unchanged. The SDK has no `manual` value. |
| who answers prompts (view: `permPrompts`) | SDK option `permission` + `Prompts`: `'host' \| 'none'` | Exists. `host` (default) = this process via `canUseTool` or `permissionPromptToolName`. `none` denies silently. We set `host`. |
| allowed tools | `allowedTools?: string[]` | Read-only tools only. |
| settings | `settings?: string \| Settings` | Must stay absent. |
| owner gate | `canUseTool?: CanUseTool` | `askOwner` binds here. |
| allow rules | none | Not an SDK option; rules come from settings files (none load with `settingSources: []`) and `allowedTools`. `allowRules` stays a Wraith-side check. |

Zero setting sources is possible (`settingSources: []`), so the STOP rule did not fire.

## (b) Project instructions

The SDK doc comment on `settingSources` says it "Must include `'project'` to load CLAUDE.md files". So an empty
`settingSources` DOES drop the project `CLAUDE.md`. Open item added to `docs/DECISIONS-PENDING.md`.

## (c) Still open

The TUI `--setting-sources` form for "no sources" and the CLI mode list need the owner's pasted `claude --help`. Not read here.

## (d) Version

SDK 0.3.330 bundles Claude Code 2.1.330 (from its `package.json`), compared with `CLAUDE_CODE_CHECKED_MIN` 2.1.323.
`versions.claudeAgentSdk` in the evidence index takes "0.3.330".
