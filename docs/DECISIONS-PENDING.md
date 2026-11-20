# Decisions pending (human)

The loop proceeds with the default unless the human answers. Source: `docs/architecture.md` §24.2.

| id | date | question | default taken | impact if changed | resolved? |
|---|---|---|---|---|---|
| H1 | 2026-11-01 | GitHub repo name/owner/visibility | `github.com/<user>/wraith`, **public from the first push**. Before that push: GitHub secret scanning + push protection on, and the `secret-scan` hook installed (P0). | URLs in docs/CI; free macOS CI minutes | yes (2026-11-02, human) |
| H2 | 2026-11-01 | License | Apache-2.0 | LICENSE file | yes (2026-11-02, default) |
| H3 | 2026-11-01 | Node names / hostPriority | No hard-coded names. `nodeId`/`label` default to the slugified hostname (`-2` suffix on collision), renamable via `wraith-node init --name` or /machines. `hostPriority` defaults to 1; ties go to the lowest `nodeId`. | roster defaults | yes (2026-11-02, human) |
| H4 | 2026-11-01 | Cloudflare domain / plan | `workers.dev`; the human already has **Workers Paid**. P4-D10 still measures against Free-plan limits for other users. | relay URL | yes (2026-11-02, human) |
| H5 | 2026-11-01 | Apple Developer ID | Not purchased. Revisit at P9.2. | signed desktop, Capacitor, Apple Watch | yes (2026-11-02, human) |
| H6 | 2026-11-01 | Cloud-bot test repo + PAT | `<user>/wraith-playground` (private), fine-grained read-only PAT made by the human | P3 entry | yes (2026-11-02, default; PAT still to be created by human before P3) |
| H7 | 2026-11-01 | After P6: P7 (watch) or P8 (crypt) first | P7 if the watch is ready and Q25–Q27 are answered, else P8 | ordering only | yes (2026-11-02, default) |
| H8 | 2026-11-01 | Bonus posts (blog, social, Ghost of Kiroween Past) | Loop drafts, human posts. **Not eligible** for Ghost of Kiroween Past (did not register in 2025). | P6 | yes (2026-11-02, human) |
| H9 | 2026-11-01 | Kiro Crew bridge | not before P9.11 | none | yes (2026-11-02, default) |
| H10 | 2026-11-01 | Watch quick messages / approval timeout | list in §14.4 / 30 min | P7 / P1 | yes (2026-11-02, default) |
| H11 | 2026-11-02 | Claude Agent SDK: accept its license (Anthropic terms), auth (own Claude login vs API key), bundle in Wraith.app or not | not bundled; `doctor` installs it when the first Claude bot is created; own login if Q36 confirms the terms allow it, else API key | P9.14 (Claude bots, Rewind) | yes (2026-11-02, default) |
| S-protocol-1 | 2026-11-10 | Source of the shapes §6.2 references but does not define (`Diff`, `Location`, `Room`, `Bot`, `ApprovalView`, `LeaseView`, `BotSummary`, `tier`, `BotId`, `JWK`) | `Diff`/`Location` from the ACP tool-call types; `Room`, `Bot`, `ApprovalView`, `LeaseView`, `BotSummary` from §10; `tier` = `agents.json` values `t0`/`t1`/`t2`; `BotId` = Ulid; `JWK` = EC P-256 public JWK | S-protocol Requirement 17 and the schemas that use these shapes | no |
| S-protocol-15 | 2026-11-10 | Handoff Packet field optionality (§6.6 shows only an example) | `replyTo` nullable; `root`, `refs`, `context` optional; `attachments` defaults to `[]` | S-protocol Requirement 11, handoff fixtures | no |
| S-protocol-16 | 2026-11-10 | Sprite `ping` body and the types of `resources` and `env` (§6.5) | `ping` body is `{}`; `resources` is an array of JSON objects; `env` is `Record<string,string>` | S-protocol Requirement 19, sprite fixtures | no |
| S-crypto-1 | 2026-11-15 | Vitest resolution of `@wraith/source` (task 2.2) | `ssr.resolve.conditions: ["@wraith/source"]` is needed besides `resolve.conditions` in Vitest; the workers project (8.2) uses the same | vitest config of packages/crypto, task 8.2 | yes (2026-11-15, owner) |
| S-crypto-2 | 2026-11-15 | Module edges to `errors.ts` | `bytes.ts` and `webcrypto.ts` may import `errors.ts`; the 7.3 source-rules scan allows exactly these edges to `errors.ts` | task 7.3 source-rules scan | yes (2026-11-15, owner) |
| S-crypto-3 | 2026-11-15 | Property 6 run layout | The core round trip runs one 1000-run property per MESSAGE_TYPES entry | sign-verify.test.ts runtime | yes (2026-11-15, owner) |
| S-crypto-4 | 2026-11-15 | Source for the Workers test config (task 8.2) | The official Cloudflare docs page https://developers.cloudflare.com/workers/testing/vitest-integration/configuration/ (read 2026-11-15, plugin version 1.8.2) is the config source; the plugin's bundled README only links to docs | workers project config in packages/crypto/vitest.config.ts | yes (2026-11-15, owner) |
| S-crypto-5 | 2026-11-15 | Test timeout for the node and workers projects | `testTimeout` 60_000 per project, replacing per-test 120_000 timeouts. Measured (node/workers): keygen 0.4/0.2 ms, slowest 1000-run property ~2.1/1.3 s, deep-nesting JCS test ~11.1/7.4 s. The owner told the agent to move to one `testTimeout`; the agent chose the value | vitest config of packages/crypto; slower CI machines may need a higher value | yes (2026-11-15, owner) |
| S-crypto-6 | 2026-11-15 | Workers compatibility date and flags | miniflare `compatibilityDate` pinned inline to "2026-11-01", no `wrangler.jsonc`, no `nodejs_compat`, for determinism | workers project config; a later date or `nodejs_compat` may change runtime behaviour | yes (2026-11-15, owner) |
| S-ops-1 | 2026-11-16 | Shared PBT run count for the platform package (task 12.4) | `packages/platform/test/config.ts` carries its own `OPS_PBT_RUNS = 500` copy, because packages cannot import it from `tools`, crypto or protocol | test config of packages/platform; the value must be kept in step with `tools/test/config.ts` | yes (2026-11-17, owner) |
| S-ops-2 | 2026-11-16 | `tools/tsconfig.json` settings for the relative `.ts` import of the protocol script | `composite` false and `allowImportingTsExtensions` true | tsconfig of tools; `tsc -b` no longer builds tools as a composite project | yes (2026-11-17, owner) |
| S-ops-3 | 2026-11-16 | Group-to-hook assignment of the unsafe-token groups of `unsafe.ts` (task 9.2) | `no-trust-all` covers `argvFlags`, `settingsValues` and `patterns`; `no-auto-approve` covers all four groups plus the autopilot marker and the allow-unverified rules | which hook blocks which sample; a change moves findings between hooks | yes (2026-11-17, owner) |
| S-ops-4 | 2026-11-16 | Grok `approval_mode` values that skip asking | `always-approve`, `auto`, `yolo`, `never`, `none`, `off` are treated as unsafe and pinned until spike Q38 confirms the real values | the Grok value list in `unsafe.ts` and the SI-2 check | yes (2026-11-17, owner) |
| S-ops-5 | 2026-11-16 | Test timeout for packages/platform | `testTimeout` 60_000 added to the vitest config after a flake under parallel load | vitest config of packages/platform; slower CI machines may need a higher value | yes (2026-11-17, owner) |
| S-ops-6 | 2026-11-16 | Name of the hook that blocks the SI-2 flags | Renamed to `no-trust-all`, because the old name (no-trust-all followed by -tools) contains an SI-1 token. Follow-up: update `docs/architecture.md` §12.1 and §17, steering `structure.md` and the PHASE-STATUS P0-D6 prose at the next architecture changelog | hook file name and the docs that cite the old name | yes (2026-11-16, owner) |
| S-ops-7 | 2026-11-16 | Pseudo-file name used by hook scanners when the payload has no path | `hook-input.ts`, shared by all hook scanners | rule output and allowed-location matching for path-less payloads | yes (2026-11-17, owner) |
| S-ops-8 | 2026-11-16 | `secret-scan` hook mode edge behaviour | Fails closed on non-object JSON; line numbers are relative to the matched string | hook exit codes for malformed input; reported line numbers | yes (2026-11-16, owner) |
| S-spikes-1 | 2026-11-20 | Exit code when a secret is found in spike evidence | 22 (`EXIT.NEEDS_HUMAN`): the owner must stop, revoke and report. The design error table said 1; task 7.6 text fixed to 22 (owner, 2026-11-20) | `run.ts` exit code, `runner.integration.test.ts`, the design error table | yes (2026-11-20, owner) |
| P-SI2-1 | 2026-11-20 | Let Claude bots launch on a machine whose `~/.claude/settings.json` holds allow rules (proposal below; no spec, steering or `unsafe.ts` edited yet) | None. SI-2 stays as written, so a Claude bot is refused with `E_AGENT_UNSAFE` on the owner's machine until this is decided | `architecture.md` §12.1 SI-2 and §6.9, `security.md`, `unsafe.ts`, S-protocol and later sprite/node specs; see "Files and tests" below | no |

## Proposal P-SI2-1: Claude bots launch without the user setting source

Status: proposal only. Facts about Claude Code 2.1.323 come from the owner's `claude --help`; they are not verified by the loop (the loop never runs `claude`). Items marked 🧪 are checked by spike task 13.8 from the installed SDK types before anything is adopted.

### 1. Launch without the user setting source

Today SI-2 reads `~/.claude/settings.json` and refuses the launch when it holds allow rules beyond read-only tools. The owner keeps many allow rules there for their own Claude Code use, so every Claude bot would be refused.

Proposal:

- A Claude bot never loads the user setting source. SDK driver: the `settingSources` option has no `user` entry. Terminal-mode TUI: the CLI is started with `--setting-sources` listing no `user` (🧪 exact flag and value syntax).
- The owner's `~/.claude/settings.json` is neither read for the SI-2 check nor changed. Login is unaffected: OAuth and keychain credentials are not settings (🧪 confirm in 13.8 that a launch with no user source still authenticates).
- SI-2 checks the effective launch instead of the files it hoped were loaded:
  1. the setting sources the launch asks for (default: none; `project` and `local` only if a later decision turns them on);
  2. the permission mode (section 2);
  3. the allowed-tools list (read-only tools only, no wildcard);
  4. the guard `--settings` file for Terminal mode (the only `--settings` file allowed; no `PreToolUse` or `PermissionRequest` hook entry, a unit test pins the template);
  5. the managed settings files, which Claude Code always loads whatever the sources are;
  6. project and local settings files from the bot's cwd up to the workspace root, only when those sources are loaded.
- Any other settings source, an env-supplied settings file, or a `--settings` value other than the guard is refused.
- The check runs before every launch and every epoch bump, and on return from Terminal mode (unchanged).

### 2. Permission modes and the new flag

Claude Code 2.1.323 lists these permission modes: accept-edits, auto, bypass, manual, don't-ask and plan (exact spellings stay in `packages/protocol/src/unsafe.ts`; this file does not spell the unsafe ones). There is no `default` any more. `auto` and the new `--permission-prompts` flag are in neither SI-2 nor `unsafe.ts`.

Proposal:

- Allow-list, not block-list: the only allowed mode is the asking mode. That is `manual` for the CLI. For older CLI versions, or for the SDK if its installed types still name the asking mode `default`, the allowed value is that name (🧪 read the real names from the SDK types in 13.8). Any other value, including a value this list has never seen, is refused (fail closed).
- Add `auto` to the unsafe set, as a mode value in the Claude positions only (the CLI mode flag and the SDK mode option). It must not become a bare word match: `unsafe.ts` already holds a Grok `auto` pattern and "auto" is common prose.
- Add the `--permission-prompts` flag to the unsafe argv flags until its meaning is read from the CLI help and a decision is taken (🧪; if it only chooses how prompts are shown, it may move to an allowed list later).
- The existing pattern `claude-permission-mode-not-default` becomes "mode not in the asking set" and keeps its samples; samples for `manual` (allowed) and `auto` (refused) are added.
- Version pinning: the SDK stays exact-pinned (RD-11). A constant `CLAUDE_CODE_CHECKED` (version range the allow-list was verified against) lives in `packages/protocol`. The sprite reads `claude --version` (argv array, no shell) before a launch and records it. Outside the range the launch still passes only if its mode is in the allow-list, and the node shows a "Claude Code version not checked" notice; a mode list change in a new version therefore cannot widen what is allowed. Task 13.8 re-reads the mode list from `claude --help` whenever the pinned version changes, owner-run.

### 3. Files and tests

| File or spec | Change |
|---|---|
| `docs/architecture.md` §12.1 SI-2 | rewrite the Claude clause: no user source, effective-launch check, managed files always checked, mode allow-list |
| `docs/architecture.md` §6.9 `E_AGENT_UNSAFE` | the message text names "setting sources, mode, allowed tools, guard, managed files" instead of "Claude settings allow-rules/`defaultMode`" |
| `docs/architecture.md` §8.1, §4.4 (SDK mapping), DECISION-47, SI-1 Terminal exception, C-table row | "manual permission mode" wording and the sources rule; new changelog row and version bump |
| `.kiro/steering/security.md` | SI-2 row and the Claude "Never" bullets, same wording |
| `.kiro/steering/agent-loop.md` | the Rewind/Claude driver bullet ("settings files are checked before launch") |
| `packages/protocol/src/unsafe.ts` | mode allow-list constant, `auto` in Claude mode positions, `--permission-prompts` flag, changed pattern id, samples |
| `packages/protocol/test` (S-protocol) | Property for the allow-list (every mode value outside it is refused, unknown values too); sample tests for `manual`, `default` (SDK/older only), `auto`; the flag in argv and in a settings string |
| `.kiro/specs/s-protocol/tasks.md` | new task under the unsafe-token work (task 8.1 stays open for P1); do not run it through the task tool for partial work |
| `.kiro/hooks/no-auto-approve.json` and the pattern in architecture SI-1 | the grep pattern changes from "mode not default" to the allow-list form; hook tests and the P0-D6 sample files get one sample per new class |
| `tools/check-si.ts`, `tools/test` | read the new constants; tests for the new samples |
| `spike/lib/claude-launch.ts` | field `permMode` and its checked value `"default"` become the asking value from the installed types; `settingSources` stays empty; tests extended with `auto`, an unknown value and the flag |
| `.kiro/specs/s-spikes/tasks.md` task 13.8 | add: read mode names and the `--setting-sources` form from the installed types and `--help` text the owner pastes; STOP rule if no asking mode exists |
| Sprite and node specs (P1, not written yet) | launch builder omits the user source; SI-2 check module takes the effective launch as input; version record; `E_AGENT_UNSAFE` message |

Tests to add beyond those above: a launch-builder test that the user source is never present (SDK and CLI forms); a test that a managed settings file with an allow rule still refuses the launch; a test that a user settings file with allow rules does not (it is not read); a Terminal-mode test that the guard remains the only `--settings` file.

### 4. Open questions for the owner

1. Should project and local sources ever be loaded (CLAUDE.md-style project settings)? Proposal: no, until a later decision; then SI-2 checks those files too.
2. Is "version not checked" a notice or a refusal? Proposal: notice, because the allow-list already fails closed.
3. Which Claude Code versions does the owner run daily? The range in `CLAUDE_CODE_CHECKED` starts at 2.1.323.
