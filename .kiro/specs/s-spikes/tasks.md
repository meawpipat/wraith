# Implementation Plan: S-spikes (P0)

## Overview

This plan builds the P0 spike machinery of Project Wraith in TypeScript, following design.md: the private workspace package `@wraith/spike` with its safety core (environment builder, preflight, hc wrapper with the Observe_Mode allow-list, Own_Marker, cleanup planning, direct-spawn detector), the redactor and evidence writer, the `tools/` side (metadata parser, RESULTS parser, `check:spikes` with `--gate`), the budget guard and ledger, the approval client, the Claude launch assertion, the runner, the acp-echo, hook receiver and MCP echo libraries, the 19 spike scripts, the `record` command and the evidence and decision records for DoD P0-D4. Requirement ids are R-numbers and criteria of requirements.md (R1.6 is Requirement 1, criterion 6); "Design" names a section, decision (D1 to D17), owner choice (A1 to A7) or Correctness Property (1 to 22) of design.md. Neither document is edited by this plan.

All of this plan is P0 and serves P0-D4. The spikes decide branches for later phases; no task here builds those branches.

Order of the work follows the design's "Ordering": scaffold (1), pure safety core with its properties (2), redactor and evidence writer (3), tools side with the CI step (4), budget, approval, profile and Claude launch libraries (6), runner (7), acp-echo, hook receiver and MCP echo (8), the spike scripts by stage (10 to 13), the `record` command (15), the loop-run executions (16, conditional) and evidence and decisions (17). Two small changes against the design's list, both to keep every task buildable when it is reached:
- The root script `spike` is wired in task 7.7, after `spike/run.ts` exists. The root script `check:spikes` is wired in task 4.9, after `tools/check-spike-results.ts` exists, in the same task as the `ci.yml` step and the S-ops structure test update (D14, owner decision 2026-11-18).
- The ACP SDK dependency is added in task 8.1 (needed by `startSdkAcp`); its `docs/THIRD_PARTY.md` row is written in task 17.1. The Claude Agent SDK is added in task 13.8 as an exact-pinned devDependency of `@wraith/spike` only, under an owner exception to R5.8 (RD-11); its row is also written in task 17.1.

Conventions:
- Every Correctness Property of design.md (1 to 22) is a required property sub-task (no `*`). It cites its property number and requirement ids, runs through the `pbt(...)` helper of `spike/test/config.ts` (or `tools/test/config.ts` for tools files) with the local constant `OPS_PBT_RUNS = 500` (D15), and carries the tag `Feature: s-spikes, Property <n>: <title>`. `spike/test/config.ts` is its own copy of the two lines in `tools/test/config.ts`; no test imports `pbt()` from another package.
- No sub-task is marked optional (`*`): the design marks none. Every example, scan and structure test enforces a requirement or a design rule.
- Test files (`*.test.ts`) export nothing (Biome `noExportsInTest`); shared test code lives in `spike/test/support/*.ts` and `tools/test/support/*.ts`.
- No test, no `pnpm -r test` run and no authoring task ever runs `kiro-cli`, `claude` or a real `hc` command that talks to a core. Tests use `spike/test/support/fake-hc.ts` and `fake-kiro.ts` (scripts on a temporary PATH folder) and `fake-claude-sdk.ts`. The only tasks that run real tools are the conditional loop-run tasks of group 16.
- Samples of secrets and of unsafe tokens are never spelled in any file. Secret-shaped lines are assembled at test time from fragment arrays (`spike/test/support/samples.ts`, `tools/test/support/samples.ts`); SI_Token_Set strings are imported from `packages/protocol/src/unsafe.ts` through `tools/lib/unsafe-tokens.ts`. Spike scripts, READMEs, evidence and this plan spell no SI token (R7.9). Files written by a test live in `mkdtemp(os.tmpdir())` folders removed in `finally`; fake binaries get mode 0755 in such a folder and a PATH that holds only that folder and the folder of `process.execPath`.
- Shell commands in tasks are written in full as `pnpm ...` or `node --experimental-strip-types ...` (pnpm 9.15.0 is installed globally; check with `pnpm --version`). No shell variables are used in task text. No glob is used to get around a hook; files are listed by name.
- Dependencies are pinned at install time with exact versions, no `^` or `~`: `vitest` 5.0.5, `fast-check` 4.10.2 and `@types/node` 22.20.5 as the other packages use them. Installing from the npm registry is allowed. Network use beyond that: `pnpm view <package> license version` in tasks 8.1 and 13.8 (read-only). The one non-permissive package is `@anthropic-ai/claude-agent-sdk`, an owner exception to R5.8 (RD-11, 2026-11-18) for task 13.8.
- Each group lists the files it owns (for the per-group local commit by the orchestrating loop, listing files explicitly with `git add <file>`; never `git add -A`, never a push) and ends with a verification sub-task that runs `pnpm -r test`, `pnpm -r build`, `pnpm typecheck`, `pnpm -r --if-present check`, `pnpm lint` and the relevant `check:*` scripts, all clean, and lists the files for the commit. The CI test command, used by the suites check, is the one in `ci.yml`: `pnpm -r test -- --reporter=default --reporter="$PWD/tools/vitest-project-reporter.ts"`, which locally is `pnpm test:reports`.
- The PreToolUse hooks of `.kiro/hooks/` are active while this plan runs: they block a write whose content holds a secret-shaped string or an SI token. If a write is blocked, rewrite the content with fragments or imports; never disable or route around a hook.
- Shared files have one owning task per wave: root `package.json` by 4.9 and 7.7; `pnpm-workspace.yaml` by 1.1; `pnpm-lock.yaml` by the install tasks 1.1 and 8.1; `spike/package.json` by 1.1 and 8.1; `spike/run.ts` by 7.4 and 15.2; `spike/test/runner.integration.test.ts` by 7.6, 8.8 and 15.2; `spike/test/order.property.test.ts` by 7.2 and 10.6; `docs/spikes/RESULTS.md` by the `record` runs of group 16 and by 15.x tests only through temp copies; `docs/PHASE-STATUS.md` by 17.5 only; `tools/required-suites.json` by 4.8 and 17.2; `.github/workflows/ci.yml` and `tools/test/ci-workflow.test.ts` by 4.9 only; `docs/THIRD_PARTY.md` by 17.1 only; `spike/package.json` and `pnpm-lock.yaml` also by 13.8.
- Every task carries a `DoD:` line mapping it to the P0 DoD ids of docs/architecture.md §18.1. P0-D4 becomes `pass` only through task 17.5 (R17); every other task is "supports".
- Cost labels: every credit, quota or time number in this plan is an Estimate (R9.5). The loop cannot measure credits (R9.4). The authoring estimate of the requirements (145 to 258 Kiro credits, typical about 190, spread over at least two days) and the run estimates (about 45 to 140) are separate numbers and are never summed.

## Tasks

- [x] 1. `@wraith/spike` scaffold, workspace entry and fakes (P0)
  - DoD: P0-D4 (supports: layout and test harness). Requirements: R5.1 to R5.4, R5.7, R5.8 (scaffold only), R2.12, R1.10. Design: "Module layout", "Dependency rules", D1, D2, D15, A1.
  - Files owned: `spike/{package.json,tsconfig.json,vitest.config.ts,README.md}`, `spike/test/config.ts`, `spike/test/ids.test.ts`, `spike/test/fakes.test.ts`, `spike/lib/{ids,outcome}.ts`, `spike/test/support/{fake-hc,fake-kiro,bin-dir}.ts`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`.
  - [x] 1.1 Create the `@wraith/spike` package files and install
    - `pnpm-workspace.yaml`: add `spike` to `packages` (keep `apps/*`, `packages/*`, `tools`)
    - `spike/package.json`: name `@wraith/spike`, `private`, `type: module`, scripts `test` (`vitest run`) and `check` (`tsc -p tsconfig.json --noEmit`), no `build` script (A1, D1), no workspace dependency; `devDependencies`: `vitest` 5.0.5, `fast-check` 4.10.2, `@types/node` 22.20.5 (exact)
    - `spike/tsconfig.json` extends `../tsconfig.base.json` with `noEmit`, `allowImportingTsExtensions`, `types: ["node"]`, `include` covering `run.ts`, `lib/**`, `hc/**`, `kiro/**`, `agents/**` and `test/**`, plus the `../tools/lib/**` files it imports by relative path; if the relative `.ts` import of a `tools/lib` file does not type-check, record the working settings (as S-ops did for `tools`) and use them
    - `spike/vitest.config.ts`: one `node` project, `include: ["test/**/*.test.ts"]`, `testTimeout: 60_000`, `passWithNoTests` off; `spike/test/config.ts`: `OPS_PBT_RUNS = 500` and `pbt(...)` wrapping `fc.assert`, defaulting `numRuns` to the constant and refusing a lower value
    - `spike/README.md`: lists the commands (`pnpm spike <q…>`, `pnpm spike list`, `pnpm spike record <q>`, `pnpm spike budget …`), states that `spike/` is not product code and is imported by no `apps/` or `packages/` file (R5.7), keeps `.gitkeep` out of the way (delete `spike/.gitkeep` only after another tracked file exists in `spike/`)
    - Run `pnpm install` so the lockfile is updated; record the installed versions
    - _Requirements: R5.3, R5.4, R5.7, R2.12_
    - Design: "Module layout", D1, D15, A1
    - DoD: P0-D4 (supports), P0-D1 (supports: the lockfile stays valid for `--frozen-lockfile`)
  - [x] 1.2 Write `lib/ids.ts` and `lib/outcome.ts` and their example test
    - `ids.ts`: `SpikeId`, `SpikeDir`, `OWNER_LIST` (the 19 ids), `GATE_LIST` (18, without `q14`), `locate(id)` returning `{dir, script, evidenceRoot}` with `hc` for Group A, `kiro` for Groups B and I (Q30, Q31, Q32 and the Group B ids) and `agents` for Q33 and Q35, `<q>` lowercase (`q3b`, `q33`) (R5.1)
    - `outcome.ts`: `ResultValue`, `CriterionRecord`, `SpikeOutcome`, `SpikeModule`, `EXIT` with the exact numbers of the design (`OK 0`, `INTERNAL 1`, `PENDING 10`, `PREFLIGHT 20`, `BUDGET 21`, `NEEDS_HUMAN 22`, `CLEANUP_UNCONFIRMED 30`); runner-local numbers, no `E_*` code (D16)
    - `test/ids.test.ts`: 19 distinct ids, 18 in `GATE_LIST`, `q14` only in `OWNER_LIST`, `locate("q3b")` is under `spike/kiro/q3b/`, `locate("q33")` under `spike/agents/q33/`, `locate("q2")` under `spike/hc/q2/`, every `locate(...).evidenceRoot` ends in `/evidence`
    - _Requirements: R4.1, R5.1, R5.2_
    - Design: "Ids and outcome types", D16
    - DoD: P0-D4 (supports)
  - [x] 1.3 Write the fake binaries and their test
    - `test/support/bin-dir.ts`: `withBinDir(files, fn)` creates a `mkdtemp` folder, writes each fake as an executable Node script with a `#!/usr/bin/env node` first line, runs `fn(env)` with a PATH of that folder plus the folder of `process.execPath`, and removes the folder in `finally`
    - `test/support/fake-hc.ts`: a fake `hc` that appends its argv (JSON line) and the sorted NAMES of its `HC_*`, `HERDR_*` and `XDG_*` environment variables (never values) to a log file named by the test, prints `hc <version>` for `--version` (version chosen by the test), and prints a fixed `server status` text for `["server","status"]`; it never opens a socket
    - `test/support/fake-kiro.ts`: minimal version for now: `--version` and `chat --list-sessions --help` output (help text from a test-supplied string); the ACP behaviour is added by task 8.2
    - `test/fakes.test.ts`: the fake `hc` logs argv and env names and prints the chosen version; no value of an environment variable reaches the log; the fake `kiro-cli` prints its version; the temp folder is gone after `fn`
    - _Requirements: R2.12, R1.10_
    - Design: Testing Strategy (Suites table: fake-hc, fake-kiro)
    - DoD: P0-D4 (supports)
  - [x] 1.4 Run the group verification (group 1)
    - Run `pnpm -r test`, `pnpm -r build`, `pnpm typecheck`, `pnpm -r --if-present check` and `pnpm lint`; all clean; the `spike` suites appear in the test output; run `pnpm check:secrets` and `pnpm check:platform`
    - List the files this group changed for the commit
    - _Requirements: R5.3_
    - Design: "Build, resolution and ordering" of S-ops (convention)
    - DoD: P0-D4 (supports), P0-D1 (supports)

- [x] 2. Pure safety core: env, preflight, Own_Marker, hc wrapper, cleanup, direct-spawn detector (P0)
  - DoD: P0-D4 (R1 to R3 and R5.7 are the safety contract of every spike). Requirements: R1.1 to R1.10, R2.1 to R2.16, R3.1 to R3.8, R7.6. Design: "Environment builder", "Preflight", "hc wrapper", "Own_Marker and cleanup", D3 to D5, D13, Properties 1 to 10.
  - Files owned: `spike/lib/{env,preflight,own-marker,hc,cleanup,no-direct-hc}.ts`, `spike/test/{env,env.property,preflight,preflight.property,preflight-gather,own-marker,hc,hc.property,cleanup,cleanup.property,no-direct-hc.property}.test.ts`.
  - [x] 2.1 Implement `lib/env.ts` and its example test
    - `BASE_PASS` (PATH, HOME, LANG, TERM, TMPDIR), `EnvProfile` (`hc`, `agent`, `listener`, `tool`), `buildChildEnv(i)` starting from an empty object (never from a copy of `base`); profile `hc` adds `HC_SESSION`, `XDG_STATE_HOME=<root>/s` and `XDG_CONFIG_HOME=<root>/c`; `agent` adds only `extraPass` names; `listener` and `tool` add nothing; `isPaneEnvName(name)` is true for `HC_*` and `HERDR_*`; a pane name in `extraPass` is dropped; the function never logs and never prints a value (R1.6, R7.6, D3)
    - `test/env.test.ts`: examples per profile; `HC_SCOPE`, `HC_TERMINAL_ID`, `HC_TERMINAL_SOCKET` and `HC_SOCKET` in `base` never appear in any profile; `agent` has no `XDG_*`; `extraPass` with a name such as `HC_X` is dropped
    - _Requirements: R1.1, R1.2, R1.6, R2.13, R7.6_
    - Design: "Environment builder", D3, A2, A7
    - DoD: P0-D4
  - [x] 2.2 Write the property test for the environment builder
    - **Property 1: Child environments come from the allow-list only**
    - `test/env.property.test.ts` through `pbt(...)`, tag `Feature: s-spikes, Property 1: Child environments come from the allow-list only`; generators: environments with any mix of `HC_*`, `HERDR_*`, `XDG_*`, secret-looking and arbitrary names, every profile, any `extraPass`; assert key subset, no pane names except `HC_SESSION` (profile `hc`), no `XDG_*` or `HC_*` in `agent`, `listener`, `tool`, and `hc`-profile values equal to the runner's values
    - **Validates: Requirements 1.1, 1.2, 1.6, 2.13, 7.6**
    - Design: Property 1
    - DoD: P0-D4
  - [x] 2.3 Implement `lib/own-marker.ts` and its test
    - `OwnMarker` (v, session, qs, root, runnerPid, startedAt, nonce, pids, agentFiles), `readMarker(root)` validating shape, session pattern, `root` equal to the directory's own realpath, known ids and a 32-hex nonce (otherwise `null`), `writeMarker(m)` with mode 0600 through a temp file and rename, `pidAlive(pid)` with `process.kill(pid, 0)`
    - `test/own-marker.test.ts`: write then read round trip; a marker with a bad session, a root that differs from its folder, an unknown id or a short nonce reads as `null`; file mode is 0600; `pidAlive(process.pid)` is true and a pid of a finished child is false
    - _Requirements: R2.8, R2.9, R3.2_
    - Design: "Own_Marker and cleanup", "Own_Marker (data model)"
    - DoD: P0-D4
  - [x] 2.4 Implement the pure preflight core in `lib/preflight.ts`
    - `SESSION_RE` (`^wsp(-[a-z0-9]{1,8})?$`), `SOCKET_LIMIT = 90`, `LONGEST_SOCKET_NAME = 40`, `isUnder(root, p)` (segment-wise, normalised, strict prefix), `parseHcVersion(text)`, `PfId`, `PreflightInput`, `PreflightDeps`, `PreflightReport`, `runPreflight(i, deps)` running every check independently so the report lists all failures (PF-SESSION, PF-XDG, PF-SOCKLEN, PF-DEFAULT-PATH, PF-HOME, PF-VERSION, PF-ROOT, PF-WRAPPER, PF-CHILD-ENV, PF-PANE-ENV), `formatPreflight(r, i)` printing criterion ids and only `HC_SESSION`, the XDG paths and `HC_SOCKET` (R2.11)
    - The Q1 minimum is `[0,1,17]`, every other spike `[0,1,18]` (R2.7); socket paths are `<realRoot>/s/herdr-core/<session>/<40-byte name>` (D13); path comparison with `defaultStateDir` is by string, never by connecting (R2.5)
    - `gatherPreflightInput` is NOT part of this task (task 2.19); the Own_Marker is written by the runner, never by `runPreflight` (R2.9)
    - _Requirements: R2.1 to R2.8, R2.10, R2.11, R2.13 to R2.16_
    - Design: "Preflight", D13, A6
    - DoD: P0-D4
  - [x] 2.5 Write the example tests for the preflight core
    - `test/preflight.test.ts`: one failing case per criterion 2 to 8 and 13 to 14 with the expected `PF-*` id, the case "pane env present" of criterion 15 (passes only when the child environment built from the allow-list lacks all three names; fails with a wrapper variant that copies them), the sibling `/tmp/hcw-evil`, a 91-byte socket path, a `live` root, and a passing baseline; the tests start no real core and run no `hc`
    - _Requirements: R2.2 to R2.8, R2.12 to R2.15_
    - Design: Testing Strategy (`preflight.property.test.ts` row, examples)
    - DoD: P0-D4
  - [x] 2.6 Write the property test for preflight acceptance
    - **Property 2: Preflight accepts exactly the valid inputs**
    - `test/preflight.property.test.ts`, tag `Feature: s-spikes, Property 2: Preflight accepts exactly the valid inputs`; generator: a valid baseline with exactly one field changed; assert the report fails iff the change violates the criterion of that field, with the matching `PF-*` id, and the baseline passes
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.10, 2.12, 2.16**
    - Design: Property 2
    - DoD: P0-D4
  - [x] 2.7 Write the property test for path containment
    - **Property 3: Path containment is segment-wise**
    - Append to `test/preflight.property.test.ts`; generators: root and candidate built from segments including `..`, `.`, empty segments, repeated separators and sibling prefixes; assert `isUnder` equals "strict segment prefix after normalisation"
    - **Validates: Requirements 2.3, 2.5, 3.2**
    - Design: Property 3
    - DoD: P0-D4
  - [x] 2.8 Write the property test for hc version comparison
    - **Property 4: hc version comparison equals tuple order**
    - Append to `test/preflight.property.test.ts`; generators: pairs of version triples printed as `hc a.b.c`, and arbitrary non-version text; assert the parsed triple, "at least" equals numeric tuple order, and non-version text returns `null` and fails PF-VERSION
    - **Validates: Requirements 2.7**
    - Design: Property 4
    - DoD: P0-D4
  - [x] 2.9 Write the property test for preflight output
    - **Property 5: Preflight output reveals no other environment value**
    - Append to `test/preflight.property.test.ts`; generators: environments with sentinel values under arbitrary names; assert `formatPreflight` contains no sentinel except the values of `HC_SESSION`, the XDG paths and `HC_SOCKET`
    - **Validates: Requirements 2.11**
    - Design: Property 5
    - DoD: P0-D4
  - [x] 2.10 Write the property test for pane environment handling
    - **Property 6: Pane environment never reaches a child, and a leaking builder is caught**
    - Append to `test/env.property.test.ts`; generators: environments that set `HC_SCOPE`, `HC_TERMINAL_ID` and `HC_TERMINAL_SOCKET` with any values; assert preflight with the real `buildChildEnv` passes PF-CHILD-ENV and PF-PANE-ENV, and preflight with a builder variant that copies any of the three names fails with PF-PANE-ENV
    - **Validates: Requirements 1.6, 2.13, 2.14, 2.15**
    - Design: Property 6
    - DoD: P0-D4
  - [x] 2.11 Implement `lib/no-direct-hc.ts`
    - `findDirectHcSpawn(file, text)` over `maskComments` output (import `tools/lib/mask.ts` by relative path): reports a line when a `spawn`, `spawnSync`, `exec`, `execSync`, `execFile`, `execFileSync`, `fork` call, a shell string, or a `pkill` or `killall` call names `hc`, `herdr-core` or `hold` as the program; `lib/hc.ts` is exempt by path; `scanSpikeTree(root)` walks `spike/` with `tools/lib/walk.ts` and returns the violations (the input of PF-WRAPPER)
    - _Requirements: R1.4, R2.10, R3.4_
    - Design: "Dependency rules", "Preflight" (PF-WRAPPER)
    - DoD: P0-D4
  - [x] 2.12 Write the property test and the real-tree test for the detector
    - **Property 10: The direct-spawn detector**
    - `test/no-direct-hc.property.test.ts`, tag `Feature: s-spikes, Property 10: The direct-spawn detector`; generated TypeScript sources with calls in code, in string literals and in comments; assert a line is reported iff a spawn-family call or `pkill`/`killall` names `hc`, `herdr-core` or `hold` as the program, comments and non-argument strings are not reported, and `lib/hc.ts` is exempt by path; plus an example test that no file of the real `spike/` tree outside `lib/hc.ts` is flagged
    - **Validates: Requirements 1.4, 2.10, 3.4**
    - Design: Property 10
    - DoD: P0-D4
  - [x] 2.13 Implement `lib/hc.ts` (decision, wrapper, observe wrapper, version reader)
    - `HcMode`, `HcDecision`, pure total `decideHc(args, ctx)` with the rules of the design: session must match `SESSION_RE` and not be `default` in `normal` mode; `machine`, `exec`, `file`, `update` refused in every mode (D5); `server stop|restart|start` allowed in `normal` only; `observe` accepts exactly `["server","status"]` (D4: no `ls`, no `terminal.list` form); a single argument that is itself a command line is refused; the function never throws
    - `createHc` (calls `decideHc` before each spawn, `spawn(file, argv)` without a shell, child env from `buildChildEnv({profile:"hc"})`, records every started pid in the Own_Marker, refuses before the runner marked "preflight passed", `spawnLong` for event followers), `createObserveHc` (child env from `buildChildEnv({profile:"tool"})`: no `HC_*`, `HERDR_*`, no `HC_SESSION`)
    - `readHcVersion(baseEnv)`: the one other `hc` call in `spike/`, `hc --version` with the `tool` env profile and no session, so it never contacts a core; used only by `gatherPreflightInput` (task 2.19); it is not part of `decideHc`, which keeps Property 7 exact
    - _Requirements: R1.3, R1.4, R1.5, R1.8, R1.10, R2.7, R2.16, R3.4_
    - Design: "hc wrapper", D4, D5
    - DoD: P0-D4
  - [x] 2.14 Write the property test and the fake-hc examples for the wrapper
    - **Property 7: The hc decision never allows what the mode forbids**
    - `test/hc.property.test.ts`, tag `Feature: s-spikes, Property 7: The hc decision never allows what the mode forbids`; generators: argument arrays from hc verbs, flags, case variants, extra whitespace, shell metacharacters, single-string command lines and random strings, with any session value; assert (a) to (e) of the property
    - `test/hc.test.ts` with `fake-hc`: observe mode runs `server status` only, refuses `ls`, `ls --all` and the seven commands of R1.10 (`server stop`, `server restart`, `server start`, `terminal.create`, `terminal.run`, `terminal.send`, a configuration write) before anything runs (the fake's log stays empty), its child env (recorded by the fake as names) holds no `HC_*`/`HERDR_*` name; normal mode refuses session `default`; `readHcVersion` reads the fake's version
    - **Validates: Requirements 1.4, 1.5, 1.8, 1.10, 2.16**
    - Design: Property 7
    - DoD: P0-D4
  - [x] 2.15 Implement `lib/cleanup.ts`
    - `DeletePlan`, `planDeletion(root, marker, candidates)` (allowed only with a matching marker, path strictly under the root, root strictly under `/tmp/hcw` or `/private/tmp/hcw`, `..`, empty and relative paths refused, root's parent refused, no path derived toward the Default_Core directories), `pidIsOwn(pid, own, status, cmdline, root)`, `cleanupRun(c)` in the design order (stop children with SIGTERM then SIGKILL for own pids; `server stop` under the Test_Session; confirm stopped by a failed connect to the main socket and dead marker pids; kill remaining own pids by `pidIsOwn`; delete the agent files in the marker; delete the root with `fs.rm` after `lstat` shows no symlink at the root); if the stop cannot be confirmed the root stays, its path is printed and the result is `stopped:false` (exit 30)
    - No `pkill`, `killall` or name-based kill anywhere; SIGINT and SIGTERM handlers are installed by the runner (task 7.4), not here
    - _Requirements: R1.7, R3.1 to R3.8_
    - Design: "Own_Marker and cleanup"
    - DoD: P0-D4
  - [x] 2.16 Write the example tests for cleanup
    - `test/cleanup.test.ts` under `os.tmpdir()` with a fake root path override for the `/tmp/hcw` prefix check (the prefix is a parameter of the pure function so tests stay out of the real `/tmp/hcw`): a root with a valid marker is deleted; a root without a marker is not; a symlinked root is refused; agent files in the marker are removed and no other file in their folder; `cleanupRun` with a core stub that cannot be confirmed stopped leaves the root and returns `stopped:false`
    - _Requirements: R3.1, R3.2, R3.5, R3.7_
    - Design: Testing Strategy (`cleanup.property.test.ts` row, examples)
    - DoD: P0-D4
  - [x] 2.17 Write the property test for deletion plans
    - **Property 8: Deletion plans stay inside the marked root**
    - `test/cleanup.property.test.ts`, tag `Feature: s-spikes, Property 8: Deletion plans stay inside the marked root`; generators: marker, root and candidates including `..`, symlink-like names, the root's parent, the Default_Core directories, `~/.config/herdr-core` and sibling prefixes; assert every deleted path is strictly under the marker's root, every other candidate is refused, and with no marker or a mismatched marker nothing is deleted
    - **Validates: Requirements 3.1, 3.2, 3.7, 3.8**
    - Design: Property 8
    - DoD: P0-D4
  - [x] 2.18 Write the property test for own-pid checks
    - **Property 9: Only own pids are killed**
    - Append to `test/cleanup.property.test.ts`; generators: pid, own list, status list, command line, root; assert `pidIsOwn` is true iff the pid is in the own list, or in the status list with a command line containing the root path
    - **Validates: Requirements 1.7, 3.3, 3.4**
    - Design: Property 9
    - DoD: P0-D4
  - [x] 2.19 Implement `gatherPreflightInput` and its fake-hc tests
    - In `lib/preflight.ts`: `gatherPreflightInput(q, env)` computes the session `wsp-<first id>` (A6), the Spike_Root, realpaths, socket paths, `defaultStateDir`, the root state (absent, stale with a valid marker, live, foreign), the version through `readHcVersion`, and `scriptTreeViolations` through `scanSpikeTree`; it opens no socket and runs no other `hc` command
    - `test/preflight-gather.test.ts` with `fake-hc`: a fake reporting 0.1.20 passes and 0.1.17 fails for a non-Q1 spike and passes for Q1 (R2.7); a stale root with a dead pid is reported `stale`; a root with a live pid is `live`; a root without a marker is `foreign`
    - _Requirements: R2.1, R2.7, R2.8, R2.12_
    - Design: "Preflight" (`gatherPreflightInput`), A6
    - DoD: P0-D4
  - [x] 2.20 Run the group verification (group 2)
    - Run `pnpm -r test`, `pnpm -r build`, `pnpm typecheck`, `pnpm -r --if-present check`, `pnpm lint`, `pnpm check:platform` and `pnpm check:secrets`; all clean
    - List the files this group changed for the commit
    - _Requirements: R1.4, R2.12_
    - Design: Testing Strategy
    - DoD: P0-D4 (supports)

- [x] 3. Redactor, evidence writer and named copies (P0)
  - DoD: P0-D4 (R7 evidence hygiene; SI-8 and SI-12 support). Requirements: R7.1 to R7.5, R7.9, R5.5, R5.6, R10.2. Design: "Redactor", "Evidence writer", D8, D9, Properties 11 and 12.
  - Files owned: `spike/lib/{redact,evidence}.ts`, `spike/test/support/samples.ts`, `spike/test/{redact,redact.property,evidence}.test.ts`.
  - [x] 3.1 Implement `lib/redact.ts` and the sample builders
    - `redactText(input, o)`: pass 1 `scanText(file, text)` (import `tools/lib/secret-rules.ts` by relative path): each reported line becomes `[REDACTED-LINE:<class>]`; for `pem-private-key` the following lines up to and including the closing line (at most 200) get the same marker; pass 2 `findUnsafeToken` on each remaining line replaces a hit with `[REDACTED-LINE:si-token]` (D9); pass 3 `home` and `realHome` prefixes become `~`; pass 4 values (length 8 or more) of environment variables whose names match `TOKEN|KEY|SECRET|PASSWORD` become `<ENV:NAME>` (D6a); split and join on `\n` only so the line count and a final newline are kept; `RedactResult` carries `lineCount`, `replaced` per class, `homeMasked`, `envMasked`
    - `test/support/samples.ts`: one builder per class of `SECRET_RULES` (nine classes) assembled from fragment arrays joined at call time, plus decoys; after writing, `pnpm check:secrets` must pass on the file itself
    - `test/redact.test.ts`: examples per class, a multi-line PEM block, a JSONL file with one secret line, a line with an SI token built from the imported tokens, home path and short env value cases
    - _Requirements: R7.1 to R7.4, R7.9_
    - Design: "Redactor", D6a, D9, OQ-13 (whole-line replacement)
    - DoD: P0-D4
  - [x] 3.2 Write the property test for line count and class coverage
    - **Property 11: The redactor preserves line count and covers every secret class**
    - `test/redact.property.test.ts`, tag `Feature: s-spikes, Property 11: The redactor preserves line count and covers every secret class`; generators: ordinary lines mixed with secret-shaped lines of every class built from fragments; assert equal line count, every `scanText` line replaced, `scanText` on the result empty, `replaced` counts equal, untouched lines unchanged apart from home and environment masking
    - **Validates: Requirements 7.1, 7.2, 7.3**
    - Design: Property 11
    - DoD: P0-D4
  - [x] 3.3 Write the property test for idempotence and masking
    - **Property 12: Redaction is idempotent and masks home paths and environment values**
    - Append to `test/redact.property.test.ts`; generators: texts with home paths, environment values (length 8 or more) of secret-named variables and SI tokens from the imported set; assert idempotence, no home path or env value left, no `findUnsafeToken` hit
    - **Validates: Requirements 7.3, 7.4, 7.9**
    - Design: Property 12
    - DoD: P0-D4
  - [x] 3.4 Implement `lib/evidence.ts`
    - `EvidenceIndex` (v, q, stamp, times, runner, interactive, versions incl. `claudeAgentSdk`, result, reason, promptsSent, criteria, files with bytes and sha256 of the redacted content and per-class counts, openHumanSteps, branch, affects), `newStamp(now, exists, dir)` (`YYYYMMDDTHHMMSSZ`, `-2` suffix on a clash, never an existing folder, R5.5), `EvidenceWriter` with `addText`, `addJsonl`, `finish`; each file passes `redactText`, is written, then `node --experimental-strip-types tools/secret-scan.ts <path>` runs as a child process with the `tool` env profile; a finding deletes the file, fails the spike and reports the class only (stop condition 8); a second `findUnsafeToken` check on the written text fails the same way; raw logs stay under the Spike_Root; `finish` takes a local structural input `{ id, runBy }` instead of the tools `SpikeMeta` type, which task 4.1 creates later
    - `publishNamedCopy(q, from)` writes a redacted COPY (never a link) to `spike/hc/schema.json` for `q2` or `spike/kiro/q3.jsonl` for `q3`, only when the run ends `PASS` or `PARTIAL` (D8, A4)
    - Files owned also: none outside `spike/lib/evidence.ts`
    - _Requirements: R5.5, R5.6, R7.1, R7.5, R10.2_
    - Design: "Evidence writer", D8, A4
    - DoD: P0-D4
  - [x] 3.5 Write the example tests for the evidence writer
    - `test/evidence.test.ts` (temp repo-like folder): a file is redacted before it is written; a planted secret (assembled from fragments) in the input is replaced and the secret scan stays clean; a secret that the redactor is made to miss (writer given a stub redactor in the test) is caught by the scan, the file is deleted and the spike fails with the class only; an SI token in the input is replaced; `newStamp` adds a suffix on a clash and never returns an existing folder; `publishNamedCopy` writes only for `PASS` and `PARTIAL` and writes a regular file
    - _Requirements: R5.5, R7.1, R7.5, R7.9_
    - Design: Testing Strategy (`runner.integration.test.ts` row: evidence goes through redaction and the scan), D8
    - DoD: P0-D4
  - [x] 3.6 Run the group verification (group 3)
    - Run `pnpm -r test`, `pnpm -r build`, `pnpm typecheck`, `pnpm -r --if-present check`, `pnpm lint`, `pnpm check:secrets` and `pnpm check:platform`; all clean
    - List the files this group changed for the commit
    - _Requirements: R7.1, R7.5_
    - Design: Testing Strategy
    - DoD: P0-D4 (supports)

- [x] 4. `tools` side: metadata parser, RESULTS parser, `check:spikes`, required suites, CI step (P0)
  - DoD: P0-D4 (R4.2, R6, R17 tooling), P0-D1 (supports: the CI step and required suites). Requirements: R4.2, R4.3, R6.1 to R6.9, R7.7, R7.9, R10.1, R17.1 to R17.4. Design: "Metadata block", "RESULTS tooling", D2, D7, D14, Properties 13, 14, 20.
  - Files owned: `tools/lib/{spike-meta,spike-results}.ts`, `tools/check-spike-results.ts`, `tools/test/{spike-meta,spike-meta.property,spike-results,spike-results.property,check-spike-results}.test.ts`, `tools/test/support/results-sample.ts`, `tools/required-suites.json`, root `package.json`, `.github/workflows/ci.yml`, `tools/test/ci-workflow.test.ts`.
  - [x] 4.1 Implement `tools/lib/spike-meta.ts` and its example test
    - `SpikeMeta` (id, group, cost, runBy, agents, maxPrompts, maxWallSeconds, estimateCredits, claudePrompts, human, depends, shares, allowAlways, assumption), `parseMetaBlock(fileText)` reading only the first 40 lines between `// spike-meta` and `// end-spike-meta`, one `// key: value` per line, lists comma-separated; an unknown key, duplicate key, missing required key, bad number or missing block returns `{ok:false, reason}`; `formatMetaBlock(meta)`
    - `tools/test/spike-meta.test.ts`: the example block of the design parses; each failure kind returns its reason; a block starting after line 40 is not found; `estimate-credits: none` and `2-6` both parse
    - _Requirements: R4.2, R4.3, R10.1_
    - Design: "Metadata block (data model)", "Metadata block (components)"
    - DoD: P0-D4
  - [x] 4.2 Write the property test for the metadata block
    - **Property 13: Metadata block round trip and strictness**
    - `tools/test/spike-meta.property.test.ts` through `tools/test/config.ts` `pbt(...)`, tag `Feature: s-spikes, Property 13: Metadata block round trip and strictness`; generators: any valid `SpikeMeta`, and blocks with a missing required key, an unknown key, a duplicate key, a non-numeric number or a start after line 40; assert `parse(format(m))` equals `m` and every broken block returns `ok:false`
    - **Validates: Requirements 4.2, 4.3, 10.1**
    - Design: Property 13
    - DoD: P0-D4
  - [x] 4.3 Implement `tools/lib/spike-results.ts` and its example test
    - `ResultsEntry`, `renderEntry`, `parseResults(md)` returning entries, table rows (the three layouts found by the nearest header row and the `| Qn` prefix) and parse errors, `upsertEntry(md, e, today)` touching only `## Entries` and the id's own table row (cells whose header starts with `result`, `status`, `evidence`, `branch` or `date`, case-insensitive; a pre-check text after `pending ·` moves to the entry notes as "pre-check note, context only", R6.8), `checkResults(md, o)` with the checks of the design (field set; `pending` needs a reason; non-pending needs at least one evidence path that exists, posix, no `..`, under `spike/` or `docs/spikes/`; `PARTIAL` lists missing parts and an open-human-steps line; branch and affects present; a table result equals its entry; no `pending` row carries a non-pending value), `evaluateGate(entries, exists)`
    - `tools/test/support/results-sample.ts`: a RESULTS fixture string with the three table layouts and no entries; `tools/test/spike-results.test.ts`: the fixture checks clean, an entry renders and parses back, `upsertEntry` adds the `## Entries` section on first use
    - _Requirements: R6.1, R6.2, R6.5, R6.6, R6.8, R6.9, R17.1 to R17.4_
    - Design: "RESULTS tooling", "RESULTS.md entry (data model)", D7
    - DoD: P0-D4
  - [x] 4.4 Write the property test for RESULTS entries and the checker
    - **Property 14: RESULTS entries round trip and the checker rejects bad entries**
    - `tools/test/spike-results.property.test.ts`, tag `Feature: s-spikes, Property 14: RESULTS entries round trip and the checker rejects bad entries`; generators: valid entries; documents with each defect of the property; assert `parseResults(renderEntry(e))` equals `e`, `upsertEntry` is idempotent, changes nothing outside `## Entries` and the id's row, other table rows stay byte-identical, and `checkResults` reports each defect and nothing for a valid document
    - **Validates: Requirements 6.1, 6.2, 6.5, 6.6, 6.9, 6.10**
    - Design: Property 14
    - DoD: P0-D4
  - [x] 4.5 Write the property test for the P0-D4 gate
    - **Property 20: The P0-D4 gate opens exactly on answers with evidence**
    - Append to `tools/test/spike-results.property.test.ts`; generators: sets of entries over `GATE_LIST` and `q14` with any Result_Value and evidence paths that exist or not; assert `evaluateGate` is open iff every `GATE_LIST` id has `PASS|FAIL|PARTIAL` with existing evidence, `q14` does not affect openness, any `pending` id keeps it closed, and the counts equal the entries per value
    - **Validates: Requirements 17.1, 17.2, 17.3, 17.4**
    - Design: Property 20
    - DoD: P0-D4
  - [x] 4.6 Implement `tools/check-spike-results.ts`
    - CLI `node --experimental-strip-types tools/check-spike-results.ts [--root <dir>] [--gate]`; default mode: parse `docs/spikes/RESULTS.md`, run `checkResults`, run `findUnsafeToken` over RESULTS.md and every `*.ts` and `README.md` under `spike/` (the token-spelling rule has no exempt folder, R7.9; use `tools/lib/walk.ts`, report file and line only, never the token), validate every `spike/<dir>/<q>/<q>.ts` metadata block through `parseMetaBlock`, and check that `spike/` and `docs/spikes/` are not listed in `.gitignore` (R7.7); exit 0 on a tree with zero entries; exit 1 on findings, 2 on an unreadable file (codes from `tools/lib/finding.ts`)
    - `--gate`: additionally `evaluateGate`; exit 1 unless open; prints the counts by Result_Value, the hc, kiro-cli and Claude Code versions read from the entries' experiment lines, and the date, for the P0-D4 evidence cell (R17.4); it never edits `PHASE-STATUS.md`
    - _Requirements: R4.2, R6.9, R7.7, R7.9, R17.1 to R17.4_
    - Design: "RESULTS tooling" (`check-spike-results.ts`), D2
    - DoD: P0-D4
  - [x] 4.7 Write the CLI tests
    - `tools/test/check-spike-results.test.ts` using temp trees with `--root <tmp>`: default mode exits 0 on a tree with zero entries and on the real committed tree; a planted SI token (taken from the imported set) in a `spike/` file exits 1 with file and line and no token text; a script with a broken metadata block exits 1; `--gate` exits 1 on a temp tree where every id is `pending` (the test never depends on the real RESULTS state, which changes in group 16) and exits 0 on a temp tree with all 18 ids answered and evidence files present
    - _Requirements: R6.9, R7.7, R7.9, R17.1 to R17.3_
    - Design: Testing Strategy (`tools/test/check-spike-results.test.ts` row)
    - DoD: P0-D4
  - [x] 4.8 Add the tools suites to `tools/required-suites.json`
    - Add entries for `tools/test/spike-meta.property.test.ts`, `spike-results.property.test.ts` and `check-spike-results.test.ts` (and the two example files) in the existing format (`package`, `file`, `projects`, `minTests`), with `minTests` set to the exact count seen in the `pnpm test:reports` output
    - _Requirements: R4.2, R6.1_
    - Design: Testing Strategy ("These suites are added to `tools/required-suites.json`")
    - DoD: P0-D4 (supports), P0-D1 (supports: an empty run does not count)
  - [x] 4.9 Wire `check:spikes` into the root scripts, `verify:local` and `ci.yml`, and update the S-ops structure test (same task, same commit)
    - Owner-approved edit of S-ops files (D14, 2026-11-18). All four edits land together, and only now that `tools/check-spike-results.ts` exists:
      - root `package.json`: add `"check:spikes": "node --experimental-strip-types tools/check-spike-results.ts"` and append `&& pnpm check:spikes` to `verify:local` after `pnpm check:suites` (the `--gate` mode is not in `verify:local` or CI)
      - `.github/workflows/ci.yml`: add `- run: pnpm check:spikes` directly after `- run: pnpm check:suites`; keep the pinned action SHAs untouched
      - `tools/test/ci-workflow.test.ts`: the expected step list gains `"pnpm check:spikes"` in that position (read the file first and change only that list)
    - Run `pnpm check:pins` (pins unchanged), `pnpm test:reports`, `pnpm check:suites`, `pnpm check:spikes` and `pnpm verify:local`; all clean
    - _Requirements: R7.9, R6.9_
    - Design: D14, "Ordering" item 1
    - DoD: P0-D4 (supports), P0-D1 (supports: new CI step; the GitHub run is human-gated, S-ops HS-5)
  - [x] 4.10 Run the group verification (group 4)
    - Run `pnpm -r test`, `pnpm -r build`, `pnpm typecheck`, `pnpm -r --if-present check`, `pnpm lint`, `pnpm test:reports` and the checks `check:platform`, `check:secrets`, `check:pins`, `check:suites`, `check:si`, `check:spikes`; all clean
    - List the files this group changed for the commit (note which are S-ops files: `package.json`, `.github/workflows/ci.yml`, `tools/test/ci-workflow.test.ts`, `tools/required-suites.json`)
    - _Requirements: R6.9, R7.9_
    - Design: D14
    - DoD: P0-D4 (supports), P0-D1 (supports)

- [x] 5. Checkpoint - Scaffold, safety core, redactor and tools side
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Budget guard, approval client, agent profile and Claude launch assertion (P0)
  - DoD: P0-D4 (R8, R9, R7.11 safety contract). Requirements: R8.1 to R8.7, R9.1 to R9.11, R7.9 to R7.11, R15.8, R16.6, R16.9. Design: "Budget guard", "Approval client", "Agent profile generator", "Claude launch options", D10, A3, A5, Properties 15, 16, 18, 22.
  - Files owned: `spike/budget-ledger.json`, `spike/lib/{budget,budget-cli,approval,agent-profile,claude-launch}.ts`, `spike/test/{budget,budget.property,budget-cli,approval,approval.property,agent-profile,agent-profile.property,claude-launch,claude-launch.property}.test.ts`, `spike/test/support/fake-claude-sdk.ts`.
  - [x] 6.1 Implement `lib/budget.ts`, the ledger file and example tests
    - `BudgetLedger` (v, kiroCeiling, claudePromptCeiling, days with authoring, stopped, claudePrompts, batches), `Ceilings`, `effectiveCeilings` (`kiro = min(kiroCeiling ?? 100, 200)`), `dayUse`, `Gate`, `canStart` with gates A (run credits against the spike ceiling), B (authoring plus runs against 200) and C (Claude prompts against 40), `STOPPED`, `NEEDS-ACTUAL` (non-interactive run with no actual for the previous batch), `NO-AUTHORING` (non-interactive run with no authoring record for the day); `reserve`, `settle`, `enterActual` (an actual above 1.5 times `estimateHi` sets `stopped`; `skip` accepted), `enterAuthoring`, `readLedger`, `writeLedger` (temp file and rename); `runKiro(day) = max(sum estimateHi, sum actualDelta)`; dates are local calendar dates (D10)
    - Create `spike/budget-ledger.json` with `{"v":1,"kiroCeiling":100,"claudePromptCeiling":40,"days":{}}`; it holds no secret and is committed by the loop
    - `test/budget.test.ts`: an owner ceiling of 500 is capped at 200; `skip` clears the actual requirement; a loop run with no authoring record is refused with `NO-AUTHORING`; gate B refuses when authoring plus run exceeds 200 although gate A passes
    - _Requirements: R9.1, R9.2, R9.3, R9.6, R9.8, R9.9, R9.11_
    - Design: "Budget guard", "`spike/budget-ledger.json`", D10, A3
    - DoD: P0-D4
  - [x] 6.2 Write the property test for the budget gates
    - **Property 15: Budget gates are exact and monotonic**
    - `test/budget.property.test.ts`, tag `Feature: s-spikes, Property 15: Budget gates are exact and monotonic`; generators: ledgers, days, ceilings and estimates; assert `canStart` allows iff gates A, B, C hold, the day is not stopped and no actual is missing for a non-interactive run; `effectiveCeilings` never exceeds 200; added use never turns a refusal into an allow; an actual above 1.5 times the estimate stops the day; the ledger serialises and parses to an equal value
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.6, 9.9, 9.11**
    - Design: Property 15
    - DoD: P0-D4
  - [x] 6.3 Implement the budget CLI functions and tests
    - `lib/budget-cli.ts`: `budgetCommand(argv, io)` with `show`, `authoring <hi>` (the loop records its own labelled Estimate for the day), `authoring-actual <n>`, `actual <batchId> <n|skip>`, `ceiling <n>` (capped at 200); prints that credits cannot be measured and that the owner must read the dashboard before and after each batch (R9.4, HS-S8); it never runs git and never reads an environment value
    - `test/budget-cli.test.ts` on a temp ledger: each subcommand updates only its field; a ceiling of 300 stores 300 but `effectiveCeilings` returns 200; the message of R9.4 is printed once per `show`
    - _Requirements: R9.2, R9.4, R9.6, R9.11_
    - Design: "Budget guard" (`enterAuthoring`, `enterActual`), "Runner" (`budget` subcommand)
    - DoD: P0-D4
  - [x] 6.4 Implement `lib/approval.ts` and example tests
    - `PermissionOption`, `PermissionRequest`, `PermissionAnswer`, `ApprovalPolicy` (`ask-owner` or `reject-all`, `allowAlways: never|manual`, `timeoutMs: 120_000`), pure `pickOption(req, key, p, interactive, timedOut)` and `askOwner(req, p, io)` (requires `stdin.isTTY && stdout.isTTY`, prints tool, arguments and options to the terminal only, reads one raw key, 120 s timeout); `allow_always` is listed as "not offered" and its key ignored unless `allowAlways` is `manual` (Q33 only, R8.4); there is no code path that returns an allow kind without `by:"owner"` and a key
    - `test/approval.test.ts` with fake timers and stream stubs: the 120 s timeout answers `reject_once` (or `cancelled` when no reject option exists); a non-interactive stream answers a reject; `reject-all` never reads a key; a key for an `allow_once` option returns it with `by:"owner"`
    - _Requirements: R8.1 to R8.4, R16.9_
    - Design: "Approval client"
    - DoD: P0-D4
  - [x] 6.5 Write the property test for the approval picker
    - **Property 16: The approval picker never allows without the owner's key and times out to a reject**
    - `test/approval.property.test.ts`, tag `Feature: s-spikes, Property 16: The approval picker never allows without the owner's key and times out to a reject`; generators: option lists, keys, policies, interactivity, timeout flag; assert non-interactive, `reject-all` or timed out gives a `reject_*` option or `cancelled`; an allow kind needs `by:"owner"` and a key mapping to it; `allow_always` only with `allowAlways: manual`; the answer is always an offered option or `cancelled`
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 16.9**
    - Design: Property 16
    - DoD: P0-D4
  - [x] 6.6 Implement `lib/agent-profile.ts` and example tests
    - `ProfileOptions`, `buildKiroProfile(o)` (name `wraith-spike-<q>`, prompt, pre-approved tools from `READ_ONLY_TOOLS` only, optional hook only for `q3b`, optional write allowlist for Q31 with the write tool never pre-approved, A5), `assertSafeProfile(p)` (name pattern, subset of `READ_ONLY_TOOLS`, no wildcard, no write or execute tool pre-approved, `findUnsafeToken(JSON.stringify(p)) === null`, hook only for `q3b`), `profilePlacement(q, scratch, qs43)` (scratch `.kiro/agents/` first, home as the fallback; Q32 always home), a writer that opens with flag `wx` (a file that already exists is never overwritten), records the path in the Own_Marker `agentFiles` and refuses any other file in `~/.kiro/agents/` (R15.8, R3.7)
    - `READ_ONLY_TOOLS` and the profile field names are working names marked unverified (🧪); Q43, Q32 and Q31 evidence confirm them before other spikes rely on them (design Risks)
    - `test/agent-profile.test.ts` (temp folders only, never the real `~/.kiro`): placement order, `wx` refusal of an existing file, a second file name is refused
    - _Requirements: R8.5, R15.8, R16.6, R7.9, R7.10_
    - Design: "Agent profile generator", Risks (Kiro profile field names), A5
    - DoD: P0-D4
  - [x] 6.7 Write the property test for agent profiles
    - **Property 18: Agent profiles contain only read-only pre-approved tools and no SI tokens**
    - `test/agent-profile.property.test.ts`, tag `Feature: s-spikes, Property 18: Agent profiles contain only read-only pre-approved tools and no SI tokens`; generators: any `ProfileOptions`; assert `buildKiroProfile` output passes `assertSafeProfile`, and `assertSafeProfile` throws for each single mutation that adds a write tool, a wildcard or an SI literal (taken from `tools/lib/unsafe-tokens.ts` at test time, never spelled)
    - **Validates: Requirements 7.9, 7.10, 7.11, 8.5**
    - Design: Property 18
    - DoD: P0-D4
  - [x] 6.8 Implement `lib/claude-launch.ts`, the fake SDK and example tests
    - `ClaudeLaunchView` (setting sources, permission mode, allowed tools, allow rules, settings file or object), `READ_ONLY_CLAUDE_TOOLS`, `buildClaudeLaunch({cwd, askOwner})` and pure `assertSafeClaudeLaunch(opts)` that throws on non-empty setting sources, a permission mode other than `default`, a non-empty allow-rule list, an allowed-tools list with a tool outside `READ_ONLY_CLAUDE_TOOLS` or a wildcard, a settings file or object, or an SI token in the serialised options (R7.11)
    - The field names are WORKING NAMES. The Claude Agent SDK is not installed when this task runs. Do not guess: task 13.8 installs the SDK, reads the names from its installed type definitions and renames `ClaudeLaunchView` and the fields of `assertSafeClaudeLaunch` (and the fake) to the real names
    - `test/support/fake-claude-sdk.ts` records the options it receives; `test/claude-launch.test.ts`: the object `buildClaudeLaunch` produced is the one the fake saw and passes `assertSafeClaudeLaunch`; each unsafe field is refused
    - _Requirements: R7.11, R15.6, R16.3_
    - Design: "Claude launch options", Risks (Claude SDK loading the owner's settings)
    - DoD: P0-D4
  - [x] 6.9 Write the property test for Claude launch options
    - **Property 22: Unsafe Claude launch options are refused**
    - `test/claude-launch.property.test.ts`, tag `Feature: s-spikes, Property 22: Unsafe Claude launch options are refused`; generators: option objects over all fields, SI tokens imported from `tools/lib/unsafe-tokens.ts`; assert `assertSafeClaudeLaunch` throws iff one of the listed conditions holds, never throws for empty setting sources, default mode, no allow rules and a read-only or absent tools list, and the options recorded by the fake SDK from `buildClaudeLaunch` always satisfy it
    - **Validates: Requirements 7.11, 15.6, 16.3**
    - Design: Property 22
    - DoD: P0-D4
  - [x] 6.10 Run the group verification (group 6)
    - Run `pnpm -r test`, `pnpm -r build`, `pnpm typecheck`, `pnpm -r --if-present check`, `pnpm lint`, `pnpm check:secrets`, `pnpm check:platform`, `pnpm check:si` and `pnpm check:spikes`; all clean
    - List the files this group changed for the commit
    - _Requirements: R8.1, R9.1_
    - Design: Testing Strategy
    - DoD: P0-D4 (supports)

- [x] 7. Runner: order, metadata reader, pipeline, Observe_Mode entry (P0)
  - DoD: P0-D4 (R4, R5.4, R6.10, R10, R12). Requirements: R1.3, R1.8, R1.9, R2.1, R2.9, R3.1, R4.2, R4.3, R5.4, R6.6, R6.10, R10.2, R10.4, R12.1 to R12.8. Design: "The run pipeline", "Order and Run_By gate", "Runner", D6, D16, A6, Properties 19.
  - Files owned: `spike/lib/{order,meta,observe}.ts`, `spike/run.ts`, `spike/test/{order,order.property,meta,observe,runner.integration}.test.ts`, root `package.json` (the `spike` script, task 7.7).
  - [x] 7.1 Implement `lib/order.ts` and example tests
    - `STAGES` (stage 1 order Q2, Q13, Q12, Q1, Q6; stage 2 Q7, Q43; stage 3 Q3, Q3b, Q10, Q4, Q11, Q23; stage 4 Q30, Q32, Q31, Q35 Kiro part; stage 5 Q33 and Q35 Claude part; any time Q14), `orderBatch(ids, metas)` (topological over `depends` and `shares`, stage order as the tie-break, a warning when a dependency is missing from the batch, Q33 rejected from a batch with other Agent_Spikes), `runByGate(m, io)` (`pending` with reason "needs interactive terminal" iff Run_By is `owner` and stdin or stdout is not a TTY), `dependencyNote(dep, depResult)` (for example Q43 `FAIL`: launch without the agent argument and select it after `initialize`, R12.8)
    - `test/order.test.ts`: the stage order of the Requirements, Q23 after Q3, Q6 last of Group A, Q14 first-class "any time"
    - _Requirements: R6.10, R12.1 to R12.8_
    - Design: "Order and Run_By gate"
    - DoD: P0-D4
  - [x] 7.2 Write the property test for ordering and the Run_By gate
    - **Property 19: Run order respects dependencies and Run_By**
    - `test/order.property.test.ts`, tag `Feature: s-spikes, Property 19: Run order respects dependencies and Run_By`; generators: subsets of the 19 ids with the real metadata shapes and TTY flags; assert dependencies (and `shares`) come first when in the set, Q43 before every Kiro spike that depends on it, Q2 first and Q6 last among Group A, Q33 rejected from a mixed batch, and `runByGate` returns `pending` iff Run_By is `owner` and a stream is not a TTY
    - **Validates: Requirements 6.10, 12.1, 12.3, 12.4, 12.5, 12.6, 12.8**
    - Design: Property 19
    - DoD: P0-D4
  - [x] 7.3 Implement `lib/meta.ts` and its test
    - `readSpikeMeta(q)` reads the first 40 lines of `locate(q).script` and calls `parseMetaBlock` from `tools/lib/spike-meta.ts` (relative import, D2); a missing file or block refuses the run (R4.2)
    - `test/meta.test.ts` with temp scripts: a valid block returns the meta; a missing block and a missing file refuse with the reason; the block is found only in the first 40 lines
    - _Requirements: R4.2, R4.3_
    - Design: "Module layout" (`lib/meta.ts`), D2
    - DoD: P0-D4
  - [x] 7.4 Implement `spike/run.ts` (pipeline, signals, subcommand hooks)
    - `parseArgs(argv)` (ids, `--observe-default`, subcommands `list`, `record`, `budget`), `main(argv, io)`, `RunIo` (stdin and stdout TTY flags, clock, a script loader `load(q)` so tests can inject spike modules, handlers for the `record` and `budget` subcommands), `SpikeContext` as in the design; the pipeline is: parse ids (unknown id lists the known ids and exits 1, R5.4), read metadata blocks, `orderBatch`, `runByGate`, budget gate for the batch (reserve before the first prompt), `gatherPreflightInput` and `runPreflight` (failure prints ids only, exit 20), write the Own_Marker, run each spike with its `SpikeContext`, redact and write evidence and `finish`, settle the budget, cleanup in `finally` (also stale roots from earlier runs, R3.6), print open human steps (`ctx.humanStep` prints, records and never performs, R10.2)
    - A batch shares one Spike_Root named after the first id and one Own_Marker (D6, A6); SIGINT and SIGTERM run `cleanupRun` once and exit 130 or 143, a second signal exits at once; exit codes from `EXIT`; a recorded `PASS`, `FAIL` or `PARTIAL` exits 0, pending exits 10; the runner never runs git and never edits `RESULTS.md` or `PHASE-STATUS.md` (D7); no `E_*` code (D16)
    - Messages are fixed strings plus ids and paths; no environment value, request body or file content is ever printed
    - _Requirements: R1.3, R2.1, R2.9, R3.1, R4.2, R4.3, R5.4, R6.6, R6.10, R10.2, R10.4, R12.4_
    - Design: "The run pipeline", "Runner", D6, D7, D16, A6, "Error Handling"
    - DoD: P0-D4
  - [x] 7.5 Implement the Observe_Mode entry and its tests
    - `lib/observe.ts`: `runObserve(io)` for `pnpm spike q14 --observe-default`: refuses when stdin or stdout is not a TTY; refuses when any live Own_Marker exists under `/tmp/hcw/` (R1.9); creates `/tmp/hcw/.observe-lock` with flag `wx` and removes it in `finally`; the runner refuses to start any other spike while the lock exists; builds its hc wrapper with `createObserveHc` only (allow-list exactly `["server","status"]`, child env from the `tool` profile, no `HC_SESSION`); it does not use the normal preflight, which keeps refusing `default` (R2.16)
    - `test/observe.test.ts` with `fake-hc` and a temp lock path: a non-TTY run is refused; a live marker refuses; a held lock refuses another spike; only `server status` reaches the fake; the fake's recorded env names hold no `HC_*` or `HERDR_*`
    - _Requirements: R1.8, R1.9, R1.10, R2.16, R13.12_
    - Design: "hc wrapper" (observe), "The run pipeline" (Observe_Mode), Group A Q14, D4
    - DoD: P0-D4
  - [x] 7.6 Write the runner integration tests (part 1, with fakes)
    - `test/runner.integration.test.ts` using injected spike modules, `fake-hc` and temp roots (the `/tmp/hcw` prefix is a parameter so tests stay in `os.tmpdir()`): a non-TTY run of an owner spike ends `pending` ("needs interactive terminal"), exit 10, and starts no fake process; unknown id lists the ids and exits 1; a batch cleans its root and deletes its agent files; a stale root with a dead pid is cleaned before a new run; a preflight failure (pane env names present with a leaking builder variant) exits 20 and starts nothing; a budget refusal exits 21; a planted secret (from fragments) in a spike's output fails the spike, deletes the evidence file and exits 22 (NEEDS_HUMAN) with the class only; SIGINT leads to one cleanup pass
    - _Requirements: R2.1, R3.1, R3.6, R5.4, R6.10, R7.1, R7.5, R9.1_
    - Design: Testing Strategy (`runner.integration.test.ts` row)
    - DoD: P0-D4
  - [x] 7.7 Wire the root script `spike`
    - Root `package.json`: add `"spike": "node --experimental-strip-types spike/run.ts"` (pnpm appends the ids); do not change any other script
    - Run `pnpm spike nope` and confirm it lists the known ids and exits 1 (a local check that starts no spike, no core and no agent); run `pnpm spike list` and confirm it lists all 19 ids with their Run_By and group
    - _Requirements: R5.4_
    - Design: "Runner" (`pnpm spike`)
    - DoD: P0-D4 (supports)
  - [x] 7.8 Run the group verification (group 7)
    - Run `pnpm -r test`, `pnpm -r build`, `pnpm typecheck`, `pnpm -r --if-present check`, `pnpm lint`, `pnpm check:secrets`, `pnpm check:platform`, `pnpm check:si` and `pnpm check:spikes`; all clean
    - List the files this group changed for the commit
    - _Requirements: R5.4_
    - Design: Testing Strategy
    - DoD: P0-D4 (supports)

- [x] 8. acp-echo, hook receiver and MCP echo libraries, with fake-agent tests (P0)
  - DoD: P0-D4 (R14 support code; R7.12 and R8.6 safety contract). Requirements: R4.3, R5.8, R7.12, R8.1 to R8.3, R8.6, R9.7, R12.5, R14.1 to R14.5. Design: "acp-echo client", "Hook receiver", "MCP echo server", D11, D12, Property 17.
  - Files owned: `spike/lib/{acp-echo,hook-receiver,mcp-echo}.ts`, `spike/kiro/q3b/hook-client.ts`, `spike/test/{acp-echo,hook-receiver,hook-receiver.property,mcp-echo}.test.ts`, `spike/test/support/fake-kiro.ts` (extended), `spike/package.json` and `pnpm-lock.yaml` (the SDK dependency, task 8.1), `spike/test/runner.integration.test.ts` (part 2, task 8.8).
  - [x] 8.1 Read the ACP SDK license and add the dependency
    - Run `pnpm view @agentclientprotocol/sdk license version` (read-only). If the license is MIT, Apache-2.0, BSD or ISC, add the exact current version to `spike/package.json` `dependencies` and run `pnpm install`; record the package, exact version and license in the task evidence for task 17.1
    - If the license is not permissive or the package cannot be found, STOP and report to the owner: nothing is added, task 8.4 and the SDK half of Q10 (task 12.3) become conditional (Q10 ends `pending` with the reason); the raw client and every other task continue
    - _Requirements: R5.8_
    - Design: "acp-echo client", Risks (ACP field names)
    - DoD: P0-D4 (supports)
  - [x] 8.2 Extend `fake-kiro.ts` to a small ACP agent
    - Speaks newline-delimited JSON-RPC on stdio: `initialize` (with `mcpCapabilities` and the client's `terminal` flag echoed back), `session/new`, `session/load` (replays the earlier updates with stable ids, or with changed ids when the test asks), `session/prompt` that sends one `session/request_permission` (with `options[]`) and waits for the answer before a tool update with status completed or failed, a second prompt, `available_commands_update` after `session/new` and `session/load`, `terminal/create` and `terminal/output` calls when the client declared `terminal:true`, and an HTTP MCP call to a given `mcpServers` entry; it records the `permission` answers it received and refuses to proceed on any answer it did not get
    - Flags: `--agent-engine v3`, `--agent <name>` accepted or rejected by a test option (for the Q43 `FAIL` path); never reads the real `~/.kiro`
    - _Requirements: R12.5, R14.1 to R14.7, R16.1_
    - Design: Testing Strategy (`runner.integration.test.ts` row: fake-kiro speaks just enough ACP)
    - DoD: P0-D4 (supports)
  - [x] 8.3 Implement the raw ACP client in `lib/acp-echo.ts` and its tests
    - `AcpEcho`, `AcpFrame`, `PromptCapReached`, `startRawAcp({argv, cwd, env, maxPrompts, killAfterMs, rawLog})`: spawns the agent with `shell:false` and the `agent` env profile, writes every frame to `rawLog` under the Spike_Root, answers `session/request_permission` only through the approval client (R8.1, R8.2), throws `PromptCapReached` on prompt number `maxPrompts + 1` before anything is sent (R4.3, R9.7), closes the agent at `maxWallSeconds` and reports `PARTIAL` with that reason, declares `terminal:true` only when asked (Q4); argv containing an SI token is refused
    - `test/acp-echo.test.ts` with `fake-kiro`: initialize, new session, prompt, update and permission work; the prompt cap closes the agent and counts prompts sent; the wall-time timer closes it; a reject-all policy gives `reject_once` and the fake never runs the tool; frames are written; the child env holds no `HC_*`, `HERDR_*` or `XDG_*` name
    - _Requirements: R4.3, R8.1 to R8.3, R9.7, R12.5, R14.8_
    - Design: "acp-echo client"
    - DoD: P0-D4
  - [x] 8.4 Add the SDK variant `startSdkAcp` and its tests (conditional on 8.1)
    - In `lib/acp-echo.ts`: `startSdkAcp(i)` with the same interface over `@agentclientprotocol/sdk`; same caps, same approval path, same frame log; `test/acp-echo.test.ts` (appended): the same scenario as 8.3 against `fake-kiro` produces the same method sequence as the raw client
    - If task 8.1 stopped, skip this task and record the reason; the loop continues
    - _Requirements: R14.3_
    - Design: "acp-echo client" (`startSdkAcp`), Risks (ACP field names)
    - DoD: P0-D4
  - [x] 8.5 Implement `lib/hook-receiver.ts` and `kiro/q3b/hook-client.ts`
    - `decideHook(req, expectedToken, answer)` (pure and total), `startHookReceiver({port: 7782, token, ask, log})` bound to `127.0.0.1` only with header `x-wraith-spike-token` (a random 32-byte hex per run, written to `<root>/hook.token` with mode 0600); an allow exists only as an owner tap for that single request and is recorded; a busy port returns a `pending` outcome with the reason
    - `hook-client.ts`: reads stdin, posts to the receiver, reads the token from `<root>/hook.token` (argument: the root), exits 0 only on a JSON `{decision:"allow", nonce}` matching the request; every other case (timeout, connection error, wrong shape, `block`) exits 2 (D11); no token ever sits in a profile or in `~/.kiro`
    - _Requirements: R7.12, R8.6, R14.2_
    - Design: "Hook receiver", D11
    - DoD: P0-D4
  - [x] 8.6 Write the property test for the hook decision and example tests
    - **Property 17: The hook decision fails closed**
    - `test/hook-receiver.property.test.ts`, tag `Feature: s-spikes, Property 17: The hook decision fails closed`; generators: any token, malformed body, any answer including `timeout` and `error`; assert exit code 2 and `block` unless the token matches, the body is well formed and the answer is an owner-selected `allow_once`, in which case exit code 0 and an `allow` whose nonce equals the request's
    - `test/hook-receiver.test.ts`: the server binds `127.0.0.1` only; a request without the token is refused; the client exits 2 on timeout (fake timers), on connection refused and on a `block`; the client exits 0 only on the matching allow
    - **Validates: Requirements 7.12, 8.6**
    - Design: Property 17
    - DoD: P0-D4
  - [x] 8.7 Implement `lib/mcp-echo.ts` and its tests
    - Hand-written minimal MCP server over HTTP on `127.0.0.1` and a random port, header token required, handling `initialize`, `tools/list` and one `tools/call` tool `echo` with plain `application/json` replies (D12); `startMcpEcho({token}): Promise<{url, calls(), close()}>`; it records each call (tool, argument length, header presence, never the token)
    - `test/mcp-echo.test.ts`: a request without the token is refused; the three methods answer; `calls()` shows one tool call; the server binds `127.0.0.1` only
    - _Requirements: R7.12, R14.4_
    - Design: "MCP echo server", D12, Risks (MCP http handshake)
    - DoD: P0-D4
  - [x] 8.8 Write the runner integration tests (part 2, fake agent)
    - Append to `test/runner.integration.test.ts`: a loop-run spike in the style of Q43 against `fake-kiro` answers the fake's permission request with `reject_once` and the fake records no allow; a spike that sends more prompts than its metadata maximum is stopped, `PARTIAL` with the reason and `promptsSent` recorded; a Kiro `--agent` rejection by the fake (Q43 `FAIL` path) makes the next spike's launch omit the argument and select the agent after `initialize` (R12.8)
    - _Requirements: R4.3, R8.3, R9.7, R12.8, R16.9_
    - Design: Testing Strategy (`runner.integration.test.ts` row)
    - DoD: P0-D4
  - [x] 8.9 Run the group verification (group 8)
    - Run `pnpm -r test`, `pnpm -r build`, `pnpm typecheck`, `pnpm -r --if-present check`, `pnpm lint`, `pnpm check:secrets`, `pnpm check:platform`, `pnpm check:si` and `pnpm check:spikes`; all clean; no real `kiro-cli`, `claude` or core was started by any test
    - List the files this group changed for the commit
    - _Requirements: R7.12, R8.6_
    - Design: Testing Strategy
    - DoD: P0-D4 (supports)

- [x] 9. Checkpoint - Libraries and runner
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 10. Group A spike scripts: Q2, Q13, Q12, Q1, Q6, Q14 (P0, authoring only)
  - DoD: P0-D4 (supports: the scripts that stage 1 and Q14 run). Requirements: R13.1 to R13.12, R4.2, R5.1, R5.2, R10.1. Design: "Group A", Properties 21. The tasks WRITE the scripts, READMEs, metadata blocks and unit tests with fakes; RUNNING them is group 16 (Q2, Q13, Q12, Q1, Q6, loop) or an owner step (Q14, HS-S4).
  - Files owned: `spike/hc/<q>/{<q>.ts,README.md,evidence/.gitkeep}` for each of `q2 q13 q12 q1 q6 q14`, `spike/hc/q6/{stub-sprite,node-stub,respawn}.ts`, `spike/hc/q1/metrics.ts`, `spike/hc/q12/sender.ts`, `spike/hc/q14/path-check.sh`, `spike/test/spikes/{q2,q13,q12,q1,q6,q14}.test.ts`, `spike/test/order.property.test.ts` (task 10.6).
  - Common to every task of this group: the script starts with a metadata block (`// spike-meta` ... `// end-spike-meta`, keys of "Metadata block", values from the Register, labelled as Estimates with assumption A1 where cost is not none), exports `run(ctx)` returning a `SpikeOutcome`, talks to `hc` only through `ctx.hc`, writes evidence only through `ctx.evidence`, calls `ctx.humanStep` for owner actions, and records `hc --version`. The README is at most 40 lines (question, how to run, human steps, what to read in the evidence). No SI token is spelled. Results never come from the 2026-11-05 pre-checks (R17.7). Tests use `fake-hc` and never start a real core.
  - [x] 10.1 Write the Q2 spike
    - Script: `hc schema` into `schema.json`; `terminal.run` of a stub that prints `$PWD`, `$WRAITH_X` and `$HC_TERMINAL_ID` with cwd, env and labels; `ls` with a labels filter; `get t<N>` with an address next to a terminal labelled with the same name, proving the address wins; `env -0` available on macOS; pane `PATH` and agent variables compared with a login shell's (names only for variables other than PATH); which `HC_*` names a pane really exports (settles the hazard of R1.6); Herdr.app visibility and the Herdr Core app PATH comparison are HS-S5, recorded "unobserved" (R13.1, R13.2); `publishNamedCopy("q2", ...)` on `PASS` or `PARTIAL`
    - Metadata: group A, cost none, run-by loop, agents none, max-prompts 0, max-wall-seconds 1800, estimate-credits none, human HS-S5, depends none, shares none, allow-always never
    - Test with `fake-hc`: the pass rule (cwd, env and labels applied and `HC_TERMINAL_ID` set), the address-versus-label check logic, the "unobserved" wording, the named copy only for `PASS` and `PARTIAL`
    - _Requirements: R13.1, R13.2, R5.6_
    - Design: "Group A" (Q2), D8
    - DoD: P0-D4 (supports)
  - [x] 10.2 Write the Q13 spike
    - Script: reads Q2's `schema.json` evidence, runs `templates`, a template run and `wait` against a stub; records the observed behaviour only; `PASS` only if one of template, `first_message`, `terminal.wait` replaces part of the sprite's ACP or queue work, otherwise `FAIL` with the branch "use the sprite as designed" (the expected result; R13.10); the judgement text is written into the entry notes by the loop at `record` time
    - Metadata: group A, cost none, run-by loop, max-prompts 0, max-wall-seconds 900, human none, depends q2
    - Test with `fake-hc`: the verdict function for "replaces nothing" gives `FAIL` and the branch text; a stub where `wait` replaces queue work gives `PASS`
    - _Requirements: R13.10_
    - Design: "Group A" (Q13)
    - DoD: P0-D4 (supports)
  - [x] 10.3 Write the Q12 spike and the sender-field finder
    - `q12/sender.ts`: pure `findSenderField(events)` (any event key matching `/client|source|sender|origin/i` next to a pane id); script: an `events` follower through `ctx.hc.spawnLong`, `hc send` from a second child, record whether an event names the pane and the sending client; expected `FAIL`, branch "drop `herdr-guard`, keep the limitation in §12" (R13.9)
    - Metadata: group A, cost none, run-by loop, max-prompts 0, max-wall-seconds 600, depends q2
    - Test: `findSenderField` on events with and without a sender-like key (generated examples); the verdict mapping
    - _Requirements: R13.9_
    - Design: "Group A" (Q12)
    - DoD: P0-D4 (supports)
  - [x] 10.4 Write the Q1 spike and its metric helpers
    - `q1/metrics.ts`: pure `cpuSeconds("M:SS.cc")` and `increasePoints(base, during)` (percentage points of one core from `ps -o cputime=` deltas over wall time); script: a full-screen program in a pane (`htop` when on PATH, else `top -s 1`, the substitute recorded, OQ-7, D17), 60 s baseline of Test_Core CPU (own pids from `server.status` that pass `pidIsOwn`), then `terminal.read` every 250 ms for 5 minutes, per-read payload bytes; `PASS` when the increase is below 5 points and the largest payload below 64 KB; branches "poll 1 s" and "send only line diffs (Q20)" (R13.3, R13.4); evidence `samples.csv` and `summary.json`; the caveat that the CLI `read` spawns a process per read is recorded
    - Metadata: group A, cost none, run-by loop, max-prompts 0, max-wall-seconds 2400, human HS-S1 (optional htop) and HS-S5, depends q2
    - Test with `fake-hc` and a shortened schedule injected by the test: thresholds at 5 points and 64 KB, the substitute is recorded when `htop` is absent
    - _Requirements: R13.3, R13.4, R13.5_
    - Design: "Group A" (Q1), D17
    - DoD: P0-D4 (supports)
  - [x] 10.5 Write the Q6 spike, stub sprite, node stub and respawn rule
    - `q6/respawn.ts`: pure `respawnDecision(reason, code)` (respawn only for `holder_lost` or a core stop; never for `exited 0` or `killed`); `q6/stub-sprite.ts` (Wraith labels, exits 75 on SIGHUP); `q6/node-stub.ts` (follows `events`, polls `ls` by labels every 5 s, respawns with the same ids); script steps (a) `server restart` (same pid keeps running), (b) kill the holder pid from `server.status` after the own-pid check (`holder_lost`, respawn within 10 s), (c) `server stop` then `server start` (respawn within 10 s), (d) `hc kill` of the stub records `killed` and `kill -TERM` records `exited` 75 with no respawn on `killed`; monotonic clock; Herdr.app close-button reason is HS-S5, "unobserved" (R13.6 to R13.8); all under the Test_Session only; runs last of stage 1 because it restarts the Test_Core
    - Metadata: group A, cost none, run-by loop, max-prompts 0, max-wall-seconds 2700, human HS-S5, depends q2
    - Test with `fake-hc` scripted to return pids and reasons: each of a to d, the 10 s limit with an injected clock, no respawn for `killed`
    - _Requirements: R13.6, R13.7, R13.8, R3.3_
    - Design: "Group A" (Q6)
    - DoD: P0-D4 (supports)
  - [x] 10.6 Write the property test for the metric helpers
    - **Property 21: Metrics helpers**
    - Append to `test/order.property.test.ts`, tag `Feature: s-spikes, Property 21: Metrics helpers`; generators: nondecreasing lists of `M:SS.cc` cputime samples, wall windows, and (reason, code) pairs; assert `cpuSeconds` parses, `increasePoints` equals `(Δcpu / Δwall × 100)` of the during window minus the baseline window and is never negative for nondecreasing input, and `respawnDecision` returns respawn exactly for `holder_lost` and core stop, never for exit code 0 or `killed`
    - **Validates: Requirements 13.3, 13.4, 13.7**
    - Design: Property 21
    - DoD: P0-D4
  - [x] 10.7 Write the Q14 observer and the PATH check script
    - Script `q14.ts` (Observe_Mode only, run through `lib/observe.ts`): before the owner logs out it prints the instructions and a timestamped start line; after login it polls `["server","status"]` once per second for up to 60 s and records the time to the first success (pass line: 10 s or less); it starts nothing, creates no pane and never lists terminals; evidence `observe.txt` holds only `t+<seconds> ok|fail` lines, the measured time and the home-masked state directory, reduced before `ctx.evidence.addText` (R13.11, R13.12); the result is `PARTIAL` by construction with open HS-S4 items (Linux unit, reboot, reboot with nobody logged in, recorded pane reason not `killed`); `path-check.sh` is a short script the owner runs in a pane the owner creates, printing whether `kiro-cli` resolves
    - Metadata: group A, cost none, run-by owner, max-prompts 0, max-wall-seconds 1800, human HS-S4, depends none
    - Test with `fake-hc`: only `server status` reaches the fake, the evidence text holds no terminal list, label, cwd or project path, the outcome is `PARTIAL` with the open steps, a non-TTY run is refused
    - _Requirements: R13.11, R13.12, R10.5, R1.8, R1.9_
    - Design: "Group A" (Q14), D4
    - DoD: P0-D4 (supports)
  - [x] 10.8 Run the group verification (group 10)
    - Run `pnpm -r test`, `pnpm -r build`, `pnpm typecheck`, `pnpm -r --if-present check`, `pnpm lint`, `pnpm check:secrets`, `pnpm check:platform`, `pnpm check:si` and `pnpm check:spikes` (it now validates six metadata blocks and scans the new files for SI tokens); all clean
    - List the files this group changed for the commit
    - _Requirements: R4.2, R7.9_
    - Design: Testing Strategy
    - DoD: P0-D4 (supports)
  - [ ] 10.9 Wire `pnpm spike q14 --observe-default` to `q14.run`
    - `spike/run.ts` handles `q14 --observe-default` through `runObserve` (`lib/observe.ts`) but its default work is one `server status` call, not the Q14 observer. Pass `q14.run` as the observer's work: build the `SpikeContext` for Observe_Mode (`hc` = the `createObserveHc` wrapper handed to `run`, `interactive` from the two TTY flags, `evidence` from `createEvidenceWriter` for `q14`, `humanStep`, `now`; no scratch, no agent, no approval), run `run(ctx)` from `spike/hc/q14/q14.ts`, then write the evidence index through `finish` like any other spike
    - Keep every Observe_Mode rule: no normal preflight, TTY on both streams, refusal while a live Own_Marker exists, the `.observe-lock` held during the run and removed in `finally`, only `server status` reaches hc, no `HC_*` or `HERDR_*` name in the child env; a result other than `PARTIAL` or `pending` is an internal error
    - Test in `spike/test/runner.integration.test.ts` (or a new `runner.observe.test.ts`) with the fake hc and a fake clock: a TTY run polls only `server status`, writes `observe.txt` and an index with result `PARTIAL` and HS-S4 open, exits 0; a non-TTY run is `pending` with "needs interactive terminal" and calls nothing; the lock is removed after a throw; `q14` without `--observe-default` is refused by the run-by gate
    - _Requirements: R1.8, R1.9, R13.11, R13.12_
    - Design: "Observe_Mode", D4
    - DoD: P0-D4 (supports)

- [ ] 11. Stage-2 spike scripts: Q43 and Q7 (P0, authoring only)
  - DoD: P0-D4 (supports). Requirements: R14.6, R16.5 to R16.9, R15.8, R8.3, R3.7. Design: "Group B" (Q43, Q7), "Agent profile generator". The tasks WRITE the scripts; RUNNING them is group 16 (conditional).
  - Files owned: `spike/kiro/{q43,q7}/{<q>.ts,README.md,evidence/.gitkeep}`, `spike/test/spikes/{q43,q7}.test.ts`.
  - [ ] 11.1 Write the Q43 spike
    - Script: writes the profile (`buildKiroProfile`, read-only tools only) into `<scratch>/.kiro/agents/wraith-spike-q43.json` and tries `kiro-cli acp --agent-engine v3 --agent wraith-spike-q43`; if the agent is not found or its tools are not applied, writes the same new file into `~/.kiro/agents/` (HS-S6; flag `wx`, recorded in the marker, deleted in cleanup) and retries once; sends `initialize`, `session/new` and at most one prompt that asks for a tool the profile does not pre-approve; the approval policy is `reject-all` so every permission request is answered `reject_once` (R16.9, R8.3); `PASS` when the process starts, the agent's tools or prompt apply and the tool asks; writes `placement.json` (`scratch` or `home`) that later spikes read through `profilePlacement`; on `FAIL` the branch is "launch without `--agent`, select it after `initialize` with `session/set_mode` or the agent config option" and the text to update is "§4.4/§5 argv", recorded without editing the architecture (R16.7)
    - Metadata: group J, cost low, run-by loop, agents kiro, max-prompts 1, max-wall-seconds 900, estimate-credits 0-3, human HS-S2 and HS-S6, depends none, shares none, allow-always never, assumption A1 Estimate
    - Test with `fake-kiro` (accepting and rejecting `--agent`): scratch placement wins when applied; home fallback creates one new file and cleanup deletes it; a permission request gets `reject_once` and no allow; at most one prompt is sent; the `FAIL` branch text
    - _Requirements: R16.5, R16.6, R16.7, R16.9, R15.8, R3.7_
    - Design: "Group B" (Q43), A5
    - DoD: P0-D4 (supports)
  - [ ] 11.2 Write the Q7 spike
    - Script: runs `kiro-cli chat --list-sessions --help` and the same with `--format json` (help only, no model prompt, no login use); the help text goes through the redactor (SI-token lines are replaced); `PASS` when a JSON output option exists; branch on `FAIL`: "use ACP `session/list` only" (R14.6)
    - Metadata: group B, cost none, run-by loop, agents none, max-prompts 0, max-wall-seconds 300, estimate-credits none, human none, depends none
    - Test with `fake-kiro`'s help text (with and without a JSON option, and with a line that holds an imported SI token): verdict and redaction
    - _Requirements: R14.6, R7.9_
    - Design: "Group B" (Q7), D9
    - DoD: P0-D4 (supports)
  - [ ] 11.3 Run the group verification (group 11)
    - Run `pnpm -r test`, `pnpm -r build`, `pnpm typecheck`, `pnpm -r --if-present check`, `pnpm lint`, `pnpm check:secrets`, `pnpm check:si` and `pnpm check:spikes`; all clean; no real `kiro-cli` was started
    - List the files this group changed for the commit
    - _Requirements: R16.5_
    - Design: Testing Strategy
    - DoD: P0-D4 (supports)

- [ ] 12. Owner-run Group B spike scripts: Q3, Q3b, Q10, Q4, Q11, Q23 (P0, authoring only)
  - DoD: P0-D4 (supports). Requirements: R14.1 to R14.9, R8.1 to R8.6, R7.12, R4.3. Design: "Group B", Properties 16, 17. The tasks WRITE the scripts, READMEs, metadata blocks and fake-based tests; RUNNING them is an owner step (HS-S2, HS-S3; see Notes), never a task. Every agent argv is `kiro-cli acp --agent-engine v3 --agent wraith-spike-<q>` (or without `--agent` when Q43 failed), cwd is the Scratch_Workspace, the profile pre-approves read-only tools only, every permission request goes to `askOwner`, and no script contains a path that answers a permission request without the owner's key.
  - Files owned: `spike/kiro/<q>/{<q>.ts,README.md,evidence/.gitkeep}` for each of `q3 q3b q10 q4 q11 q23`, `spike/kiro/q10/compare.ts`, `spike/kiro/q23/compare.ts`, `spike/test/spikes/{q3,q3b,q10,q4,q11,q23}.test.ts`.
  - [ ] 12.1 Write the Q3 spike
    - Script: profile that does not pre-approve the shell tool, prompt "run `echo hi`", `onPermission` to `askOwner`; evidence `frames.jsonl` (copied by `publishNamedCopy("q3", ...)` to `spike/kiro/q3.jsonl` on `PASS` or `PARTIAL`) and `session.json` (session id and cwd, kept for Q23 in the same batch through `ctx.shared`); `PASS` when `session/request_permission` arrives with `options[]` and the owner's selection makes the tool run; an approval timeout gives `PARTIAL` "approval tap missing"
    - Metadata: group B, cost low, run-by owner, agents kiro, max-prompts 4, max-wall-seconds 1800, estimate-credits 2-6, human HS-S2 and HS-S3, depends q43, shares none, allow-always never, assumption A1 Estimate
    - Test with `fake-kiro` and a stubbed owner: `PASS` on a selected `allow_once`, `PARTIAL` on timeout, `FAIL` when no `request_permission` arrives; `session.json` written
    - _Requirements: R14.1, R14.9, R8.2, R8.3_
    - Design: "Group B" (Q3)
    - DoD: P0-D4 (supports)
  - [ ] 12.2 Write the Q3b spike
    - Script: profile with a `preToolUse` hook running `node --experimental-strip-types <abs>/spike/kiro/q3b/hook-client.ts <root>` against the receiver (no token in the profile), prompt as Q3; `PASS` when the hook fires before the tool, exit code 2 blocks the tool, and the hook timeout is measured by a probe in which the receiver holds one request unanswered and logs when the agent closes the connection or kills the hook (cap 130 s, then answers block); records the measured value; sets `stop = true` in the index when Q3 and Q3b both end `FAIL` (exit code stays 0); Q3 `FAIL` with Q3b `PASS` selects "approval via `preToolUse` + one-shot grant"; Q3 `PASS` still records Q3b (R14.2, R14.9, OQ-8)
    - Metadata: group B, cost low, run-by owner, agents kiro, max-prompts 4, max-wall-seconds 1800, estimate-credits 2-6, human HS-S2 and HS-S3, depends q43 and q3
    - Test with `fake-kiro` set to call the hook command and a fake clock: block on exit 2, the measured timeout recorded, receiver blocks on timeout, an allow only after a stubbed owner tap
    - _Requirements: R14.2, R14.9, R8.6, R7.12, R11.2_
    - Design: "Group B" (Q3b), D11
    - DoD: P0-D4 (supports)
  - [ ] 12.3 Write the Q10 spike and the frame comparison
    - `q10/compare.ts`: pure `compareFrames(raw, sdk)` (same method sequence, no SDK schema rejection thrown); script: the same scenario (initialize, new session, one prompt asking for a read-only tool, update stream, one permission) with `startRawAcp` and with `startSdkAcp`; `PASS` when everything works through the SDK; branch on `FAIL`: `packages/acp-lite` (+1 to 2 days); also confirms the ACP field names used by Q11 (`mcpServers` http entry, `session/list`) against the SDK types and records them (design Risks)
    - If task 8.1 stopped (SDK not added), the script ends `pending` with that reason
    - Metadata: group B, cost low, run-by owner, agents kiro, max-prompts 6, max-wall-seconds 2400, estimate-credits 4-10, human HS-S2 and HS-S3, depends q3
    - Test with `fake-kiro`: `compareFrames` on equal and on diverging sequences; the scenario passes through both clients
    - _Requirements: R14.3, R5.8_
    - Design: "Group B" (Q10)
    - DoD: P0-D4 (supports)
  - [ ] 12.4 Write the Q4 spike
    - Script: `clientCapabilities.terminal:true`; prompt for a long command (`sleep 20; echo done` through the shell tool, with the owner's tap); the client's `terminal/create` and `terminal/output` handlers run nothing, only log the calls and answer with an error result, so no command runs outside the agent's own approval; `PASS` when `terminal/create` and `terminal/output` arrive; branch on `FAIL`: "show output in the ToolCard"
    - Metadata: group B, cost low, run-by owner, agents kiro, max-prompts 3, max-wall-seconds 1200, estimate-credits 2-6, human HS-S2 and HS-S3, depends q43 and q3
    - Test with `fake-kiro` (declares terminal calls only when the client asked): the handlers run no process, the verdicts
    - _Requirements: R14.5_
    - Design: "Group B" (Q4)
    - DoD: P0-D4 (supports)
  - [ ] 12.5 Write the Q11 spike
    - Script: reads `mcpCapabilities` from the `initialize` response, starts `mcp-echo` with a token, passes `mcpServers:[{type:"http", name, url, headers:[{name, value}]}]` in `session/new` (field names confirmed by Q10), asks the agent to call the `echo` tool; `PASS` when `mcp-echo.calls()` shows a call from the agent; branch on `FAIL`: stdio shim `wraith-mcp-stdio`; the entry notes must say whether a `FAIL` may be the echo server's fault (design Risks, MCP http handshake)
    - Metadata: group B, cost low, run-by owner, agents kiro, max-prompts 3, max-wall-seconds 1800, estimate-credits 2-6, human HS-S2 and HS-S3, depends q43 and q3
    - Test with `fake-kiro` calling the echo server: `PASS` with a call, `FAIL` without; the token header is required
    - _Requirements: R14.4, R7.12_
    - Design: "Group B" (Q11)
    - DoD: P0-D4 (supports)
  - [ ] 12.6 Write the Q23 spike and the replay comparison
    - `q23/compare.ts`: pure `compareReplays(a, b)` over the ids of `agent_message_chunk` and `tool_call`; script (`shares: q3`): inside the same invocation as Q3, `loadSession` twice on the Q3 session (same cwd, no prompt) and compare; `PASS` when the ids are equal; branch on `FAIL`: dedupe with `hash(turnIndex, text)`; run alone (without Q3 in the batch) it ends `pending` with the reason "needs q3 session in the same run" (D6)
    - Metadata: group B, cost low, run-by owner, agents kiro, max-prompts 0, max-wall-seconds 1200, estimate-credits 0-2, human HS-S2, depends q3, shares q3
    - Test with `fake-kiro` replaying equal and changed ids: verdicts, and the standalone `pending`
    - _Requirements: R14.7, R12.5_
    - Design: "Group B" (Q23), D6
    - DoD: P0-D4 (supports)
  - [ ] 12.7 Run the group verification (group 12)
    - Run `pnpm -r test`, `pnpm -r build`, `pnpm typecheck`, `pnpm -r --if-present check`, `pnpm lint`, `pnpm check:secrets`, `pnpm check:si` and `pnpm check:spikes`; all clean; no real `kiro-cli` was started
    - List the files this group changed for the commit
    - _Requirements: R14.8_
    - Design: Testing Strategy
    - DoD: P0-D4 (supports)

- [ ] 13. Owner-run Group I and J spike scripts: Q30, Q32, Q31, Q33, Q35 (P0, authoring only)
  - DoD: P0-D4 (supports). Requirements: R15.1 to R15.10, R16.1 to R16.4, R16.8, R7.11, R8.4, R8.7. Design: "Group I", "Group J", "Claude launch options", Properties 18, 22. The tasks WRITE the scripts; RUNNING them is an owner step (HS-S2, HS-S3, HS-S6, HS-S7; see Notes). Every Group I script runs in a Scratch_Workspace inside the Spike_Root, never in one of the owner's projects (R15.1).
  - Files owned: `spike/kiro/{q30,q31,q32}/{<q>.ts,README.md,evidence/.gitkeep}`, `spike/agents/{q33,q35}/{<q>.ts,README.md,evidence/.gitkeep}`, `spike/agents/q33/harness.ts`, `spike/agents/q33/marker.ts`, `spike/lib/claude-driver.ts`, `spike/lib/claude-launch.ts`, `spike/test/support/fake-claude-sdk.ts`, `spike/package.json`, `pnpm-lock.yaml`, `spike/test/support/fake-claude-driver.ts`, `spike/test/spikes/{q30,q31,q32,q33,q35,claude-driver}.test.ts`.
  - [ ] 13.1 Write the Q30 spike
    - Script: new ACP session in a scratch folder, end the process, then check that `session/list` (ACP) or `--list-sessions` from the same cwd lists the session id; `PASS` when the id appears for that cwd; branch on `FAIL`: "rely only on the node's `workspaces` table"
    - Metadata: group I, cost low, run-by owner, agents kiro, max-prompts 2, max-wall-seconds 1200, estimate-credits 2-4, human HS-S2, depends q43
    - Test with `fake-kiro`: verdicts and the scratch cwd being inside the root
    - _Requirements: R15.1, R15.2_
    - Design: "Group I" (Q30)
    - DoD: P0-D4 (supports)
  - [ ] 13.2 Write the Q32 spike
    - Script: always `~/.kiro/agents/wraith-spike-q32.json` (new file only, flag `wx`, recorded in the marker, deleted in cleanup; HS-S6) with a prompt "answer with the word ALPHA when asked your instructions" and read-only pre-approved tools; start `acp --agent wraith-spike-q32`, ask "what are your instructions?", stop, edit the file (prompt now BRAVO), restart with `session/load`, ask again; `PASS` when the new prompt is used and the history is present; when `--agent` is not accepted (Q43 `FAIL`) select the agent after `initialize` and record the difference; branch on `FAIL`: default agent, no pre-approved tools, instructions as a first context block (R15.4, R15.5)
    - Metadata: group I, cost low, run-by owner, agents kiro, max-prompts 4, max-wall-seconds 1800, estimate-credits 4-10, human HS-S2 and HS-S6, depends q43
    - Test with `fake-kiro` and a temp home: the file is created once and deleted, an existing file of the same name is never overwritten, the edit is detected, other files in the folder are untouched
    - _Requirements: R15.4, R15.5, R15.8, R3.7_
    - Design: "Group I" (Q32)
    - DoD: P0-D4 (supports)
  - [ ] 13.3 Write the Q31 spike
    - Script: profile with a write allowlist for the scratch folder (field name taken from Q32 and Q43 evidence, working name until then) while the write tool is NOT pre-approved; the agent is asked to write one file inside and one outside the scratch folder (the outside path is another folder inside the Spike_Root); every permission request goes to the owner, who may veto the inside write at the tap (A5); `PASS` when the outside write is refused or asks; records whether the inside write asked; branch on `FAIL`: "Outside workspace" badge only
    - Metadata: group I, cost low, run-by owner, agents kiro, max-prompts 4, max-wall-seconds 1500, estimate-credits 4-10, human HS-S2 and HS-S3, depends q43 and q32
    - Test with `fake-kiro`: the profile never pre-approves the write tool (`assertSafeProfile`), the verdicts for refused, asked and silently allowed outside writes (the last is `FAIL` and aborts)
    - _Requirements: R15.3, R8.5, R8.7_
    - Design: "Group I" (Q31), A5, Risks (Q31 write allowlist may pre-approve)
    - DoD: P0-D4 (supports)
  - [ ] 13.4 Write the Claude driver port and its fake
    - `lib/claude-driver.ts`: an injected interface `ClaudeDriver` (start session with a `ClaudeLaunchView` that has passed `assertSafeClaudeLaunch`, prompt, permission callback routed through `askOwner` with deny on timeout, `supportedCommands()`, fork offer, close) so the Claude halves of Q33 and Q35 are written and tested without the real SDK; `test/support/fake-claude-driver.ts` records the launch options it receives
    - The real SDK binding is written by task 13.8 (it needs the installed type definitions); until a binding is bound, and when the STOP rule of 13.8 fires, the Claude halves end `pending` with the reason "Claude driver not available", never `FAIL`
    - `test/claude-driver.test.ts`: the options the fake saw pass `assertSafeClaudeLaunch`; an unsafe view is refused before the driver starts; the permission callback denies on timeout
    - _Requirements: R7.11, R15.6, R16.3_
    - Design: "Claude launch options", Risks (Claude half of Q33 and Q35)
    - DoD: P0-D4 (supports)
  - [ ] 13.5 Write the Q33 spike, harness and marker helper
    - `q33/marker.ts`: pure `containsMarker(text, marker)`; `q33/harness.ts`: the two-process harness and a pure parser of `ps -o pid=,ppid=` output proving two independent process trees from the pids the runner started (no `pgrep`, no name-based kill)
    - Script, per agent (Kiro through acp-echo, Claude through the driver port): check a (two processes, two sessions, same scratch folder, 5 overlapping prompts per process with one read and one edit each, 20 minutes, two independent trees), check c (one process, sessions A and B, `loadSession(A)`, prompt, `loadSession(B)`, prompt, five times, switch latency per switch, A never sees B's marker text), check d (whether the agent offers a fork), check b record-only; records whether an `allow_always` that the owner selects by hand in A applies in B and whether it survives `loadSession` (the client only records, R8.4); a `PASS` when all 10 turns complete, no `-32603`, no "active in another process" and two distinct session ids; c `PASS` when A never sees B's text; branch per agent by §19.1 (a passes: process; a fails and c passes: swap; both fail: none), "Native fork" yes or no, and the notification and PHASE-STATUS note of R11.5 when a fails for Claude or Kiro (written by `record`, task 15.1); without a TTY it ends `pending`; it never adds an auto-approve path (OQ-1)
    - Metadata: group I, cost medium, run-by owner, agents kiro and claude, max-prompts 30, max-wall-seconds 7200, estimate-credits 25-75, claude-prompts 25, human HS-S2, HS-S3 and HS-S7, depends q43 and q32, allow-always manual, assumption A1 and A3 Estimates; the runner places it alone on its own budget day (R12.6)
    - Test with `fake-kiro` and the fake driver: verdict and branch mapping for the three seat outcomes, `containsMarker`, the ps-tree parser, `pending` without a TTY, the `allow_always` answer only with `manual` and an owner key
    - _Requirements: R15.6, R15.7, R15.9, R15.10, R8.4, R8.7, R11.5, R12.6_
    - Design: "Group I" (Q33), Properties 16, 22
    - DoD: P0-D4 (supports)
  - [ ] 13.6 Write the Q35 spike
    - Script: Kiro half: scratch workspace with a test skill and test prompt file, `initialize`, `session/new`, log every `available_commands_update`, `session/load`, log again, add a second skill file during the session and record whether an update follows; Claude half through the driver port with `supportedCommands()` and the same safe options as Q33 (if the driver finds no skill with empty setting sources the result is recorded as that observation, never worked around by loading settings); descriptions are untrusted and stored redacted (R16.4); Kiro and Claude results are separate lines of one entry; per agent `PASS` when the list arrives after `session/new` or `session/load` and contains the test skill; branch `bot.commands{source:"acp"}`, else `files`, else `none`; the Claude half runs on the Q33 day and records `versions.claudeAgentSdk` when a driver is bound
    - Metadata: group J, cost low, run-by owner, agents kiro and claude, max-prompts 3, max-wall-seconds 1800, estimate-credits 2-6, claude-prompts 3, human HS-S2 and HS-S7, depends q43
    - Test with `fake-kiro` and the fake driver: branch mapping for the three outcomes, redaction of a description with an imported SI token, the Claude half `pending` without a driver
    - _Requirements: R16.1 to R16.4, R16.8_
    - Design: "Group J" (Q35)
    - DoD: P0-D4 (supports)
  - [ ] 13.8 Install the Claude Agent SDK and bind the driver port (type-level and fake only)
    - Owner exception to R5.8 (RD-11, 2026-11-18): `@anthropic-ai/claude-agent-sdk` has the npm license "SEE LICENSE IN README.md" (Anthropic terms, not permissive). It is allowed ONLY as an exact-pinned devDependency of `@wraith/spike`, never shipped, in no other package
    - Run `pnpm view @anthropic-ai/claude-agent-sdk version license` (read-only), then `pnpm --filter @wraith/spike add -D @anthropic-ai/claude-agent-sdk@<exact version>` (no `^` or `~`); this task owns `spike/package.json` and `pnpm-lock.yaml` in its wave
    - Read the option names from the INSTALLED type definitions (`.d.ts` under `node_modules`), not from memory. Rename `ClaudeLaunchView` and the fields of `assertSafeClaudeLaunch` (setting sources, permission mode, allowed tools, allow rules, settings) to the real names, update `lib/claude-launch.ts`, `test/support/fake-claude-sdk.ts`, `test/support/fake-claude-driver.ts` and their tests; Property 22 and the fake-SDK tests must still pass
    - Bind the `ClaudeDriver` port in `lib/claude-driver.ts` to the SDK so that the binding sets the setting sources to empty and routes every permission request through `askOwner` (deny on timeout, error or reject); record the installed version as `versions.claudeAgentSdk` in the evidence index
    - STOP RULE: if the installed SDK cannot run with zero setting sources, or its option names make "no filesystem settings" impossible, STOP and report to the owner; do not work around it and do not load settings
    - Verification is type-level and with the fake driver only. Do NOT start a real Claude session and make no network call to Claude in this task (the registry read above is the only network use)
    - _Requirements: R5.8, R7.11, R15.6, R16.3_
    - Design: "Claude launch options", Risks (Claude half of Q33 and Q35)
    - DoD: P0-D4 (supports), P0-D1 (supports)
  - [ ] 13.7 Run the group verification (group 13)
    - Run `pnpm -r test`, `pnpm -r build`, `pnpm typecheck`, `pnpm -r --if-present check`, `pnpm lint`, `pnpm check:secrets`, `pnpm check:si` and `pnpm check:spikes`; all clean; no real `kiro-cli` or `claude` was started
    - List the files this group changed for the commit
    - _Requirements: R15.1, R16.3_
    - Design: Testing Strategy
    - DoD: P0-D4 (supports)

- [ ] 14. Checkpoint - All 19 spike scripts written
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 15. RESULTS tooling: the `record` command (P0)
  - DoD: P0-D4 (R6, R11, R17 recording path). Requirements: R6.1, R6.2, R6.6, R6.7, R6.8, R11.1 to R11.6, R11.10, R17.5. Design: "RESULTS tooling" (`pnpm spike record`), D7.
  - Files owned: `spike/lib/record.ts`, `spike/run.ts` (the `record` and `budget` wiring only), `spike/test/{record,runner.integration}.test.ts`.
  - [ ] 15.1 Implement `lib/record.ts`
    - `recordSpike(q, stamp?, io)`: reads `evidence/<stamp>/index.json` (latest by default), builds a `ResultsEntry` (question, experiment with hc, kiro-cli and claude versions, date and runner, result, reason, evidence paths including the named copy when present, branch chosen, affects, notify, open human steps, notes) and calls `upsertEntry` from `tools/lib/spike-results.ts`; a `pending` index becomes a `pending` entry with its reason and is never recorded `FAIL` (R6.6); the 2026-11-05 pre-check text moves to the notes as context only (R6.8)
    - `evaluateBranchEffects(entries)` (pure): Q3 and Q3b both `FAIL` marks the Q3 and Q3b rows "STOP", says "stop P1 work that depends on Kiro approval" and prints a notify line (R11.2); Q3 `FAIL` with Q3b `PASS` selects "approval via `preToolUse` + one-shot grant", says the hook endpoint is added to P1 scope and sets notify (R11.3); Q3 `PASS` selects "approval via ACP `request_permission`" and still records Q3b (R11.4); Q33a `FAIL` for Claude or Kiro records whether Q33c passed (`swap` or `none`), sets notify and prints the P9.17-D1 to D3 copy note (R11.5); other failures (Q4, Q7, Q12, Q13, Q14, Q23, Q30, Q31, Q32) record the branch with no notify unless it changes a DoD (R11.6); each entry lists the later specs and DoD ids whose entry criteria it satisfies (R11.10)
    - `record` edits only `docs/spikes/RESULTS.md`; it never edits `PHASE-STATUS.md` and never runs git (D7); the runner never calls it by itself
    - `test/record.test.ts` on temp copies of a RESULTS fixture: each branch rule above; a pending index; idempotent second record; the named-copy evidence path is listed; an evidence path that does not exist is refused
    - _Requirements: R6.1, R6.2, R6.6, R6.7, R6.8, R11.1 to R11.6, R11.10_
    - Design: "RESULTS tooling" (`record`), D7
    - DoD: P0-D4
  - [ ] 15.2 Wire the `record` and `budget` subcommands into `spike/run.ts`
    - Register `recordSpike` and `budgetCommand` as the `RunIo` handlers of the `record` and `budget` subcommands (no change to the pipeline); `pnpm spike record <q> [<stamp>]` and `pnpm spike budget <subcommand>` work from the root script
    - Append to `test/runner.integration.test.ts`: `record` on a temp repo-like tree with an index from a fake run writes the entry and the table row and leaves other rows byte-identical; `budget authoring 60` and `budget show` change only the temp ledger
    - _Requirements: R6.1, R9.4_
    - Design: "Runner" (`record`, `budget`), D7
    - DoD: P0-D4
  - [ ] 15.3 Run the group verification (group 15)
    - Run `pnpm -r test`, `pnpm -r build`, `pnpm typecheck`, `pnpm -r --if-present check`, `pnpm lint`, `pnpm check:secrets`, `pnpm check:si` and `pnpm check:spikes`; all clean; confirm `docs/spikes/RESULTS.md` and `docs/PHASE-STATUS.md` are unchanged by this group
    - List the files this group changed for the commit
    - _Requirements: R6.1_
    - Design: Testing Strategy
    - DoD: P0-D4 (supports)

- [ ] 16. Loop-run spike executions: stages 1 and 2 (P0, CONDITIONAL; the only tasks that run real tools)
  - DoD: P0-D4 (these tasks produce the RESULTS entries of Q2, Q13, Q12, Q1, Q6, Q7, Q43). Requirements: R12.1 to R12.3, R13.1 to R13.10, R14.6, R16.5 to R16.9, R6.1, R9.1, R10.3, R11.7, R17.7. Design: "Group A", "Group B" (Q43, Q7), "Ordering" items 3 and 4.
  - Files owned: `spike/hc/<q>/evidence/<stamp>/*` and `spike/kiro/<q>/evidence/<stamp>/*` for the spike each task runs, `spike/hc/schema.json` (Q2), `docs/spikes/RESULTS.md` (entries and rows of the spike each task records, one task per wave), `spike/budget-ledger.json` (task 16.7 only).
  - Condition for the whole group: groups 1 to 15 are done and committed, `hc --version` reports 0.1.18 or more, and the run is a non-interactive loop run (no TTY, no tap). These tasks never log in or out, never lock a screen, never click in Herdr.app and never run `kiro-cli login`, `kiro-cli logout` or an equivalent for Claude (R10.3).
  - STOP rules, valid for every task of this group: (1) a preflight failure stops the group and notifies the owner; the task does not retry or loosen any check (exit 20 means the environment may point at the Default_Core: stop condition of R11.7); (2) any secret finding in an evidence file or in the pre-commit or tree scan stops the group (stop condition 8: stop, revoke, report); (3) a budget-gate refusal stops the task (exit 21); (4) a cleanup that cannot confirm the Test_Core stopped (exit 30) stops the group and leaves the root for the owner; (5) if Q3 and Q3b both end `FAIL` (owner-run, later) the loop STOPS P1 work and notifies the owner (Notes). A spike that cannot run (missing tool, missing login) stays `pending` with the reason and is never recorded `FAIL`.
  - [ ] 16.1 Run Q2 (conditional)
    - Run `pnpm spike q2`; on exit 0 run `pnpm spike record q2`; confirm `spike/hc/q2/evidence/<stamp>/index.json`, `spike/hc/schema.json` (when `PASS` or `PARTIAL`) and the new entry; HS-S5 parts stay "unobserved"; run `pnpm check:spikes` and `pnpm check:secrets`
    - _Requirements: R13.1, R13.2, R12.1_
    - Design: "Group A" (Q2)
    - DoD: P0-D4
  - [ ] 16.2 Run Q13 (conditional)
    - Run `pnpm spike q13` after 16.1 (it reads the Q2 schema evidence); then `pnpm spike record q13`; run `pnpm check:spikes` and `pnpm check:secrets`
    - _Requirements: R13.10, R12.1_
    - Design: "Group A" (Q13)
    - DoD: P0-D4
  - [ ] 16.3 Run Q12 (conditional)
    - Run `pnpm spike q12`, then `pnpm spike record q12`; the expected result is `FAIL` with the branch "drop `herdr-guard`, keep the limitation in §12", which is a valid answer; run `pnpm check:spikes` and `pnpm check:secrets`
    - _Requirements: R13.9, R12.1_
    - Design: "Group A" (Q12)
    - DoD: P0-D4
  - [ ] 16.4 Run Q1 (conditional, about 10 minutes)
    - Run `pnpm spike q1` (60 s baseline, 5 minutes of `terminal.read` every 250 ms, `top -s 1` when `htop` is absent; the substitute is recorded), then `pnpm spike record q1`; run `pnpm check:spikes` and `pnpm check:secrets`
    - _Requirements: R13.3, R13.4, R13.5, R12.1_
    - Design: "Group A" (Q1), D17
    - DoD: P0-D4
  - [ ] 16.5 Run Q6 (conditional)
    - Run `pnpm spike q6` last of stage 1 (it restarts only the Test_Core of `wsp-q6`), then `pnpm spike record q6`; the Herdr.app close-button reason stays "unobserved" (HS-S5); run `pnpm check:spikes` and `pnpm check:secrets`
    - _Requirements: R13.6, R13.7, R13.8, R12.1_
    - Design: "Group A" (Q6)
    - DoD: P0-D4
  - [ ] 16.6 Run Q7 (conditional; help text only, no model prompt, no credits)
    - Run `pnpm spike q7`, then `pnpm spike record q7`. This calls `kiro-cli chat --list-sessions --help` only (confirmed by the owner, 2026-11-18): no model call and no login use. It is still skipped if `kiro-cli` is not on PATH (the entry stays `pending` with the reason); run `pnpm check:spikes` and `pnpm check:secrets`
    - _Requirements: R14.6_
    - Design: "Group B" (Q7)
    - DoD: P0-D4
  - [ ] 16.7 Run Q43 (conditional on the owner's budget OK and HS-S2; the only loop task that starts an agent)
    - Conditions, all required: the owner has confirmed `kiro-cli` is logged in (HS-S2), and the owner has OK'd the day's budget in `spike/budget-ledger.json` (an authoring Estimate and the Q43 reservation of 3 credits at most; the loop cannot measure credits, HS-S8). If either is missing the task is skipped and Q43 stays `pending` with that reason
    - Steps: run `pnpm spike budget authoring <hi>` with the loop's own labelled Estimate for the day, run `pnpm spike q43` (at most one prompt, every permission request answered `reject_once`), then `pnpm spike record q43`; print the HS-S8 request (read the dashboard before and after, enter the actual with `pnpm spike budget actual <batch> <n|skip>`); run `pnpm check:spikes` and `pnpm check:secrets`. Never start another Agent_Spike in the same task
    - _Requirements: R16.5, R16.6, R16.7, R16.9, R9.1, R9.4, R9.6, R10.3_
    - Design: "Group B" (Q43), "Budget guard"
    - DoD: P0-D4
  - [ ] 16.8 Run the group verification (group 16)
    - Run `pnpm check:spikes`, `pnpm check:secrets`, `pnpm lint`, `pnpm -r test`; confirm `git status` lists only evidence folders under `spike/`, `spike/hc/schema.json`, `spike/budget-ledger.json` and `docs/spikes/RESULTS.md`; confirm no `/tmp/hcw` root of these runs remains and no `wraith-spike-*.json` file remains in `~/.kiro/agents/`
    - List the files for the commit (evidence is committed only after the redaction and scan passed)
    - _Requirements: R3.1, R3.7, R7.7_
    - Design: "Ordering" items 3 and 4
    - DoD: P0-D4 (supports)

- [ ] 17. Records and decisions: THIRD_PARTY, required suites, structure test, DECISIONS-PENDING, P0-D4 gate (P0)
  - DoD: P0-D4 (the gate), P0-D1 (supports: required suites and the SDK record). Requirements: R5.7, R5.8, R17.1 to R17.7, R11.8, R14.5 of the project decision-log convention. Design: "Mapping to Definition of Done (P0-D4) and traceability", "Design choices confirmed by owner".
  - Files owned: `docs/THIRD_PARTY.md`, `tools/required-suites.json`, `spike/test/scripts.structure.test.ts`, `docs/DECISIONS-PENDING.md`, `docs/PHASE-STATUS.md` (row P0-D4, a P1 STOP item and the P9.17 copy only when their records exist).
  - [ ] 17.1 Record the ACP SDK and the Claude Agent SDK in `docs/THIRD_PARTY.md`
    - Read the license text of the installed `@agentclientprotocol/sdk` (its `LICENSE` in `node_modules`) and add one row in the existing table format: package, exact version installed by 8.1, license, reason (acp-echo SDK variant for Q10), "dev dependency of `@wraith/spike` only, not shipped"; if task 8.1 stopped, skip and say so
    - Add a second row for `@anthropic-ai/claude-agent-sdk` (installed by 13.8; skip and say so if 13.8 stopped): name, exact version installed, license text `Anthropic terms (not permissive); owner exception 2026-11-18`, reason (Claude halves of Q33 and Q35), "dev dependency of `@wraith/spike` only, not shipped"
    - _Requirements: R5.8_
    - Design: "Module layout" (edited files), Risks (Claude half: license read first)
    - DoD: P0-D4 (supports), P0-D1 (supports)
  - [ ] 17.2 Add the spike suites to `tools/required-suites.json`
    - Add one entry per `spike/test/*.test.ts` file created by groups 1 to 15 and 17.3 (`package: spike`, `file`, `projects: ["node"]`, `minTests` set to the exact count seen in the `pnpm test:reports` output) so an empty or skipped run fails `pnpm check:suites`
    - _Requirements: R2.12, R1.10_
    - Design: Testing Strategy ("These suites are added to `tools/required-suites.json`")
    - DoD: P0-D4 (supports), P0-D1 (supports)
  - [ ] 17.3 Write the structure test over all 19 scripts
    - `spike/test/scripts.structure.test.ts` (reads files with `node:fs`; test only): for every id of `OWNER_LIST` the script, `README.md` (at most 40 lines) and `evidence/` exist at the `locate(id)` paths and the metadata block parses; no `spike/` file spells an SI token (imported set) or contains a direct `hc`, `herdr-core`, `pkill` or `killall` spawn outside `lib/hc.ts`; no `package.json` or source file under `apps/` or `packages/` references `@wraith/spike` or imports from `spike/` (R5.7); `.gitignore` lists neither `spike/` nor `docs/spikes/` (R7.7); the owner-run scripts have `run-by: owner` and the loop-run ones `run-by: loop`; `q33` has `allow-always: manual` and every other script `never`
    - _Requirements: R4.2, R5.1, R5.2, R5.7, R7.7, R7.9, R10.1_
    - Design: Testing Strategy, "Dependency rules"
    - DoD: P0-D4 (supports)
  - [ ] 17.4 Record agent-made and owner decisions in `docs/DECISIONS-PENDING.md`
    - Add one row each (id, date, question, default taken, impact if changed, resolved): the owner's design choices A1 to A7, D14 replaced (`check:spikes` in CI, S-ops files edited), the Claude launch with empty setting sources, Q14 Observe_Mode limited to `server status`, and any agent decision taken during this plan: `readHcVersion` outside `decideHc` (2.13), the evidence `finish` input type (3.4), the Claude driver port (13.4), Q7 classified as a loop run that calls only `--help` (16.6); skip a row whose decision was not taken; also add the row `S-spikes-1` (owner, 2026-11-18, question: allow `@anthropic-ai/claude-agent-sdk` as an exact-pinned devDependency of `@wraith/spike` only despite its non-permissive license; default taken: yes, never shipped; impact if changed: the Claude halves of Q33 and Q35 cannot be bound; resolved: yes) when task 13.8 ran
    - Edit only the new rows; never reopen a locked decision (R11.8)
    - _Requirements: R11.8, R14.5 of the project decision-log convention_
    - Design: "Design choices confirmed by owner", D14
    - DoD: P0-D4 (supports)
  - [ ] 17.5 Evaluate the P0-D4 gate and update `docs/PHASE-STATUS.md` (conditional on the recorded entries)
    - Run `pnpm check:spikes --gate`. The P0-D4 row becomes `pass` ONLY when it exits 0 (each of the 18 ids has an entry `PASS|FAIL|PARTIAL` with existing evidence; Q14 may be `PARTIAL`; no other id is `pending`); the evidence cell cites `docs/spikes/RESULTS.md`, the counts by Result_Value, the hc, kiro-cli and Claude Code versions of the runs and the date, from the gate output (R17.4)
    - If it exits 1 because owner-run spikes are not recorded yet: leave the row `todo` and add one short note line listing the pending ids; if the only open items are Human_Step parts of `PARTIAL` spikes and no loop work remains, set `blocked-human` with the open HS ids (R17.3); never set `pass` by hand and never from the 2026-11-05 pre-check notes (R17.7)
    - When the records exist, in the same commit as the RESULTS entry: add the STOP of Q3 and Q3b as a separate P1 item (the P0-D4 row still turns `pass` for the answer, R17.6); add the hook endpoint to P1 scope when Q3 `FAIL` and Q3b `PASS` (R11.3); copy P9.17-D1 to D3 into P2 when Q33a fails for Claude or Kiro (R11.5)
    - Edit only the P0-D4 row, those items and one note line
    - _Requirements: R17.1 to R17.7, R11.2, R11.3, R11.5_
    - Design: "Mapping to Definition of Done (P0-D4) and traceability"
    - DoD: P0-D4
  - [ ] 17.6 Run the final verification
    - Run `pnpm -r test`, `pnpm -r build`, `pnpm typecheck`, `pnpm -r --if-present check`, `pnpm lint`, `pnpm test:reports` and `pnpm check:platform`, `pnpm check:secrets`, `pnpm check:pins`, `pnpm check:suites`, `pnpm check:si`, `pnpm check:spikes`, then `pnpm verify:local`; all clean; confirm `git status` lists only files owned by this plan; list the files for the final local commit; do not push
    - _Requirements: R7.7, R7.9, R17.5_
    - Design: "Mapping to Definition of Done (P0-D4) and traceability"
    - DoD: P0-D4, P0-D1 (supports)

- [ ] 18. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- No task is marked optional (`*`). The design marks none.
- Blocked or conditional tasks:
  - Group 16 (tasks 16.1 to 16.8) is CONDITIONAL on groups 1 to 15 being done and on a working `hc` of version 0.1.18 or more. Stop rules: preflight failure, any secret finding, a budget refusal, a cleanup that cannot confirm the stop, and (for the owner-run results recorded later) Q3 and Q3b both `FAIL`, which stops P1 work that depends on Kiro approval and notifies the owner (R11.2). A spike that cannot run stays `pending` with the reason and is never recorded `FAIL` (R6.6).
  - Task 16.7 (Q43) is the ONLY loop task that starts an agent. It is conditional on the owner's confirmation that `kiro-cli` is logged in (HS-S2) and on the owner's OK of the day's budget in the ledger; it sends at most one prompt and answers every permission request `reject_once`. Task 16.6 (Q7) runs `kiro-cli chat --list-sessions --help` only (confirmed by the owner, 2026-11-18): no model call, no login, zero credits. Every other task and every test uses fakes and never runs `kiro-cli`, `claude` or a real core; task 13.8 installs the SDK and reads only its type definitions.
  - Tasks 8.1, 8.4, 12.3 and 17.1 depend on the ACP SDK license. If task 8.1 finds a non-permissive license or no package, it stops and reports; 8.4 and 17.1 are skipped, Q10 ends `pending` with the reason, and the rest of the plan continues.
  - Tasks 13.4 to 13.6 (Claude halves of Q33 and Q35) are written against an injected driver port, and task 13.8 binds that port to `@anthropic-ai/claude-agent-sdk` (owner exception RD-11: not a permissive license, exact-pinned devDependency of `@wraith/spike` only, never shipped). The owner's own Claude login is allowed for personal local spikes (OQ-2, HS-S7), so the Claude halves are not blocked on any license or auth decision. Task 13.8 is type-level and fake-driver only: it starts no real Claude session. STOP rule of 13.8: if the installed SDK cannot run with zero setting sources, stop and report to the owner; the Claude halves then end `pending` and are never run with settings loaded.
  - Task 17.5 is conditional on the owner-run records. It may end with the row `todo` or `blocked-human` and a note; that is a complete outcome for the loop. P0-D4 becomes `pass` only through `pnpm check:spikes --gate`.
  - Task 17.4 rows are conditional on the agent decisions actually taken (skip a row otherwise).
- Human steps, not tasks (nothing in this plan performs them; R10.3): HS-S1 optionally install `htop` for Q1 (else `top -s 1`, OQ-7); HS-S2 confirm `kiro-cli` is logged in (Pro); HS-S3 run the owner-run spikes from an interactive terminal and be present for one key press per permission request (about 4 to 8 for Q3, Q3b, Q10, Q4, Q11; about 20 per agent for Q33; no exemption, OQ-1); HS-S4 Q14 logout and login on this Mac, Linux unit, reboot, reboot with nobody logged in, paste the observer output; HS-S5 look at Herdr.app (Q2 visibility, Q6 close-button reason, PATH of a core started by the Herdr Core app); HS-S6 allow one new `~/.kiro/agents/wraith-spike-<q>.json` per run (always Q32; Q43 and others only if Kiro does not read the scratch `.kiro/agents/`); HS-S7 the recorded OQ-2 answer for the Claude halves of Q33 and Q35; HS-S8 read the Kiro credits on the dashboard before and after each Agent_Spike batch and enter the actual (`pnpm spike budget actual <batch> <n|skip>`).
- Owner-run spike RUNS are human steps, never tasks. After group 14 the owner runs, from an interactive terminal: stage 3 `pnpm spike q3 q3b q10 q4 q11 q23` (one batch, one Kiro session shared by Q3 and Q23), stage 4 `pnpm spike q30 q32 q31 q35` (Kiro part), stage 5 `pnpm spike q33` on its own budget day (then the Claude part of `q35`), and Q14 with `pnpm spike q14 --observe-default` whenever ready. After each run the loop calls `pnpm spike record <q>` and task 17.5 is evaluated again. A run without a TTY ends `pending` with "needs interactive terminal".
- Budget: the daily 200-credit rule (stop condition 6) counts authoring and runs together (R9.11). The authoring estimate is 145 to 258 credits (typical about 190) over at least two days; the run estimates are about 45 to 140 (Q33 is 25 to 75 of it). All are Estimates (assumptions A1 and A5); the loop cannot measure credits, so the owner enters the real dashboard value after stage 0 and after each batch (HS-S8) and the tables are recalibrated. The spike ceiling is 100 credits a day (owner value capped at 200); Q33 runs on its own day. Claude quota is counted in prompts per day (default 40). The loop stops the day's work when its own authoring Estimate plus any run use would pass 200 (`pnpm spike budget authoring <hi>` records it once task 6.3 exists), and stops the remaining Agent_Spikes of a day when an owner-entered actual is more than 50 percent over its estimate.
- Owner decisions carried (2026-11-18): A1 `@wraith/spike` has `test` and `check` scripts only; A2 only `hc` and Test_Core children get the XDG overrides; A3 two budget gates; A4 named files are redacted copies written on `PASS` or `PARTIAL`; A5 Q31 never pre-approves the write tool; A6 the session is `wsp-<first id>` of a batch; A7 no `HC_CONFIG`-style override in any child; D14 `check:spikes` is a CI step, and the S-ops files `ci.yml`, `tools/test/ci-workflow.test.ts`, root `package.json` and `tools/required-suites.json` are edited by this plan (4.8, 4.9, 7.7, 17.2).
- Hooks: the secret-scan and SI hooks block writes that contain secret-shaped or SI-token strings. Secret samples in tests are assembled from fragments; SI tokens are imported from `packages/protocol/src/unsafe.ts` through `tools/lib/unsafe-tokens.ts`. `spike/` is exempt only from the product-code scanners (`check:platform`, the SI product-code scan), not from the token-spelling rule or the secret scan, so `spike/` and `docs/spikes/` are never added to `.gitignore`.
- Files outside `spike/` and `tools/` touched by this plan: `pnpm-workspace.yaml`, `pnpm-lock.yaml`, root `package.json`, `.github/workflows/ci.yml`, `tools/test/ci-workflow.test.ts`, `tools/required-suites.json`, `docs/THIRD_PARTY.md`, `docs/spikes/RESULTS.md` (by `record`), `docs/PHASE-STATUS.md` (row P0-D4 and the items of 17.5 only) and `docs/DECISIONS-PENDING.md` (17.4). No file of `apps/` or `packages/` is edited. `requirements.md`, `design.md` and `docs/architecture.md` are not edited (a result that changes §4.4/§5 argv is recorded as a proposal).
- Dependency versions pinned at install time: `vitest` 5.0.5, `fast-check` 4.10.2, `@types/node` 22.20.5 (as the other packages), `@agentclientprotocol/sdk` at one exact version chosen in task 8.1 after its license is read, and `@anthropic-ai/claude-agent-sdk` at one exact version chosen in task 13.8 (owner exception RD-11, dev dependency of `@wraith/spike` only).

## DoD Coverage Table

| DoD id | Tasks | Outside this spec |
|---|---|---|
| P0-D4 | 1.1 to 1.4, 2.1 to 2.20, 3.1 to 3.6, 4.1 to 4.10, 6.1 to 6.10, 7.1 to 7.8, 8.1 to 8.9, 10.1 to 10.8, 11.1 to 11.3, 12.1 to 12.7, 13.1 to 13.8, 15.1 to 15.3, 16.1 to 16.8, 17.1 to 17.6 (all "supports" except the gate task 17.5, which is the only task that can set the row `pass`, and only through `--gate`) | The owner-run spike runs (HS-S2 to HS-S8: Q3, Q3b, Q10, Q4, Q11, Q23, Q30, Q32, Q31, Q33, Q35 and Q14) and the human OK of the budget; the row stays `todo` or `blocked-human` until their entries exist |
| P0-D1 | 1.1, 1.4, 4.8, 4.9, 4.10, 13.8, 17.1, 17.2, 17.6 (supports: lockfile, new CI step `check:spikes`, required suites) | The GitHub run on both runners (S-ops HS-1 to HS-5, human-gated); not changed here |
| P0-D6, P0-D7 | none changed | SI hooks and the platform check belong to S-ops-packaging; `spike/` is exempt only from product-code scanners, and the token-spelling rule is enforced for it by 4.6 and 17.3 |
| This spec's Properties 1 to 22 | 2.2 (Property 1), 2.6 (2), 2.7 (3), 2.8 (4), 2.9 (5), 2.10 (6), 2.14 (7), 2.17 (8), 2.18 (9), 2.12 (10), 3.2 (11), 3.3 (12), 4.2 (13), 4.4 (14), 6.2 (15), 6.5 (16), 8.6 (17), 6.7 (18), 7.2 (19), 4.5 (20), 10.6 (21), 6.9 (22) | Nothing else; these are this spec's own properties |

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["1.4"] },
    { "id": 3, "tasks": ["2.1", "2.3", "2.11"] },
    { "id": 4, "tasks": ["2.2", "2.4", "2.12", "2.13"] },
    { "id": 5, "tasks": ["2.5", "2.6", "2.10", "2.14", "2.15"] },
    { "id": 6, "tasks": ["2.7", "2.16", "2.17", "2.19"] },
    { "id": 7, "tasks": ["2.8", "2.18"] },
    { "id": 8, "tasks": ["2.9"] },
    { "id": 9, "tasks": ["2.20"] },
    { "id": 10, "tasks": ["3.1"] },
    { "id": 11, "tasks": ["3.2", "3.4"] },
    { "id": 12, "tasks": ["3.3", "3.5"] },
    { "id": 13, "tasks": ["3.6"] },
    { "id": 14, "tasks": ["4.1", "4.3"] },
    { "id": 15, "tasks": ["4.2", "4.4", "4.6"] },
    { "id": 16, "tasks": ["4.5", "4.7"] },
    { "id": 17, "tasks": ["4.8"] },
    { "id": 18, "tasks": ["4.9"] },
    { "id": 19, "tasks": ["4.10"] },
    { "id": 20, "tasks": ["6.1", "6.4", "6.6", "6.8"] },
    { "id": 21, "tasks": ["6.2", "6.3", "6.5", "6.7", "6.9"] },
    { "id": 22, "tasks": ["6.10"] },
    { "id": 23, "tasks": ["7.1", "7.3", "7.5"] },
    { "id": 24, "tasks": ["7.2", "7.4"] },
    { "id": 25, "tasks": ["7.6", "7.7"] },
    { "id": 26, "tasks": ["7.8"] },
    { "id": 27, "tasks": ["8.1", "8.2", "8.5", "8.7"] },
    { "id": 28, "tasks": ["8.3", "8.6"] },
    { "id": 29, "tasks": ["8.4", "8.8"] },
    { "id": 30, "tasks": ["8.9"] },
    { "id": 31, "tasks": ["10.1", "10.2", "10.3", "10.4", "10.5", "10.7"] },
    { "id": 32, "tasks": ["10.6"] },
    { "id": 33, "tasks": ["10.8"] },
    { "id": 34, "tasks": ["11.1", "11.2"] },
    { "id": 35, "tasks": ["11.3"] },
    { "id": 36, "tasks": ["12.1"] },
    { "id": 37, "tasks": ["12.2", "12.3", "12.4", "12.5", "12.6"] },
    { "id": 38, "tasks": ["12.7"] },
    { "id": 39, "tasks": ["13.1", "13.2", "13.3", "13.4"] },
    { "id": 40, "tasks": ["13.8"] },
    { "id": 41, "tasks": ["13.5", "13.6"] },
    { "id": 42, "tasks": ["13.7"] },
    { "id": 43, "tasks": ["15.1"] },
    { "id": 44, "tasks": ["15.2"] },
    { "id": 45, "tasks": ["15.3"] },
    { "id": 46, "tasks": ["16.1"] },
    { "id": 47, "tasks": ["16.2"] },
    { "id": 48, "tasks": ["16.3"] },
    { "id": 49, "tasks": ["16.4"] },
    { "id": 50, "tasks": ["16.5"] },
    { "id": 51, "tasks": ["16.6"] },
    { "id": 52, "tasks": ["16.7"] },
    { "id": 53, "tasks": ["16.8"] },
    { "id": 54, "tasks": ["17.1", "17.3", "17.4"] },
    { "id": 55, "tasks": ["17.2"] },
    { "id": 56, "tasks": ["17.5"] },
    { "id": 57, "tasks": ["17.6"] }
  ]
}
```
