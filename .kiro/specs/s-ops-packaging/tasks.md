# Implementation Plan: S-ops-packaging (P0 part)

## Overview

This plan builds the P0-tagged part of S-ops-packaging in TypeScript, following design.md: the `packages/platform` skeleton (R9, R8.1, R8.2, R8.4), the `@wraith/tools` workspace package with the five check scripts, the two SI hook scanners, the Vitest reporter and shared helpers (D1), the Platform_Check (R5), the Secret_Scan with its pre-commit script and Kiro hook file (R3), the Pin_Check and `.github/workflows/ci.yml` (R2, R10), the Suites_Check with `required-suites.json` (R11), the SI hooks `no-trust-all` and `no-auto-approve` (R12), the Kiro hook smoke test, and the P0-D1, P0-D6 and P0-D7 evidence rules (R13). Requirement ids are R-numbers and criteria of requirements.md; "Design" names a section, decision (D1 to D13), owner choice (O1 to O5) or Correctness Property of design.md. Neither document is edited by this plan.

Later-phase requirements get no tasks: R1, R4, R6, R7, R14, R15, R2.15, R5.4, R8.3, R8.5 to R8.7.

Order of the work follows the design's "Order of the work", with one change. The reporter and Suites_Check group (6) comes before the Pin_Check and `ci.yml` group (7), because the `ci.yml` task must run the exact CI test command locally, and that command loads `tools/vitest-project-reporter.ts`. The SI hook group (9) is last among component groups and is BLOCKED until the S-protocol commit with `unsafe.ts` exists (R12.10). No earlier group depends on it, and no earlier group verification runs anything from it.

Conventions:
- Every Correctness Property of design.md (1 to 10) is a required property sub-task (no `*`), cites its property number and requirement ids, runs through the `pbt(...)` helper of the package's own `test/config.ts` with the local constant `OPS_PBT_RUNS = 500`, and carries the tag `Feature: s-ops-packaging, Property <n>: <title>`. `tools` cannot import `pbt()` or `CRYPTO_PBT_RUNS` from `packages/crypto` or `PBT_MIN_RUNS` from protocol: `tools/test/config.ts` defines `OPS_PBT_RUNS` and `pbt(...)`, and `packages/platform/test/config.ts` carries its own copy of the same two lines (design: Testing Strategy, Conventions; no cross-package test import).
- No sub-task is marked optional (`*`): the design marks no task as optional. Every example, scan and structure test enforces a requirement or a design rule.
- Test files (`*.test.ts`) export nothing (Biome `noExportsInTest`); shared test code lives in `tools/test/support/*.ts` and `test/config.ts`.
- Samples of secrets and of unsafe tokens are assembled at test time from fragment arrays joined in the test (`tools/test/support/samples.ts`). The only exception is the unsafe-token list, which tests import from `unsafe.ts` (`samples`) and never spell. No committed file spells a complete sample (R3.7, R12.8). Files written by a test live in `mkdtemp(os.tmpdir())` folders removed in `finally`.
- Git inside tests uses `execFileSync("git", [...argv])` with argv arrays, identity given with `-c`, and `GIT_CONFIG_GLOBAL` and `GIT_CONFIG_SYSTEM` pointed at `/dev/null`. The pre-commit test passes `-c core.hooksPath=<absolute path>` on the command line only. No task, script or test runs `git config`, `git push`, or `gh repo create`, or writes any git configuration (R3.20, R13.4).
- Shell commands in tasks are written in full as `pnpm ...` (pnpm 9.15.0 is installed globally on the dev machine; check with `pnpm --version`). No shell variables are used in task text.
- Dependencies are pinned at install time with exact versions, no `^` or `~`: `vitest` 5.0.5, `fast-check` 4.10.2 and `@types/node` 22.20.5 as the other packages use them; `yaml` pinned to one exact version chosen at install time. Installing from the npm registry is allowed. Nothing else needs network, a human, money or publishing. The only other network use is read-only `git ls-remote --tags` in task 7.3.
- Each group lists the files it owns (for the per-group local commit by the orchestrating loop, listing files explicitly with `git add <file>`) and ends with a verification sub-task that runs `pnpm -r test`, `pnpm -r build`, `pnpm typecheck`, the package `check` scripts and Biome (`pnpm lint`), all clean, and lists the files for the commit. Commits never push.
- Shared files have one owning task per wave: `package.json` (root) and `tsconfig.json` (root) are owned by 1.8; `pnpm-workspace.yaml` by 1.6; `pnpm-lock.yaml` by the install tasks (1.1, 1.6); `docs/PHASE-STATUS.md` by 12.1 to 12.3 only; `tools/lib/hook-stdin.ts` and `tools/secret-scan.ts` by 4.6 and 4.7; `tools/test/hook-files.test.ts` by 4.11 and 9.7.
- Every task carries a `DoD:` line mapping it to the P0 DoD ids of docs/architecture.md §18.1. P0-D1 is "supports" until the GitHub run is seen (human-gated). The P0-D2 and P0-D3 rows are not changed by this plan.

## Tasks

- [x] 1. `packages/platform`, `tools` scaffold and root wiring (P0)
  - DoD: P0-D7 (supports: the platform package and its exemption), P0-D1 (supports: the `tools` and `platform` suites join `pnpm -r test`). Requirements: R9, R8.1, R8.2, R8.4, R5.3, R2.16 (scaffold only). Design: "Module layout", "Dependency rules", "Build, resolution and ordering", "`packages/platform`", D1, D11, O1, O3.
  - Files owned: `packages/platform/{package.json,tsconfig.json,vitest.config.ts,README.md}`, `packages/platform/src/{index,platform,errors,select,darwin,linux,win32}.ts`, `packages/platform/test/{config,select,structure}.test.ts` (`config.ts` is a support file), `tools/{package.json,tsconfig.json,vitest.config.ts,README.md}`, `tools/lib/{finding,mask,walk}.ts`, `tools/test/config.ts`, `tools/test/lib.test.ts`, root `package.json`, `pnpm-workspace.yaml`, root `tsconfig.json`, `biome.json`, `.gitignore`, `pnpm-lock.yaml`, `docs/THIRD_PARTY.md`.
  - [x] 1.1 Create the `packages/platform` package files and install
    - `package.json`: name `@wraith/platform`, `private`, `type: module`, `exports` `"."` with `types` and `default` into `dist`, scripts `build` (`tsc -p tsconfig.json`), `test` (`vitest run`), `check` (`tsc -p tsconfig.json --noEmit`); no `dependencies` key entries and no workspace dependency (R9.7); `devDependencies`: `@types/node` 22.20.5, `vitest` 5.0.5, `fast-check` 4.10.2 (exact)
    - `tsconfig.json` extends the base with `composite`, `rootDir: src`, `outDir: dist`, `lib: ["ES2022"]`, `types: ["node"]`, `include: ["src"]`; `vitest.config.ts` with one `node` project (`include: ["test/**/*.test.ts"]`, `passWithNoTests` off)
    - `README.md`: states the package is Node-only (OQ-18), lists the six future call groups of §4.10 (local IPC with the 0600 file and 0700 folder checks, secret-file creation with mode 0600 and the mode check before reading, login environment capture and finding a command on PATH, the service unit, process control with signals, killing a process tree and the sprite's pane-lost signals and exit 75, paths and opening a URL) as P1 contents (R9.5), and says only `apps/node`, `apps/sprite` and `apps/relay-node` may import it (§4.10)
    - Run `pnpm install` so the lockfile is updated; record the installed versions
    - _Requirements: R9.1, R9.2, R9.5, R9.6, R9.7_
    - Design: "`packages/platform`" (package.json bullet)
    - DoD: P0-D7 (supports), P0-D1 (supports)
  - [x] 1.2 Write the platform sources
    - `errors.ts`: `ProgrammerError` with `reason: "unsupported_platform"` and a sanitised `platform` field (`[A-Za-z0-9_-]{1,32}`, otherwise `<invalid>`); message `wraith-platform: unsupported platform <sanitised value>`; no import from `@wraith/crypto` (D11)
    - `platform.ts`: `PlatformId`, `PlatformBase`, `DarwinPlatform`, `LinuxPlatform` (`isWsl()`), `Win32Platform` (`notice`, `exitCode: 1`), `Platform`; `win32.ts`: `WSL2_DOCS_URL = "docs/wsl2.md"` and `WIN32_NOTICE`; `darwin.ts`, `linux.ts` (`isWsl()` returns `false` in P0, R9.10), `win32.ts`: frozen module-level adapter objects; `select.ts`: `selectPlatform(platform: string = process.platform)` returns the adapter with that id or throws `ProgrammerError`; `index.ts` exports the types, `selectPlatform`, the three adapters, `WIN32_NOTICE`, `WSL2_DOCS_URL` and `ProgrammerError`
    - `process.platform` appears only in this package, in the default parameter of `select.ts` (the exempt folder, R9.9)
    - _Requirements: R9.3, R9.4, R9.10, R8.1, R8.2, R8.4_
    - Design: "`packages/platform`" (interfaces, bullets)
    - DoD: P0-D7 (supports)
  - [x] 1.3 Write the platform test config and the example tests for the selector
    - `test/config.ts` (support file): `OPS_PBT_RUNS = 500` and `pbt(...)` wrapping `fc.assert`, defaulting `numRuns` to the constant and refusing a lower value; its own copy, imported by nothing outside this package
    - `test/select.test.ts`: `darwin`, `linux`, `win32` return the adapter with that id; `freebsd` throws `ProgrammerError` with reason `unsupported_platform`; `win32` exposes `WIN32_NOTICE` (which names `WSL2_DOCS_URL`) and exit code 1; `isWsl()` returns `false` and never throws
    - _Requirements: R9.3, R9.4, R8.2, R8.4, R9.10_
    - Design: "`packages/platform`", Testing Strategy (Conventions)
    - DoD: P0-D7 (supports)
  - [x] 1.4 Write the property test for the platform selector
    - **Property 8: The Platform_Selector is total and exact**
    - Append to `test/select.test.ts`, through `pbt(...)`, tag `Feature: s-ops-packaging, Property 8: The Platform_Selector is total and exact`; generators: any string (including unicode, long strings, `darwin`-prefixed strings) and the three valid ids; assert the result id or the `ProgrammerError` whose message contains only the sanitised string
    - **Validates: Requirements 8.2, 8.4, 9.3, 9.4, 9.10**
    - Design: Property 8
    - DoD: P0-D7 (supports)
  - [x] 1.5 Write the platform structure test
    - `test/structure.test.ts` (reads files with `node:fs`; test only): README contains the six call groups of R9.5; `package.json` has no `dependencies` and no `workspace:` value in any dependency field; no package other than `apps/node`, `apps/sprite` and `apps/relay-node` lists `@wraith/platform` in a dependency field or imports it in a source file (in particular `relay-core`, `protocol`, `crypto`, `ui-kit` and the web and Worker apps), scanning every `package.json` and `src/**` of `apps/` and `packages/`; the root `tsconfig.json` references `./packages/platform` (checked after 1.8)
    - _Requirements: R9.2, R9.5, R9.7, R9.8_
    - Design: Testing Strategy (`structure.test.ts`), "Dependency rules"
    - DoD: P0-D7 (supports), P0-D1 (supports)
  - [x] 1.6 Create the `tools` workspace package scaffold and pin `yaml`
    - Add `tools` to `pnpm-workspace.yaml` (O1; keep `apps/*` and `packages/*`)
    - `tools/package.json`: name `@wraith/tools`, `private`, `type: module`, scripts `test` (`vitest run`), `check` (`tsc -p tsconfig.json --noEmit`); `devDependencies`: `vitest` 5.0.5, `fast-check` 4.10.2, `@types/node` 22.20.5, and `yaml` at one exact version chosen from the npm registry at install time (license ISC; no `^` or `~`); no workspace dependency (design: Dependency rules)
    - `tools/tsconfig.json`: not `composite`; `noEmit`; `allowImportingTsExtensions`; `types: ["node"]`; `include` covers the tools files, `test/**` and the protocol script it imports; a `.ts` import of `../../packages/protocol/scripts/check-boundaries.ts` must type-check; if it does not, record the working settings and use them
    - `tools/vitest.config.ts`: one `node` project, `include: ["test/**/*.test.ts"]`, `testTimeout: 60_000`, `passWithNoTests` off (R11.9); `tools/test/config.ts` defines `OPS_PBT_RUNS = 500` and `pbt(...)` as in 1.3; `tools/README.md` lists the scripts and states that `tools` is imported by no `apps/` or `packages/` file
    - Run `pnpm install`; record the installed `yaml` version for 1.9
    - _Requirements: R2.16 (scaffold), R11.9_
    - Design: "Module layout", "Dependency rules", D1, O1, O3, Testing Strategy (Tools, Conventions)
    - DoD: P0-D1 (supports)
  - [x] 1.7 Write the shared helpers and their tests
    - `lib/finding.ts`: `EXIT_OK`, `EXIT_FINDINGS`, `EXIT_ERROR`, `Finding` (file, line, optional column, rule; no field for text), `formatFinding` (`<file>:<line>[:<col>] <rule>`), `ToolError` (fixed messages, optional path only)
    - `lib/mask.ts`: `maskComments(src)` returns `scan(src).noComments` using a relative `.ts` import of `packages/protocol/scripts/check-boundaries.ts` (D2); if the import cannot be resolved by `node --experimental-strip-types` or `tsc`, use the guarded copy fallback of D2 and record it (task 12.4)
    - `lib/walk.ts`: `walkFiles({ root, dirs, skipDirNames })` returns sorted repo-relative posix paths, uses `lstat`, never follows symlinks
    - `tools/test/lib.test.ts`: `formatFinding` with and without a column; `ToolError` carries only a path; `maskComments` keeps offsets and blanks line and block comments but keeps string and template content; `walkFiles` returns a sorted list, skips named dirs and does not follow a symlink (temp tree)
    - _Requirements: R3.13, R3.17, R5.5, R5.10_
    - Design: "Shared helpers (`tools/lib`)", D2
    - DoD: P0-D7 (supports), P0-D6 (supports), P0-D1 (supports)
  - [x] 1.8 Wire the root scripts, tsconfig reference, Biome and `.gitignore`
    - Root `package.json`: add the scripts of the design table (`check:platform`, `check:secrets`, `check:pins`, `check:suites`, `check:si`, `test:reports`, `verify:local`) with the exact commands of "Build, resolution and ordering"; existing `build`, `test`, `typecheck`, `lint` unchanged; `packageManager` unchanged
    - Root `tsconfig.json`: add `{ "path": "./packages/platform" }` to `references` (R9.8)
    - `biome.json`: add the exclusion `!**/.reports` to `files.includes`; `.gitignore`: add `.reports/`
    - Scripts name files that later groups create (`tools/check-platform.ts` and the others); they are not run before their group lands. Run only `pnpm typecheck` and `pnpm lint` here
    - _Requirements: R9.8, R2.7_
    - Design: "Build, resolution and ordering" (root scripts table, `.reports/` bullet), D4
    - DoD: P0-D1 (supports), P0-D7 (supports)
  - [x] 1.9 Record `yaml` in `docs/THIRD_PARTY.md`
    - Add one entry: name `yaml`, the exact installed version from 1.6, license ISC, reason: parses `ci.yml` in the structure test; dev dependency of `@wraith/tools` only, not shipped (O3); follow the existing table format of the file
    - _Requirements: R2.16_
    - Design: "Design choices confirmed by owner" (O3), Testing Strategy (Tools)
    - DoD: P0-D1 (supports)
  - [x] 1.10 Run the group verification (group 1)
    - Run `pnpm -r test`, `pnpm -r build`, `pnpm typecheck`, `pnpm -r --if-present check` and `pnpm lint`; all clean; the `tools` and `platform` suites appear in the test output
    - List the files this group changed for the commit
    - _Requirements: R9.8_
    - Design: "Build, resolution and ordering"
    - DoD: P0-D1 (supports), P0-D7 (supports)

- [x] 2. Platform_Check (P0)
  - DoD: P0-D7 (the sample tests and the real-tree run), P0-D1 (supports: `check:platform` is a CI step). Requirements: R5.1 to R5.3, R5.5 to R5.10, R9.9. Design: "Platform_Check", Properties 4 and 5.
  - Files owned: `tools/check-platform.ts`, `tools/test/check-platform.test.ts`, `tools/test/check-platform.property.test.ts`, `tools/test/check-platform.tree.test.ts`, `tools/test/support/platform-samples.ts`.
  - [x] 2.1 Implement `tools/check-platform.ts`
    - `PLATFORM_TOKENS` with the nine ids and patterns of the design table, applied to `maskComments(text)`; `isScannedPath(rel)`, `checkPlatformSource(rel, text)` (findings with file, 1-based line and column, rule `platform/<id>`), `checkPlatformTree(root)` walking `apps/` and `packages/` and skipping `.reports`, `.wrangler` and `target`
    - CLI `node --experimental-strip-types tools/check-platform.ts [--root <dir>]`: reads every file, collects every finding, sorts by file, line and column, prints one `formatFinding` line per finding plus a summary line; exit 0 clean, 1 on findings, 2 on an unreadable file; never exits after the first finding (R5.10)
    - The exemption is exactly `packages/platform/` (plus `packages/fakes/` and the other path rules of `isScannedPath`); no other folder is exempt (R9.9)
    - _Requirements: R5.1, R5.2, R5.3, R5.5, R5.9, R5.10, R9.9_
    - Design: "Platform_Check" (token table, `isScannedPath`, Behavior, Stated limits)
    - DoD: P0-D7, P0-D1 (supports)
  - [x] 2.2 Write the example tests (token table and CLI)
    - `check-platform.test.ts` with `test/support/platform-samples.ts`: for each of the nine tokens one failing sample outside `packages/platform` and one passing sample inside it (R5.6, R5.7); `process.platform` and `SIGHUP` samples through the CLI with `--root <tmp>` assert exit 1 and a `file:line:col token` style line; a file with several violations lists them all; an unreadable file exits 2; `os.tmpdir()` is not flagged
    - _Requirements: R5.6, R5.7, R5.9, R5.10_
    - Design: Testing Strategy (Platform_Check example tests)
    - DoD: P0-D7
  - [x] 2.3 Write the property test for exact non-comment token reporting
    - **Property 4: The Platform_Check reports exactly the non-comment tokens**
    - `check-platform.property.test.ts`; generators: source files as arrays of (kind, token) placements (code, string literal, template literal, line comment, single-line block comment, multi-line block comment) with the expected (line, token) set computed from the model, not from the scanner; assert equality, no early exit, and the same result for any ordering of equal lines
    - **Validates: Requirements 5.2, 5.5, 5.10**
    - Design: Property 4
    - DoD: P0-D7
  - [x] 2.4 Write the property test for the scanned scope
    - **Property 5: The Platform_Check scope is exactly the stated tree**
    - Append to `check-platform.property.test.ts`; generators: relative paths built from segments including `apps`, `packages`, `platform`, `fakes`, `node_modules`, `dist`, `generated`, `test`, `spike`, `tools`, the scanned and unscanned extensions and the `.test.ts`, `.test.tsx`, `.d.ts` suffixes; assert `isScannedPath` and the presence of findings equal the stated predicate; `spike/` and `tools/` are never scanned
    - **Validates: Requirements 5.3, 9.9**
    - Design: Property 5
    - DoD: P0-D7
  - [x] 2.5 Write the real-tree test
    - `check-platform.tree.test.ts`: run the CLI on the repository root and assert exit 0 (R5.8); in the design phase no match existed in `apps/` and `packages/`, so any failure now is a real finding to fix at its source, not a reason to extend the exemption
    - _Requirements: R5.8_
    - Design: Testing Strategy (the real tree exits 0)
    - DoD: P0-D7, P0-D1 (supports)
  - [x] 2.6 Run the group verification (group 2)
    - Run `pnpm -r test`, `pnpm -r build`, `pnpm typecheck`, `pnpm -r --if-present check`, `pnpm lint` and `pnpm check:platform`; all clean; list the files for the commit
    - _Requirements: R5.8_
    - Design: "Build, resolution and ordering"
    - DoD: P0-D7, P0-D1 (supports)

- [x] 3. Checkpoint - Platform package, scaffold and Platform_Check
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Secret_Scan, pre-commit script and the `secret-scan` hook file (P0)
  - DoD: P0-D6 (supports: the `secret-scan` hook and its sample tests; the row changes only in 12.3), P0-D1 (supports: `check:secrets` is a CI step). Requirements: R3, R12.7 and R12.8 (sample assembly, shared with the SI hooks). Design: "Secret_Scan", "Pre_Commit_Hook", "Kiro Hook_Files", Properties 1, 2, 3 and 10, D6, D7, D10.
  - Files owned: `tools/secret-scan.ts`, `tools/lib/{secret-rules,git,hook-stdin}.ts`, `tools/test/support/samples.ts`, `tools/test/{git,secret-scan,secret-scan.property,hook-stdin,pre-commit,hook-files}.test.ts`, `.githooks/pre-commit`, `.kiro/hooks/secret-scan.json`.
  - [x] 4.1 Implement `tools/lib/git.ts` and its test
    - `stagedPaths`, `stagedContent` (reads the index with `git show :<path>`), `changedPaths`, `trackedPaths`, `treePaths` (cached plus others not ignored, minus deleted), each through `execFileSync("git", [...argv])`, no shell, `-z` output; a git failure throws `ToolError` with a fixed message
    - `git.test.ts` against a temporary repository (`git init`, identity via `-c`, global and system config pointed at `/dev/null`): staged content comes from the index even when the working copy differs; deleted files are not listed; an untracked file appears in `treePaths` and an ignored one does not; a git failure on a non-repository directory throws `ToolError`
    - _Requirements: R3.4, R3.12, R3.14_
    - Design: "Shared helpers" (`git.ts`), "Secret_Scan" (modes)
    - DoD: P0-D6 (supports)
  - [x] 4.2 Implement the Secret_Scan rules and the sample builders
    - `lib/secret-rules.ts`: `SecretClass` (nine classes), `SECRET_RULES` (each rule returns offsets only, never text), `scanText(file, text)` returning `Finding[]` with rule `secret/<class>`; patterns and the placeholder rule (a body with at most two distinct characters is not reported) and the PEM body-line rule exactly as the design table (D6); strict base64url and `JSON.parse` for the `jwt` class; the `node-key` class by file name `node.key` (any non-blank content is a finding)
    - `test/support/samples.ts`: one assembled sample builder per class from fragment arrays joined at call time (fragments never form a complete sample in the source text), plus decoy builders (public JWK without `d`, short placeholder run, body one character under the minimum, RFC 4231-shaped hex, PEM public key block, PEM private header without a body line, JWT-shaped string whose first part does not decode to JSON)
    - After writing, run the Secret_Scan tree test of 4.6 to confirm that the support file itself passes
    - _Requirements: R3.2, R3.3, R3.5, R3.6, R3.7, R3.8_
    - Design: "Secret_Scan" (rules table), D6, Testing Strategy (Conventions)
    - DoD: P0-D6 (supports)
  - [x] 4.3 Write the property test for embedded secrets
    - **Property 1: The Secret_Scan finds every embedded secret at its line**
    - `secret-scan.property.test.ts`; generators: benign surrounding lines from words that avoid the token prefixes, class samples from fragments with `fc.stringMatching` bodies filtered to at least three distinct characters, one or more embeddings at generated lines; assert one finding per embedding with the class and the line and no other finding; the `node.key` file name selects `node-key`
    - **Validates: Requirements 3.1, 3.2, 3.3**
    - Design: Property 1
    - DoD: P0-D6 (supports)
  - [x] 4.4 Write the property test for content-free reports
    - **Property 2: Reports never contain scanned content**
    - Append to `secret-scan.property.test.ts`; assert that `formatFinding` lines, the summary line and every `ToolError` message contain no substring of length 8 or more of any embedded sample or of the surrounding text, and that `Finding` objects have no member other than file, line, column and rule
    - **Validates: Requirements 3.1, 3.13, 3.17**
    - Design: Property 2
    - DoD: P0-D6 (supports)
  - [x] 4.5 Write the property test for decoys and near-misses
    - **Property 3: Decoys and near-misses are accepted**
    - Append to `secret-scan.property.test.ts`; generators: every decoy kind of 4.2 embedded in benign text; assert `scanText` returns no finding
    - **Validates: Requirements 3.5, 3.6**
    - Design: Property 3
    - DoD: P0-D6 (supports)
  - [x] 4.6 Implement the `tools/secret-scan.ts` CLI modes and the example tests
    - `runSecretScan(mode, cwd)` and the CLI `--staged | --changed <base> | --tracked | --tree | <path>…`; skip any path with a segment `node_modules`, `dist` or `.git` (R3.12); print the number of files scanned; binary content decoded as UTF-8 with replacement; unreadable file, git failure, missing or directory path or bad usage exit 2 and name the path, no partial pass (R3.14); exit 1 on findings
    - `secret-scan.test.ts`: one failing and one passing sample per class through the CLI in paths mode (R3.6); `fixtures/crypto/known-answers.json` passes (R3.8); a missing path exits 2 and names it; skipped folders; `--staged`, `--changed` and `--tracked` against a temporary git repository; the real tree passes with `--tree` (`pnpm check:secrets`)
    - _Requirements: R3.1, R3.4, R3.6, R3.8, R3.12, R3.14_
    - Design: "Secret_Scan" (modes and file selection), Testing Strategy (Secret_Scan examples)
    - DoD: P0-D6 (supports), P0-D1 (supports)
  - [x] 4.7 Implement `lib/hook-stdin.ts` and the `--hook-stdin` mode
    - `extractHookText(json)` returns every string value of `tool_input` at any depth and the path when a path-named key (`path`, `file_path`, `filePath`, `targetFile`) holds a string; tool names accepted in both forms: `fsWrite`/`fs_write`, `fsAppend`/`fs_append`, `strReplace`/`str_replace`, `executeBash`/`execute_bash`; stdin read up to 4 MiB
    - `--hook-stdin` in `secret-scan.ts`: scans the strings as one pseudo-file named after the path; when no path is found, the text is scanned as product code and the exit is 2 only on a finding; for the shell tool, a `tool_input.command` matching `git … commit` scans `--staged`, other commands are scanned as text; unparsable, empty or oversized stdin and every finding exit 2 (D7); the output is `formatFinding` lines only, never the payload
    - The same helper is reused by the SI scanners in 9.5
    - _Requirements: R3.9, R3.13, R3.14_
    - Design: "Secret_Scan" (`--hook-stdin`), D7, Property 10
    - DoD: P0-D6 (supports)
  - [x] 4.8 Write the property test for hook input handling
    - **Property 10: Hook input handling is total and fails closed**
    - `hook-stdin.test.ts`; generators: recursive JSON values of objects, arrays and strings, a secret sample placed at any depth of `tool_input`, with and without a path, camelCase and snake_case tool names; assert `extractHookText` returns every string and the path, the CLI exits 2 on the sample and 0 on a payload with no path and no finding, and 2 for any input that is not valid JSON, is empty, or exceeds the size limit
    - **Validates: Requirements 3.9, 3.14**
    - Design: Property 10
    - DoD: P0-D6 (supports)
  - [x] 4.9 Write the hook-stdin example tests for the Secret_Scan
    - Append to `hook-stdin.test.ts`, through the CLI: a payload with no path in `tool_input` and a secret sample exits 2 (missing path is scanned as product code); the same payload with clean text exits 0; unparsable, empty and oversized stdin exit 2; each of the eight tool names is accepted and scanned; an `executeBash` payload with a `git commit` command scans the staged files of a temporary repository
    - _Requirements: R3.9, R3.14_
    - Design: Testing Strategy (`hook-stdin.test.ts` examples)
    - DoD: P0-D6 (supports)
  - [x] 4.10 Create `.githooks/pre-commit` and its test
    - File content exactly as the design (POSIX `sh`, finds `tools/` from its own location, `exec node --experimental-strip-types "$hook_dir/../tools/secret-scan.ts" --staged`); set the execute bit on the file (`chmod 755 .githooks/pre-commit`) so the commit records mode `100755`; do not run `git config` (HS-3 is a human step)
    - `pre-commit.test.ts`: a temporary repository, a sample file assembled from fragments, `git add`, then `git -c core.hooksPath=<absolute path of the real .githooks> commit …`; the commit with the secret fails with a non-zero exit and a clean file commits; the script file has an execute bit and, when `git ls-files -s` lists it, mode `100755`; a scan of every file of the repository except this test finds no `git config` call
    - _Requirements: R3.15, R3.16, R3.17, R3.18, R3.20_
    - Design: "Pre_Commit_Hook", D10, Testing Strategy (Pre_Commit_Hook)
    - DoD: P0-D6 (supports)
  - [x] 4.11 Create `.kiro/hooks/secret-scan.json` and the hook-file test
    - JSON exactly in the design shape (`version: "v1"`, `PreToolUse`, matcher listing the eight tool names, command `node --experimental-strip-types tools/secret-scan.ts --hook-stdin`), formatted for Biome
    - `hook-files.test.ts` (secret-scan part): the file parses, has `version: "v1"`, a `PreToolUse` trigger, a command that starts with `node --experimental-strip-types tools/` and ends with `--hook-stdin`; no `test-on-save`, `fixture-redact-check` or `protocol-codegen` file exists in `.kiro/hooks/` (R12.9); the unsafe-token check on hook text is added in 9.7 because it needs `unsafe.ts`
    - Create this file only after 4.7 to 4.9 pass: Kiro can load it at the next session start, and a wrongly blocking hook would stop later writes. Right after creating the file, smoke-test it in Kiro: (a) an ordinary write (a harmless scratch file under the OS temp directory, or a throwaway workspace file deleted afterwards) passes; (b) a sample write assembled from fragments in the command that performs it is blocked with exit 2; no sample is committed or left on disk. Also record whether the relative `tools/...` command path worked from the workspace root, and the Kiro version. If the hook does not load, does not block, or blocks an ordinary write, delete `.kiro/hooks/secret-scan.json`, STOP and report to the owner. If this environment cannot run the check, STOP and ask the owner to do it. Record the result (date, hook, outcome, Kiro version, working-directory finding) in the spec evidence notes or the P0-D6 evidence note, for task 12.3
    - _Requirements: R3.9, R3.19, R12.1, R12.9_
    - Design: "Kiro Hook_Files", Testing Strategy (`hook-files.test.ts`)
    - DoD: P0-D6 (supports)
  - [x] 4.12 Run the group verification (group 4)
    - Run `pnpm -r test`, `pnpm -r build`, `pnpm typecheck`, `pnpm -r --if-present check`, `pnpm lint` and `pnpm check:secrets`; all clean; list the files for the commit (including `.githooks/pre-commit`, whose mode must be `100755`)
    - _Requirements: R3.8, R3.18_
    - Design: "Build, resolution and ordering"
    - DoD: P0-D6 (supports), P0-D1 (supports)

- [x] 5. Checkpoint - Secret_Scan and pre-commit
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Reporter, Suites_Check and `required-suites.json` (P0)
  - DoD: P0-D1 (supports: R11 "an empty run does not count"), P0-D2 and P0-D3 (supports: the required file makes their suites visible as having run; their rows are not edited). Requirements: R11.1 to R11.12. Design: "Suites_Check, reporter and required file", Property 7, D3, D4, O2.
  - Files owned: `tools/vitest-project-reporter.ts`, `tools/clean-reports.ts`, `tools/check-suites-ran.ts`, `tools/lib/suites.ts`, `tools/required-suites.json`, `tools/test/{reporter,check-suites,check-suites-cli}.test.ts`, `tools/test/support/suite-models.ts`.
  - [x] 6.1 Write the reporter and `clean-reports.ts`
    - `vitest-project-reporter.ts`: default export class with `onTestRunEnd(testModules, errors, reason)`; for each module record project name (`module.project.name`), file relative to the package, and counts of `result().state` (`passed`, `failed`, `skipped`, `pending`); write `<cwd>/.reports/suites.json` (version 1); wrap everything in `try/catch` and never throw or change the exit code
    - `clean-reports.ts`: removes every `.reports` folder under the workspace package directories (used before local runs only, D4)
    - Verify that Vitest 5.0.5 loads a `.ts` reporter given by absolute path (unverified in the design). If it does not, use an `.mjs` file with JSDoc types, update the root scripts in `package.json` (owner of that edit here: this task, root `package.json` scripts only) and record the choice in 12.4
    - `reporter.test.ts`: a tiny temporary Vitest project (one passing, one skipped, one `todo` test) run with the reporter; assert the written counts per state; this pins the state names for `todo` and `.only` that the design leaves unverified
    - _Requirements: R11.1, R11.4_
    - Design: "Suites_Check, reporter and required file" (Reporter, Suite_Report model), "Risks and unverified items", V1, V4
    - DoD: P0-D1 (supports)
  - [x] 6.2 Implement `tools/lib/suites.ts`
    - `RequiredSuite`, `MINIMUM_SUITES` (the five entries of the design with `minTests` 1, R11.7), `SuiteRun`, `SuiteReport`, hand-written `parseSuiteReport` and `parseRequired` (return `null` on any shape error), and `checkSuites({ required, packagesWithTests, reports })` returning findings with the ten rule ids of the design table (`suites/required-invalid`, `floor-missing`, `floor-lowered`, `node-only-listed-for-workers`, `report-missing`, `report-invalid`, `report-empty`, `run-missing`, `too-few-tests`, `not-all-passed`); every state other than `passed` counts as not passed
    - _Requirements: R11.2, R11.3, R11.4, R11.5, R11.7, R11.9, R11.12_
    - Design: "Suites_Check, reporter and required file" (types, rules table)
    - DoD: P0-D1 (supports)
  - [x] 6.3 Write the property test for the Suites_Check
    - **Property 7: The Suites_Check passes conforming runs and fails each single defect**
    - `check-suites.test.ts` with `test/support/suite-models.ts`; generators: report and required-file models rendered to the data model; assert no finding for conforming input and, for each single injected defect of the property text, at least one finding with that defect's rule id and none for unrelated rules; assert `parseSuiteReport(JSON.parse(JSON.stringify(model)))` equals the model
    - **Validates: Requirements 11.2, 11.3, 11.4, 11.7, 11.9, 11.12**
    - Design: Property 7
    - DoD: P0-D1 (supports)
  - [x] 6.4 Implement `tools/check-suites-ran.ts` and the CLI tests
    - CLI `node --experimental-strip-types tools/check-suites-ran.ts [--root <dir>]`: reads `pnpm-workspace.yaml` (only the `dir/*` and plain `dir` forms; anything else is an error, exit 2) and each `package.json` to build `packagesWithTests` (the same listing function is exported for 7.4), reads each `<dir>/.reports/suites.json` and `tools/required-suites.json`, prints one `<package>/<file> <project> <passed> passed` line per listed run (R11.11), then the findings; exit 1 on findings, 2 on operational errors
    - `check-suites-cli.test.ts`: against a temporary tree: a conforming tree exits 0 with the count lines; a missing report, an empty report and a skipped test exit 1 with the matching rule; an unsupported workspace glob exits 2
    - _Requirements: R11.2, R11.6, R11.8, R11.9, R11.10, R11.11_
    - Design: "Suites_Check, reporter and required file" (`packagesWithTests`, CLI)
    - DoD: P0-D1 (supports)
  - [x] 6.5 Create `tools/required-suites.json` from a real local run
    - Check the real test file names in `packages/crypto/test/` (P0-D2: `jcs-vectors.test.ts`; P0-D3: the sign and verify round trip and the mutate-value, mutate-byte and mutate-signature suites) and use the actual names; list `node` and `workers` only for files the `workers` project runs (a `*.node.test.ts` file never lists `workers`, R11.12)
    - Run `pnpm -r test -- --reporter=default --reporter=<absolute path of tools/vitest-project-reporter.ts>` (absolute path written out in the command) after `node --experimental-strip-types tools/clean-reports.ts`, read the per-project counts from the written reports, and set `minTests` from them (40 for `jcs-vectors.test.ts`; the others are read, not guessed); no entry lists a file excluded from a project (R11.12)
    - The file holds data only: no code, no secret
    - _Requirements: R11.5, R11.6, R11.12_
    - Design: "Suites_Check, reporter and required file" (Required_Suites_File), V5
    - DoD: P0-D1 (supports), P0-D2 (supports), P0-D3 (supports)
  - [x] 6.6 Run the group verification (group 6)
    - Run `pnpm -r test`, `pnpm -r build`, `pnpm typecheck`, `pnpm -r --if-present check`, `pnpm lint`, then `pnpm test:reports` followed by `pnpm check:suites`; all clean; confirm Biome does not lint `.reports`; list the files for the commit
    - _Requirements: R11.8, R11.9_
    - Design: "Build, resolution and ordering"
    - DoD: P0-D1 (supports)

- [x] 7. Pin_Check and `ci.yml` (P0)
  - DoD: P0-D1 (supports: local evidence part (a) only; the row stays `todo` until the GitHub run). Requirements: R2 (criteria 1 to 14, 16, 17), R10, R3.10, R3.11. Design: "Pin_Check", "CI workflow", Property 6, D5, D12, D13, O3, O5.
  - Files owned: `tools/check-workflow-pins.ts`, `tools/test/{check-workflow-pins,ci-workflow}.test.ts`, `.github/workflows/ci.yml`; only if the OQ-7 fallback of 7.4 applies: `tools/check-suites-ran.ts`, `tools/lib/suites.ts`, `tools/required-suites.json`, `tools/test/check-suites-cli.test.ts`, `tools/test/check-suites.test.ts`.
  - [x] 7.1 Implement `tools/check-workflow-pins.ts`
    - `checkWorkflowText(file, text)` and `checkWorkflowsDir(root)` with the line-based classification of the design (drop trailing comments outside quotes; `./` ignored; `docker://` needs `@sha256:` and 64 lowercase hex; otherwise `owner/repo[/path]@<40 lowercase hex>`; problems `no-ref`, `bad-action`, `mutable-ref`, `short-sha`, `long-sha`, `uppercase-sha`, `docker-no-digest`; rule `pin/<problem>`); reads only the top level of `.github/workflows/` (`*.yml`, `*.yaml`); CLI `[--root <dir>]` with exit 0, 1 or 2
    - _Requirements: R10.1, R10.2, R10.3, R10.4, R10.5, R10.7, R10.8_
    - Design: "Pin_Check"
    - DoD: P0-D1 (supports)
  - [x] 7.2 Write the property test and the example table for the Pin_Check
    - **Property 6: The Pin_Check accepts exactly full lowercase SHAs**
    - `check-workflow-pins.test.ts`; generators: `uses:` values (tags, branches, expressions, hex strings of 7 to 64 characters, uppercase hex, no `@`, `docker://` with and without digest, local paths) and workflow texts with a `uses:` only after a comment marker; assert pass if and only if the stated forms, otherwise a finding with file, 1-based line and the matching problem id; add the example table of R10.6 (a tag, a branch, a 7-character SHA and a 39-character SHA fail; a 40-hex SHA and `./` pass); the real `.github/workflows/` folder passes
    - **Validates: Requirements 10.2, 10.3, 10.4, 10.5, 10.8**
    - Design: Property 6, Testing Strategy (Property tests table)
    - DoD: P0-D1 (supports)
  - [x] 7.3 Look up the pins and write `.github/workflows/ci.yml`
    - Re-run the read-only lookup `git ls-remote --tags https://github.com/actions/checkout.git` and the same for `https://github.com/actions/setup-node.git`; confirm the owner-verified pins before writing: `actions/checkout` v7.0.1 = `3d3c42e5aac5ba805825da76410c181273ba90b1` and `actions/setup-node` v7.1.0 = `949feb2413d6458794dcd2491c4babbbce0c15c1` (no peeled `^{}` entry means the SHA is the commit); if a SHA differs from the owner-verified value, STOP and report to the owner, do not substitute
    - Write the workflow exactly as the design YAML: `pull_request` and `push` to `main`; workflow-level `permissions: contents: read`; `concurrency` with `cancel-in-progress: true`; matrix `os: [ubuntu-latest, macos-latest]` with `fail-fast: false`; checkout with `persist-credentials: false`; setup-node with `node-version: 22`; then `npm install -g pnpm@9.15.0` (after setup-node, R2.5), the version-equality step against `packageManager`, `pnpm install --frozen-lockfile`, lint, typecheck, `pnpm -r --if-present check` (D12), `pnpm -r build`, the reporter test step, and `check:platform`, `check:secrets`, `check:pins`, `check:suites`; each `uses:` line carries a trailing `# v<major>.<minor>.<patch>` comment with the tag (R10.9); no `continue-on-error`, no `if:`, no `environment`, no secrets, no push, no `actions/cache`, no gitleaks step (R3.11), no actionlint (D13); no other third-party action
    - The test step line is written as in the design and is confirmed or replaced in 7.4 before this group is committed
    - _Requirements: R2.1, R2.2, R2.3, R2.4, R2.5, R2.6, R2.7, R2.8, R2.9, R2.10, R2.11, R2.12, R2.13, R2.14, R3.10, R3.11, R10.1, R10.9_
    - Design: "CI workflow" (pins table, YAML, reading against the requirements), D5, D12, D13, O5
    - DoD: P0-D1 (supports)
  - [x] 7.4 Run the exact CI test command locally and confirm flag forwarding and report files
    - Delete every `.reports/` folder, then run the exact CI test command as written in `ci.yml`: `pnpm -r test -- --reporter=default --reporter="<absolute path of tools/vitest-project-reporter.ts>"` (the repository path written out in full for the local run; the file keeps `$PWD`)
    - Confirm (1) the flags reach vitest in every package: the `default` reporter output appears and the reporter writes its file; (2) every package with a test script (the `packagesWithTests` list exported by 6.4) wrote `<dir>/.reports/suites.json`, non-empty and valid JSON with at least one run; the proof is this local run followed by `pnpm check:suites`: its `report-missing` outcome covers a package that has a test script but wrote no report (no extra test file is written)
    - If either confirmation fails, use the OQ-7 two-run fallback: for `packages/crypto` two runs, `vitest run --project node` and `vitest run --project workers`, each with the built-in JSON reporter writing `.reports/suites-node.json` and `.reports/suites-workers.json`; change `check-suites-ran.ts` and `lib/suites.ts` to read both files and take the project from the file name; adjust their tests and `required-suites.json` if needed; the other packages keep one run; list the two runs as separate steps in `ci.yml` in the same position (the R2.7 order still holds)
    - If neither the single-run command nor the two-run fallback produces the report files, STOP and report to the owner with the commands, versions and output
    - Record the outcome, the command used and the versions in the evidence notes (12.2)
    - _Requirements: R2.9, R2.16, R11.1, R11.9, R11.10_
    - Design: "CI workflow" (Test-step check), "Risks and unverified items" (pnpm 9 flag forwarding), OQ-7
    - DoD: P0-D1 (supports)
  - [x] 7.5 Write the `ci.yml` structure test
    - `ci-workflow.test.ts`: parse `.github/workflows/ci.yml` with `yaml` and assert: triggers `pull_request` and `push` to `main`; matrix labels equal to exactly `ubuntu-latest` and `macos-latest`; `node-version` equals the `.nvmrc` major; the `npm install -g pnpm@9.15.0` step after setup-node and before `pnpm install --frozen-lockfile`; the version-equality step; the required commands as an ordered subsequence of the `run` steps (extras allowed, D12); workflow-level `permissions` equal to `{contents: read}` and none at job level; `concurrency.cancel-in-progress`; no `continue-on-error`, no `if`, no `environment`, no `secrets.` text, no `git push`; no third-party action beyond `actions/checkout` and `actions/setup-node`; every `uses:` line is followed by a `# v<major>.<minor>.<patch>` comment; the two SHAs equal the owner-verified values; the Pin_Check passes on the file; no gitleaks file or step exists (R3.11)
    - _Requirements: R2.1 to R2.14, R2.16, R3.11, R10.1, R10.9_
    - Design: Testing Strategy (`ci-workflow.test.ts`)
    - DoD: P0-D1 (supports)
  - [x] 7.6 Run the group verification (group 7)
    - Run `pnpm -r test`, `pnpm -r build`, `pnpm typecheck`, `pnpm -r --if-present check`, `pnpm lint`, `pnpm check:pins`, then `pnpm test:reports` and `pnpm check:suites`; all clean; list the files for the commit; do not push
    - _Requirements: R2.16, R10.7_
    - Design: "Build, resolution and ordering"
    - DoD: P0-D1 (supports)

- [x] 8. Checkpoint - Reporter, Suites_Check, Pin_Check and `ci.yml`
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. SI hooks `no-trust-all` and `no-auto-approve` (P0, BLOCKED until S-protocol 14.1 and 14.2)
  - **PREREQUISITE (outside this task list, separate S-protocol commit):** S-protocol tasks 14.1 (`packages/protocol/src/unsafe.ts`) and 14.2 (its property test), both done in full and ticked, must be committed as their own S-protocol commit before any task of this group starts (R12.10, OQ-2). Task 9.1 verifies it and stops if it is missing. No other group of this plan depends on it, and no earlier group verification runs anything from this group. This plan does not edit S-protocol files or tasks.
  - DoD: P0-D6 (supports: the two SI hooks and their sample tests; the row changes only in 12.3). Requirements: R12.3 to R12.8, R12.10, R12.1 (two Hook_Files). Design: "SI hook scanners", "Ordering with S-protocol", Properties 9 and 10, D8, D9, O4.
  - Files owned: `tools/lib/{unsafe-tokens,si-rules}.ts`, `tools/no-trust-all.ts`, `tools/no-auto-approve.ts`, `tools/test/si-hooks.test.ts`, `tools/test/hook-files.test.ts` (extension), `.kiro/hooks/no-trust-all.json`, `.kiro/hooks/no-auto-approve.json`.
  - [x] 9.1 Verify the S-protocol prerequisite (precondition step, no file changes)
    - Check that `packages/protocol/src/unsafe.ts` and its property test exist, that tasks 14.1 and 14.2 in `.kiro/specs/s-protocol/tasks.md` are ticked, and with read-only `git log --oneline -- packages/protocol/src/unsafe.ts` that the files are in a commit of their own; run `pnpm -r test` and `pnpm typecheck` to confirm the commit is clean
    - If any item is missing, STOP and report to the owner. Do not write a local copy of the unsafe tokens and do not spell any token in this plan's files (R12.6)
    - _Requirements: R12.10_
    - Design: "Ordering with S-protocol"
    - DoD: P0-D6 (supports)
  - [x] 9.2 Write `lib/unsafe-tokens.ts` and read the real token groups
    - `export * from "../../packages/protocol/src/unsafe.ts"` (D8); verify that `node --experimental-strip-types` can import the file (no `enum`, no parameter properties) and that `tsc -p tools/tsconfig.json --noEmit` type-checks the import; if not, STOP and report (a change to `unsafe.ts` belongs to S-protocol)
    - Read the group names, the `findUnsafeToken` return shape and the `samples` of `unsafe.ts`, and write the group-to-hook assignment (SI-2 groups for `no-trust-all`, every group for `no-auto-approve`) in `si-rules.ts` in 9.3; record that assignment in the evidence notes
    - _Requirements: R12.6_
    - Design: "SI hook scanners" (lib/unsafe-tokens.ts), D8
    - DoD: P0-D6 (supports)
  - [x] 9.3 Implement `lib/si-rules.ts`
    - `isProductCode(rel)` (everything except `**/test/**`, `*.test.ts`, `packages/fakes/`, `spike/`, `fixtures/`, plus the scanner skips `docs/`, `.kiro/`, `*.md`, `node_modules`, `dist`, `.git`, and reads only the text file types of the design), `checkSiSource(hook, rel, text)` (rule `si/<hook>/<group-or-class>`), `checkSiTree(hook, root)`; the token classes use `findUnsafeToken` per line and the allowed locations `packages/protocol/src/unsafe.ts` and `packages/protocol/templates/claude-terminal-guard.json`; the `autopilot-marker` class (marker assembled from fragments in the script; allowed in `packages/protocol/**` and `apps/node/src/autopilot/**`) and the `allow-unverified` class (a statement within the same line or the next 8 lines naming the `approval.answer` or `approval.respond` type and an `allow_` option; allowed in `packages/protocol/**`, `apps/web/**`, `apps/watch-zepp/**`, `apps/desktop/**`, `apps/node/src/autopilot/**`); `generated/` is not exempt (O4); the file spells no unsafe token
    - _Requirements: R12.3, R12.4, R12.5, R12.6_
    - Design: "SI hook scanners" (scope, table), D9, O4
    - DoD: P0-D6 (supports)
  - [x] 9.4 Write the property test for the SI scanners
    - **Property 9: The SI scanners flag unsafe samples only in product code outside the allowed locations**
    - `si-hooks.test.ts`; generators: benign text, a sample taken from the `samples` of a group of `unsafe.ts` (or an assembled autopilot marker or approval-with-allow statement) at a generated line, and generated paths including product, test, fakes, spike, fixtures, docs, `.kiro`, `*.md` and the allowed locations; assert a finding at that line if and only if the path is product code, the hook covers the group or class, and the path is not an allowed location; assert every group of `unsafe.ts` is covered by at least one hook
    - **Validates: Requirements 12.3, 12.4, 12.5, 12.6**
    - Design: Property 9
    - DoD: P0-D6 (supports)
  - [x] 9.5 Implement `tools/no-trust-all.ts` and `tools/no-auto-approve.ts`
    - Both: CLI `--tree | --hook-stdin | <path>…`; `--tree` scans product code from `treePaths`; findings print `formatFinding` lines only; exit 0, 1, 2 (in hook mode every finding and error exits 2, D7); `--hook-stdin` reuses `extractHookText` from 4.7: a path found and outside product code exits 0 without scanning, no path found means the text is scanned as product code, unparsable stdin exits 2; `no-trust-all` also scans `tool_input.command` of the shell tool (both name forms) for the SI-2 patterns; `no-auto-approve` handles the write tools only
    - The scripts and their tests spell no forbidden token (R12.6, R12.8)
    - _Requirements: R12.3, R12.4, R12.5, R12.6, R12.7_
    - Design: "SI hook scanners" (Hook mode), D7
    - DoD: P0-D6 (supports)
  - [x] 9.6 Write the example tests for the SI hooks
    - Append to `si-hooks.test.ts`: at least one sample per pattern class that must be caught and samples that must pass, for each hook, assembled at test time (token samples from `unsafe.ts` `samples`, never spelled; R12.7, R12.8); the real tree passes both scanners (`pnpm check:si`); the scripts' own sources and tests contain no unsafe token (`findUnsafeToken` over them); hook-stdin examples through the CLI: an `executeBash` payload whose `tool_input.command` holds an SI-2 pattern is blocked by `no-trust-all` (exit 2) and a clean command passes; both tool-name forms; a payload with no path and a sample exits 2; unparsable stdin exits 2; `.kiro/agents` build agent files and specs are not scanned
    - _Requirements: R12.3, R12.4, R12.5, R12.7, R12.8_
    - Design: Testing Strategy (`si-hooks.test.ts`, `hook-stdin.test.ts` examples)
    - DoD: P0-D6 (supports)
  - [x] 9.7 Create the two SI Hook_Files and extend the hook-file test
    - `.kiro/hooks/no-trust-all.json` (matcher: the write tools and the shell tool, both name forms; command `node --experimental-strip-types tools/no-trust-all.ts --hook-stdin`) and `.kiro/hooks/no-auto-approve.json` (matcher: the write tools only; command `… tools/no-auto-approve.ts --hook-stdin`), same shape as `secret-scan.json`, formatted for Biome
    - Extend `hook-files.test.ts` (this task owns its second edit): all three files parse with `version: "v1"`, a `PreToolUse` trigger and a command shape of `node --experimental-strip-types tools/… --hook-stdin`; none of the three contains an unsafe token (`findUnsafeToken`); only these three hook files were added by this spec (R12.9)
    - Create the files only after 9.5 and 9.6 pass. Right after creating them, smoke-test both in Kiro: (a) an ordinary write passes; (b) an unsafe-token sample taken from the `unsafe.ts` samples (never typed as a literal, never committed or left on disk) is blocked with exit 2 by each hook. If either hook does not load, does not block, or blocks an ordinary write, delete both files, STOP and report to the owner. If this environment cannot run the check, STOP and ask the owner. Record the result (date, hook, outcome, Kiro version, working-directory finding) in the spec evidence notes or the P0-D6 evidence note, for task 12.3
    - _Requirements: R12.1, R12.3, R12.4, R12.6, R12.9_
    - Design: "Kiro Hook_Files", "Ordering with S-protocol"
    - DoD: P0-D6 (supports)
  - [x] 9.8 Run the group verification (group 9)
    - Run `pnpm -r test`, `pnpm -r build`, `pnpm typecheck`, `pnpm -r --if-present check`, `pnpm lint` and `pnpm check:si`; all clean; list the files for the commit
    - _Requirements: R12.7_
    - Design: "Build, resolution and ordering"
    - DoD: P0-D6 (supports)

- [x] 10. Checkpoint - SI hooks
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Collect the Kiro hook smoke-test results (P0)
  - DoD: P0-D6 (the hook files must be shown to load and block before the row can be `pass`; the smoke tests run in 4.11 and 9.7). Requirements: R3.9, R12.1. Design: "Kiro Hook_Files" (H-smoke), "Risks and unverified items" (Kiro hook format and working directory).
  - Files owned: none created; the results are recorded by 4.11 and 9.7 in the evidence notes of this spec or the P0-D6 evidence note, and written into `docs/PHASE-STATUS.md` (P0-D6 evidence column) by 12.3.
  - [x] 11.1 Collect the recorded smoke-test results for task 12.3
    - Read the results recorded by task 4.11 (`secret-scan`) and task 9.7 (`no-trust-all`, `no-auto-approve`): date, hook, outcome, Kiro version, working-directory finding. This task runs no smoke test and creates or edits no file
    - If a result is missing or failed, STOP and report to the owner: P0-D6 stays `todo`; only the hook JSON files are affected, the pre-commit script and CI keep guarding
    - Hand the three results to task 12.3
    - _Requirements: R3.9, R3.19, R12.1_
    - Design: "Kiro Hook_Files" (Smoke test before enabling), OQ-3
    - DoD: P0-D6

- [ ] 12. Evidence and decisions (P0)
  - DoD: P0-D1 (supports: local evidence part (a); the row stays `todo`), P0-D6, P0-D7. Requirements: R13.1 to R13.6, R12.2, R14.5 of the project decision-log convention. Design: "Mapping to Definition of Done items and evidence rules".
  - Files owned: `docs/PHASE-STATUS.md` (rows P0-D1, P0-D6, P0-D7 only, plus one short note line under the table if needed), `docs/DECISIONS-PENDING.md`.
  - [ ] 12.1 Update the P0-D7 row
    - Set P0-D7 to `pass` only if the Platform_Check sample tests (every token, `process.platform`, `SIGHUP`) and the real-tree run (`pnpm check:platform`) pass; evidence text: the commands, the test file names, the node and pnpm versions, the date; the CI step is P0-D1 evidence, not a P0-D7 condition; if anything failed, leave `todo` and state why
    - Edit only the P0-D7 row
    - _Requirements: R5.6, R5.8, R9.9_
    - Design: Mapping table (P0-D7)
    - DoD: P0-D7
  - [ ] 12.2 Update the P0-D1 row (local evidence only)
    - Run `pnpm install --frozen-lockfile` and then `pnpm verify:local`; record in the evidence column: the command list, the node and pnpm versions, the `check:suites` count lines, the outcome of the test-step check and the command used (7.4, including whether the OQ-7 fallback was needed), the date, and that the Workers_Project has run only on the dev machine and on no GitHub runner yet (R13.5)
    - The row stays `todo` (R13.3): it becomes `pass` only after the human steps HS-1 to HS-5 and a green GitHub run on `ubuntu-latest` and `macos-latest` with the run link; this task never writes `pass` and never pushes (R13.4). If a failed run on a runner is later recorded, the evidence states runner, versions and error and the Workers_Project is not dropped (R13.6)
    - _Requirements: R13.1, R13.3, R13.4, R13.5, R13.6_
    - Design: Mapping table (P0-D1)
    - DoD: P0-D1 (supports; row stays `todo`)
  - [ ] 12.3 Update the P0-D6 row
    - Set P0-D6 to `pass` only when all three Hook_Files exist in `.kiro/hooks/`, each has its passing sample tests (Properties 1 and 9, the per-class example tables), the real-tree tests pass (`pnpm check:secrets` and `pnpm check:si`), the `unsafe.ts` commit exists (R12.2) and the smoke tests recorded by 4.11 and 9.7 (collected in 11.1) passed; otherwise leave `todo` and state which condition is missing; the evidence column records the smoke-test results collected in 11.1 (date, hook, outcome, Kiro version)
    - Edit only the P0-D6 row
    - _Requirements: R12.1, R12.2, R12.7_
    - Design: Mapping table (P0-D6), Kiro Hook_Files (H-smoke)
    - DoD: P0-D6
  - [ ] 12.4 Record agent-made decisions in `docs/DECISIONS-PENDING.md` (conditional)
    - Only if an agent decision was taken: the guarded-copy fallback for `mask.ts` (1.7), the `.mjs` reporter instead of `.ts` (6.1), the OQ-7 two-run fallback (7.4), the platform package's own `OPS_PBT_RUNS` copy, a `tools/tsconfig.json` setting needed for the relative import, and the group-to-hook assignment of `unsafe.ts` (9.2); one row each (id, date, question, default taken, impact if changed, resolved); skip the task body if none was taken
    - _Requirements: R14.5 of the project decision-log convention_
    - Design: D2, D3, OQ-7
    - DoD: P0-D1 (supports)
  - [ ] 12.5 Run the final verification
    - Run `pnpm -r test`, `pnpm -r build`, `pnpm typecheck`, `pnpm -r --if-present check`, `pnpm lint`, `pnpm test:reports` and the five checks (`check:platform`, `check:secrets`, `check:pins`, `check:suites`, `check:si`); all clean; confirm `git status` lists only files owned by this plan; list the files for the final local commit; do not push
    - _Requirements: R13.1, R13.4_
    - Design: "Mapping to Definition of Done items and evidence rules"
    - DoD: P0-D1 (supports), P0-D6, P0-D7

- [ ] 13. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- No task is marked optional (`*`). The design marks none: property tests, the scans and structure tests, and the sample tests all enforce a requirement or a design rule.
- Blocked or conditional tasks:
  - Group 9 (tasks 9.1 to 9.8) is BLOCKED until S-protocol tasks 14.1 (`packages/protocol/src/unsafe.ts`) and 14.2 (its property test) are done, ticked and committed as their own S-protocol commit (R12.10). Task 9.1 stops and reports if they are missing. Nothing in groups 1 to 7 depends on group 9; the `hook-files.test.ts` unsafe-token check is added only in 9.7. Task 12.3 cannot set P0-D6 to `pass` while group 9 is open.
  - The Kiro smoke tests are conditional on Kiro and run right after each hook file is created: task 4.11 for `secret-scan`, task 9.7 for the two SI hooks. If the hook tool of this environment cannot run the check, the loop stops and asks the owner. A hook that does not load, does not block or blocks an ordinary write: the file(s) are deleted and the work stops for the owner. Task 11.1 only collects the recorded results for task 12.3. P0-D6 stays `todo` until all pass.
  - Task 7.4 (CI test-step check) has no extra test file: the proof is the exact CI test command run locally followed by `pnpm check:suites` (`report-missing` covers a package without a report). It is conditional: if pnpm 9 does not forward the reporter flags or a package with a test script writes no `.reports/suites.json`, the OQ-7 two-run fallback is used; if neither works, STOP and report. Task 6.1 has a smaller conditional: an `.mjs` reporter if Vitest cannot load a `.ts` reporter.
  - Task 7.3 stops if a pin SHA read from the upstream tags differs from the owner-verified value.
  - Tasks 1.7 (guarded copy for `mask.ts`) and 12.4 are conditional on an agent-made decision having been taken.
  - Workerd on GitHub runners is unverified (OQ-9): the Workers_Project has run only on the dev machine (macOS arm64). It can be shown only after the human push, so this plan produces local evidence only and records which runners have run it (R13.5). On a runner failure the evidence records runner, versions and error, the row stays `todo`, and the project is not dropped (R13.6).
- Human steps, not tasks (nothing here performs them; R13.4, R3.20): HS-1 create the GitHub repository; HS-2 turn on secret scanning and push protection (before the first push, DECISION-19); HS-3 run `git config core.hooksPath .githooks` once on each clone to activate the pre-commit script; HS-4 make the first push; HS-5 read the first CI run on both runners. P0-D1 becomes `pass` only after HS-1 to HS-5 with the run link.
- Dependency versions pinned at install time and recorded: `yaml` (exact, ISC, recorded in `docs/THIRD_PARTY.md` by 1.9). `fast-check` 4.10.2, `vitest` 5.0.5 and `@types/node` 22.20.5 follow the other packages. The CI pins are the owner-verified `actions/checkout` v7.0.1 (`3d3c42e5aac5ba805825da76410c181273ba90b1`) and `actions/setup-node` v7.1.0 (`949feb2413d6458794dcd2491c4babbbce0c15c1`), with `npm install -g pnpm@9.15.0` after setup-node (OQ-10).
- Owner decisions carried (2026-11-16): O1 `tools` is a workspace package; O2 per-project reports by a custom reporter with the OQ-7 two-run route as fallback; O3 `yaml` as a pinned dev dependency, one entry in `docs/THIRD_PARTY.md`, and the extra CI step `pnpm -r --if-present check`; O4 SI scanner allowed lists as in the SI table, `generated/` not exempt, the owner may edit the lists when `unsafe.ts` lands; O5 the action pins above.
- `tools` tests cannot import `pbt()` or `CRYPTO_PBT_RUNS` from crypto or protocol; `tools/test/config.ts` and `packages/platform/test/config.ts` each define `OPS_PBT_RUNS = 500` locally.
- Files outside the two new packages touched by this spec: root `package.json`, `tsconfig.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `biome.json`, `.gitignore`, `.githooks/pre-commit`, `.github/workflows/ci.yml`, `.kiro/hooks/{secret-scan,no-trust-all,no-auto-approve}.json`, `docs/THIRD_PARTY.md`, and recording-only edits in `docs/PHASE-STATUS.md` (12.1 to 12.3) and `docs/DECISIONS-PENDING.md` (12.4). S-protocol and S-crypto files and tasks, `requirements.md` and `design.md` are not edited.

## DoD Coverage Table

| DoD id | Tasks | Outside this spec |
|---|---|---|
| P0-D1 | 1.1 to 1.10, 2.5, 2.6, 4.1 to 4.12, 6.1 to 6.6, 7.1 to 7.6, 12.2, 12.4, 12.5 (all "supports": local evidence part (a)) | The GitHub run on `ubuntu-latest` and `macos-latest` (HS-1 to HS-5, human-gated); the row stays `todo` until then |
| P0-D2 | 6.5 (supports: the required file lists the JCS suite per project) | The suite and the row belong to S-crypto; not edited here |
| P0-D3 | 6.5 (supports: the required file lists the four P0-D3 suites per project) | Same |
| P0-D6 | 4.1 to 4.12, 9.1 to 9.8, 11.1, 12.3 | The `unsafe.ts` commit (S-protocol 14.1 and 14.2); the `protocol-codegen` hook (S-protocol) |
| P0-D7 | 1.1 to 1.5, 1.7, 1.8, 2.1 to 2.6, 12.1 | The CI `check:platform` step is P0-D1 evidence only |
| This spec's Properties 1 to 10 | 1.4 (Property 8), 2.3, 2.4 (Properties 4 and 5), 4.3 to 4.5 (Properties 1 to 3), 4.8 (Property 10), 6.3 (Property 7), 7.2 (Property 6), 9.4 (Property 9) | Nothing else; these are this spec's own properties, not §21.1 group P1 numbers |

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.6"] },
    { "id": 2, "tasks": ["1.3", "1.5", "1.7"] },
    { "id": 3, "tasks": ["1.4", "1.8"] },
    { "id": 4, "tasks": ["1.9"] },
    { "id": 5, "tasks": ["1.10"] },
    { "id": 6, "tasks": ["2.1"] },
    { "id": 7, "tasks": ["2.2", "2.3", "2.5"] },
    { "id": 8, "tasks": ["2.4"] },
    { "id": 9, "tasks": ["2.6"] },
    { "id": 10, "tasks": ["4.1", "4.2"] },
    { "id": 11, "tasks": ["4.3", "4.6"] },
    { "id": 12, "tasks": ["4.4", "4.7"] },
    { "id": 13, "tasks": ["4.5", "4.8"] },
    { "id": 14, "tasks": ["4.9", "4.10"] },
    { "id": 15, "tasks": ["4.11"] },
    { "id": 16, "tasks": ["4.12"] },
    { "id": 17, "tasks": ["6.1", "6.2"] },
    { "id": 18, "tasks": ["6.3", "6.4"] },
    { "id": 19, "tasks": ["6.5"] },
    { "id": 20, "tasks": ["6.6"] },
    { "id": 21, "tasks": ["7.1"] },
    { "id": 22, "tasks": ["7.2", "7.3"] },
    { "id": 23, "tasks": ["7.4"] },
    { "id": 24, "tasks": ["7.5"] },
    { "id": 25, "tasks": ["7.6"] },
    { "id": 26, "tasks": ["9.1"] },
    { "id": 27, "tasks": ["9.2"] },
    { "id": 28, "tasks": ["9.3"] },
    { "id": 29, "tasks": ["9.4", "9.5"] },
    { "id": 30, "tasks": ["9.6", "9.7"] },
    { "id": 31, "tasks": ["9.8"] },
    { "id": 32, "tasks": ["11.1"] },
    { "id": 33, "tasks": ["12.1"] },
    { "id": 34, "tasks": ["12.2"] },
    { "id": 35, "tasks": ["12.3", "12.4"] },
    { "id": 36, "tasks": ["12.5"] }
  ]
}
```
