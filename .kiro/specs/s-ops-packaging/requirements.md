# Requirements Document

## Introduction

S-ops-packaging is the 23rd spec of Project Wraith (architecture.md §20 row 23). It covers how Wraith is built, checked, packaged, installed and run: the CI workflows, the repository checks (`tools/check-platform.ts`, the `secret-scan` hook and the other P0 checks defined here), the platform layer `packages/platform`, the CLI entry points, release tarballs, the Homebrew formula, Docker, launchd and systemd service units, headless install and the WSL2 notice.

Source of truth: `docs/architecture.md` v4.1.7: §20 row 23 (R1 to R8), §18.1 (P0 scope and P0-D1, P0-D6, P0-D7), §4.10 (platform layer and `tools/check-platform.ts`), §17 (repository layout, hooks list), §3.4 item 8 (headless machine), §4.6.1 (install channels, `<bin-dir>`), §11.3 (CLI), §16 (stack: CI, Lint/format, Packaging rows), §12.1 (SI-1, SI-2, SI-12), §22.1 (decision authority), §24.1/§24.2 (DECISION-19, H1). The steering files `.kiro/steering/{tech,structure,security,agent-loop}.md` carry the same rules.

**Phasing statement (owner instruction).** This document covers the whole of row 23 (phases P0 to P1, P5, P8 and P9.20). Every requirement carries a `Phase:` tag. **Only the requirements tagged P0 go into design and tasks first**; they are listed in "Phase scope" below. Requirements tagged P1, P4, P5, P8 or P9.20 are written so that nothing is lost, and are marked "later phase, not designed in this round". Where a requirement has both a P0 part and a later part, its criteria carry their own phase tag in brackets and only the `[P0]` criteria are designed now.

**Numbering.** Requirements 1 to 8 are the row's R1 to R8 and keep their numbers and meaning. A row requirement may be split into several criteria. Requirements 9 and up extend the row; each says why.

Boundary (out of scope, owned by other specs):
- The behavior of `wraith-node` commands (pairing, roots, doctor checks, status, agents validate) belongs to S-node-core, S-pairing-trust and the other node specs. This spec owns packaging and entry points, not command logic (see Open question OQ-22).
- Pane spawning and the respawn rule (§7.6) belong to S-node-core. This spec owns the `<bin-dir>` rule and the owner/mode check that the node applies before it spawns the sprite (Requirement 7).
- The Tauri app, its sidecar bundling and `desktop-release.yml` internals belong to S-desktop-tauri (P5); this spec owns only the node tarballs and the tap pull request step that the same workflow runs (Requirement 6).
- Schemas, `unsafe.ts` and the `protocol-codegen` hook belong to S-protocol. Crypto belongs to S-crypto. The redactor (SI-8) belongs to S-node-core.
- Creating the GitHub repository, turning on GitHub secret scanning and push protection, the first push, creating the tap repo and its token, publishing releases and merging tap pull requests are human steps (§22.1). Nothing in this spec performs them.

## Glossary

- **Ops_Package**: This spec's deliverables: workflow files, check scripts, hook files, `packages/platform`, deploy templates and CLI entry points.
- **CI_Workflow**: The file `.github/workflows/ci.yml` (§16 CI row).
- **Runner_Set**: The two GitHub-hosted runner labels `ubuntu-latest` and `macos-latest`.
- **Pinned_SHA**: A full 40-character lowercase hexadecimal Git commit SHA, written in a `uses:` reference as `owner/repo@<sha>` with the release tag in a trailing comment.
- **Pin_Check**: The script that scans workflow files and fails on a `uses:` reference that is not a Pinned_SHA. Local actions (`./`) are excluded. Proposed name `tools/check-workflow-pins.ts`.
- **Platform_Package**: The workspace package `packages/platform` (`@wraith/platform`), the only place that holds OS-specific calls (§4.10).
- **Platform_Adapter**: One implementation of the Platform_Package interface: `darwin.ts`, `linux.ts` or `win32.ts`.
- **Platform_Selector**: The function that returns the Platform_Adapter for the running platform.
- **Win32_Notice**: The sentence "Native Windows is not supported yet. Run Wraith inside WSL2: <docs link>" (§4.10).
- **Platform_Check**: The script `tools/check-platform.ts` (§4.10, P0-D7).
- **OS_Specific_Token**: Any of `process.platform`, `os.platform()`, `os.type()`, `launchctl`, `systemctl`, `chmod` or `fchmod`, `SIGHUP`, `SIGTERM`, or a `/tmp/` path literal (§4.10).
- **Scanned_Tree**: The files under `apps/` and `packages/` that the Platform_Check reads, after the exclusions of Requirement 5.
- **Secret_Scan**: The script `tools/secret-scan.ts` (proposed name) that both the `secret-scan` hook and CI call.
- **Secret_Class**: One class of secret the Secret_Scan detects: GitHub PAT, AWS key, Slack token, JWT, PEM private key, JWK with a private member `d`, VAPID private key, `SETUP_TOKEN` value and `node.key` contents (Requirement 3).
- **Pre_Commit_Hook**: The git hook file `.githooks/pre-commit`, tracked and executable, that runs the Secret_Scan in staged mode. It is active only after the owner sets `core.hooksPath` to `.githooks` (HS-3).
- **Hook_File**: A file in `.kiro/hooks/` that defines a Kiro hook.
- **P0_Hooks**: The three hooks of P0-D6: `no-trust-all`, `no-auto-approve`, `secret-scan`.
- **No_Trust_All_Hook**: architecture §12.1/§17 calls this hook no-trust-all-tools; it is named no-trust-all because the old name contains an SI-1 token.
- **Suite_Report**: The machine-readable report of one Vitest run (JSON or JUnit) written by `pnpm -r test`.
- **Required_Suites_File**: A data file, proposed `tools/required-suites.json`, listing the test files that must run, per Vitest project, with a minimum test count.
- **Suites_Check**: The script, proposed `tools/check-suites-ran.ts`, that reads the Suite_Reports and the Required_Suites_File (Requirement 11).
- **P0_D2_Suite**: `packages/crypto/test/jcs-vectors.test.ts`, in the `node` and in the `workers` Vitest project of `@wraith/crypto`.
- **P0_D3_Suites**: The four test files of S-crypto properties 6 to 9 in `packages/crypto/test/`: `sign-verify.test.ts`, `mutate-value.test.ts`, `mutate-bytes.test.ts`, `mutate-signature.test.ts`.
- **Workers_Project**: The Vitest project `workers` of `@wraith/crypto`, which runs in workerd through `@cloudflare/vitest-plugin` 1.8.2.
- **Bin_Dir**: The stable folder that holds `wraith-sprite`, given as `--bin-dir` or derived by the rule of §4.6.1.
- **Release_Target**: One of `darwin-arm64`, `darwin-x64`, `linux-x64` (§4.6.1).
- **Tap**: The separate repository `<owner>/homebrew-wraith` that holds the Homebrew formula.
- **Human_Step**: An action that §22.1 or §24 reserves to the human (creating or pushing the repository, publishing, spending money).
- **P0_Evidence**: The two-part evidence of P0-D1: local evidence (check scripts and workflow validation pass on the dev machine) and the GitHub run (green CI on both runners; human-gated).

Naming note: `tools/check-workflow-pins.ts`, `tools/secret-scan.ts`, `tools/check-suites-ran.ts` and `tools/required-suites.json` are working names (proposals). `tools/check-platform.ts` and the hook names are fixed by the architecture.

## Requirements

### Requirement 1: Bare commands on PATH

Phase: P1 (development link, `npm -g`), P5 (tarball and Homebrew PATH). Later phase, not designed in this round.
DoD: P1 deliverable "`wraith-node`, `wraith-sprite` (installable with npm -g)"; P5-D14.

**User Story:** As an operator, I want `wraith-sprite` (and `wraith-node`) to run as bare commands, so that I can start a sprite by hand for testing while the node keeps starting it by absolute path.

Implements §20 row 23 R1, §16 (Packaging row), §4.6.1, §18.2 (P1 deliverables).

#### Acceptance Criteria

1. THE Ops_Package SHALL give `apps/node` a `bin` entry `wraith-node` and `apps/sprite` a `bin` entry `wraith-sprite`. [P1]
2. WHEN `pnpm link --global` or `npm -g` installs the packages, THE shell SHALL resolve `wraith-node` and `wraith-sprite` as bare commands. [P1]
3. THE node SHALL start the sprite by the absolute path `<bin-dir>/wraith-sprite` and SHALL NOT rely on PATH lookup (Requirement 7). [P1]
4. WHEN the release tarball is unpacked, THE `bin/` folder SHALL contain `wraith-node` and `wraith-sprite` so that putting `bin/` on PATH makes both bare commands. [P5]
5. THE Ops_Package SHALL leave the command logic of every `wraith-node` subcommand to the owning specs (Open question OQ-22).

### Requirement 2: CI on every pull request

Phase: P0 (lint, typecheck, build, unit/PBT tests, platform check), P1 (conformance, E2E on Linux). The P1 part is later phase, not designed in this round.
DoD: P0-D1 (and supports P0-D2, P0-D3, P0-D7).

**User Story:** As a maintainer, I want one workflow that proves the repository builds and tests on Linux and macOS, so that a broken commit is visible before it is merged.

Implements §20 row 23 R2, §16 (CI row, Lint/format row), §18.1 (P0 scope "CI", P0-D1), SI-12.

#### Acceptance Criteria

1. THE CI_Workflow SHALL exist at `.github/workflows/ci.yml`. [P0]
2. WHEN a pull request is opened or updated, or a commit is pushed to the default branch, THE CI_Workflow SHALL run. [P0]
3. THE CI_Workflow SHALL run its job on each runner of the Runner_Set (`ubuntu-latest` and `macos-latest`) as a matrix. [P0]
4. THE CI_Workflow SHALL use Node 22 on both runners (`.nvmrc` holds `22`). [P0]
5. THE CI_Workflow SHALL install pnpm 9.15.0, the version in the `packageManager` field of the root `package.json`, with the command `npm install -g pnpm@9.15.0` in a step after `actions/setup-node`, SHALL use no third-party pnpm action and no corepack, and SHALL install dependencies with `pnpm install --frozen-lockfile` (Open question OQ-10, resolved). [P0]
6. THE CI_Workflow SHALL run a step after the pnpm installation that prints the installed pnpm version and SHALL fail the job when that version differs from the `packageManager` version. [P0]
7. THE CI_Workflow SHALL run, in this order, on each runner: lint (Biome, `biome check .`), typecheck (`tsc -b`), `pnpm -r build`, `pnpm -r test`, `tools/check-platform.ts`, the Secret_Scan on the whole tracked tree (Requirement 3 criterion 10), the Pin_Check and the Suites_Check. [P0]
8. WHEN any step fails on any runner, THE CI_Workflow SHALL fail the run (no `continue-on-error`). [P0]
9. THE `pnpm -r test` step SHALL run both Vitest projects of `@wraith/crypto`, the `node` project and the Workers_Project, on both runners. [P0]
10. THE CI_Workflow SHALL grant the `GITHUB_TOKEN` only `contents: read`, at workflow level, and SHALL declare no other permission. [P0]
11. THE CI_Workflow SHALL use no repository secret, no environment, no deployment step and no `git push`. [P0]
12. THE CI_Workflow SHALL include no step that is skipped on an unreleased fork or on any event other than the two of criterion 2. [P0]
13. THE CI_Workflow SHALL set a `concurrency` group per ref that cancels superseded runs, to limit runner minutes. [P0]
14. THE CI_Workflow SHALL run on the free standard runners only (no larger runner label, no paid add-on) so that no GitHub Actions spend arises (agent-loop stop condition 6; Open question OQ-11). [P0]
15. WHEN the packages `relay-core` and `fakes` have conformance and integration suites, THE CI_Workflow SHALL also run them, and WHEN E2E tests exist (P1), THE CI_Workflow SHALL run them on Linux. [P1]
16. THE CI_Workflow SHALL be valid YAML, SHALL pass the Pin_Check, and SHALL be checked by a test in `pnpm -r test` that parses it and asserts criteria 3, 4, 7, 10 and 11 (no network needed). [P0]
17. WHERE a workflow linter such as actionlint can be installed without a human step, THE Ops_Package SHALL run it locally and in CI (Open question OQ-12). [P0]

### Requirement 3: `secret-scan` hook

Phase: P0.
DoD: P0-D6 (secret-scan part). Supports S-crypto tasks 5.5 and 10.3 (the vectors file must pass), S-protocol Requirement 23 criterion 9.

**User Story:** As the owner of a public repository, I want a commit that contains a secret to be rejected, so that no PAT, private key or token ever reaches git (SI-12, DECISION-19).

Implements §20 row 23 R3, §12.1 SI-12 ("hook `secret-scan`"), §16 (Lint/format row: "commit hook `secret-scan` (gitleaks)"; deviation note: the architecture row names gitleaks, and the owner chose the in-house Secret_Scan as the only scanner for P0, Open question OQ-4, resolved), §17 (hooks list), §18.1 (P0 scope, P0-D6), §24.1 DECISION-19.

#### Acceptance Criteria

1. THE Ops_Package SHALL provide a Secret_Scan script written in TypeScript that reads the text of the files it is given and reports every match with file, line and Secret_Class, and SHALL NOT print the matched secret (SI-12). [P0]
2. WHEN a file, a staged file or a changed file contains a match of a Secret_Class, THE Secret_Scan SHALL exit non-zero. [P0]
3. THE Secret_Scan SHALL detect these Secret_Classes: GitHub tokens (`ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`, `github_pat_`), AWS access key ids, Slack tokens, JWTs (three base64url parts, the first two decoding to JSON), PEM private key blocks (`-----BEGIN ... PRIVATE KEY-----`), a JWK that has an EC private member `d`, a VAPID private key, a `SETUP_TOKEN` assignment with a value, and the content form of `node.key` (a JWK with `d`). [P0]
4. THE Secret_Scan SHALL accept a mode that scans the staged files, a mode that scans the files changed against a base ref, a mode that scans the whole tracked tree, and a mode that scans paths given on the command line. [P0]
5. THE Secret_Scan SHALL pass on the real tree, including `fixtures/crypto/known-answers.json`, which holds public JWKs, test vectors, patterned artificial HMAC secrets and RFC 4231 values and no private key (P0-D6 supports S-crypto tasks 5.5 and 10.3). [P0]
6. THE Ops_Package SHALL include a test, run by `pnpm -r test`, with at least one sample that the Secret_Scan MUST catch for each Secret_Class and at least one sample that MUST pass for each Secret_Class (a public JWK without `d`, a placeholder token such as `ghp_xxxxxxxx`, an RFC 4231 value, a PEM public key). [P0]
7. THE samples of criterion 6 SHALL be assembled at test time from fragments and written to a temporary file that the test deletes in `finally`, so that no committed file contains a complete secret-shaped value (GitHub push protection and the Secret_Scan itself must not flag the repository; Open question OQ-6). [P0]
8. THE test of criterion 6 SHALL also run the Secret_Scan on `fixtures/crypto/known-answers.json` and assert that it passes. [P0]
9. THE `secret-scan` Hook_File SHALL exist in `.kiro/hooks/` and SHALL run the Secret_Scan on the files in play (Open questions OQ-3 and OQ-4). [P0]
10. THE CI_Workflow SHALL run the Secret_Scan on the whole tracked tree, so that a commit made without the Kiro hook is still caught. [P0]
11. THE Ops_Package SHALL use the in-house Secret_Scan as the only secret scanner in P0 and SHALL add no gitleaks step, install or config file in P0 (owner decision, Open question OQ-4, resolved; gitleaks is out of P0). [P0]
12. THE Secret_Scan SHALL NOT read `node_modules`, `dist` or `.git`. [P0]
13. THE Secret_Scan SHALL write no secret, matched text or file content to any log or error message (SI-12). [P0]
14. IF the Secret_Scan cannot read a file it was asked to scan, THEN THE Secret_Scan SHALL exit non-zero and name the path (fail closed). [P0]
15. THE Ops_Package SHALL provide the Pre_Commit_Hook at `.githooks/pre-commit`, tracked by git, with the executable mode bit set, that runs the Secret_Scan in staged mode. [P0]
16. IF the Secret_Scan exits non-zero, or cannot be started, or the Pre_Commit_Hook cannot read a staged file, THEN THE Pre_Commit_Hook SHALL exit non-zero so that git blocks the commit (fail closed). [P0]
17. THE Pre_Commit_Hook SHALL print no secret, matched text or file content, and SHALL print only file, line and Secret_Class (SI-12). [P0]
18. THE Ops_Package SHALL include a test, run by `pnpm -r test`, that creates a temporary git repository, stages a sample file assembled at test time from fragments (Requirement 3 criterion 7) and asserts that the Pre_Commit_Hook exits non-zero, then stages a clean file and asserts that it exits zero, and deletes the repository in `finally`. [P0]
19. THE `secret-scan` Hook_File of criterion 9 SHALL remain as the in-Kiro guard, and THE Pre_Commit_Hook SHALL guard commits made outside Kiro; neither SHALL replace the CI run of criterion 10. [P0]
20. THE Ops_Package SHALL NOT set any git configuration; the owner activates the Pre_Commit_Hook once by running `git config core.hooksPath .githooks` (HS-3). [P0]

### Requirement 4: Service units and herdr-core start

Phase: P8 (row 23); §11.3 marks the `service` script as P1 (Open question OQ-21). Later phase, not designed in this round.
DoD: P5-D15 (after reboot), P5-D16 (restart keeps panes), P8.

**User Story:** As a headless-machine owner, I want `wraith-node service install` to start the node at login and across reboots, so that bots come back without me.

Implements §20 row 23 R4, §11.3 (`service install|uninstall|status|restart`), §3.4 item 8 step 4, §4.10 (service unit in the platform layer), §4.6.1 (no `brew services`), Q14.

#### Acceptance Criteria

1. WHEN `wraith-node service install` runs on macOS, THE node SHALL create a launchd LaunchAgent that starts `wraith-node` at login and keeps it across reboots. [P8]
2. WHEN `wraith-node service install` runs on Linux, THE node SHALL create a systemd user unit that starts `wraith-node` at login and across reboots. [P8]
3. THE unit SHALL run the node with a stable path and `--bin-dir` (Homebrew: the `opt` link). [P8]
4. WHEN the herdr-core socket is missing at node start, THE node SHALL start herdr-core. [P8]
5. WHEN `service install` runs on Linux, THE node SHALL run `loginctl enable-linger $USER`, or print the command when it needs sudo, and `doctor` SHALL check `Linger=yes`. [P8]
6. WHEN `service install` runs on macOS, THE `doctor` command SHALL say whether automatic login or a manual login after reboot is needed. [P8]
7. WHEN `wraith-node service restart` runs, THE node SHALL leave every pane running in herdr-core (§7.6). [P8]
8. WHEN `wraith-node service uninstall` runs, THE node SHALL remove the unit and leave `~/.wraith` untouched. [P8]
9. THE service code SHALL live only in the Platform_Package (§4.10), and the unit templates SHALL live in `deploy/launchd/` and `deploy/systemd/`. [P8]

### Requirement 5: `tools/check-platform.ts` (Platform_Check)

Phase: P0.
DoD: P0-D7 (also supports P0-D1).

**User Story:** As a maintainer, I want CI to fail when OS-specific code appears outside `packages/platform`, so that a later Windows port touches one package.

Implements §20 row 23 R5, §4.10 ("CI check `tools/check-platform.ts`"), §17 (dependency rules), §18.1 (P0-D7), DECISION-59.

#### Acceptance Criteria

1. THE Platform_Check SHALL exist at `tools/check-platform.ts` and SHALL run with Node 22 and `--experimental-strip-types`, like the existing check scripts. [P0]
2. IF any file in the Scanned_Tree contains an OS_Specific_Token (`process.platform`, `os.platform()`, `os.type()`, `launchctl`, `systemctl`, `chmod`, `fchmod`, `SIGHUP`, `SIGTERM`, or a `/tmp/` path literal), THEN THE Platform_Check SHALL exit non-zero and print file, line and token. [P0]
3. THE Scanned_Tree SHALL be every file under `apps/` and `packages/` except: files under `packages/platform`, test files, files under `packages/fakes`, and build output and dependencies (`dist`, `node_modules`, `generated`). THE folders `spike/` and `tools/` are outside `apps/` and `packages/` and SHALL NOT be scanned (§4.10: "tests, `spike/`, `tools/` and `packages/fakes` excluded"; Open question OQ-14). [P0]
4. WHERE a file is under `apps/desktop/src-tauri`, THE Platform_Check SHALL allow `#[cfg(target_os …)]` only in `src/platform.rs` and SHALL fail on it in any other Rust file of that folder (§4.10). [P5] (The folder does not exist yet; Open question OQ-15.)
5. THE Platform_Check SHALL ignore a token that appears only in a comment, and SHALL match tokens that appear inside string and template literals, because `launchctl`, `systemctl` and `/tmp/` are usually spelled in strings (Open question OQ-13).
6. THE Platform_Check SHALL fail on a sample file placed outside `packages/platform` that uses `process.platform`, and SHALL fail on a sample file outside `packages/platform` that uses `SIGHUP`; each sample SHALL be checked by a test in `pnpm -r test` (P0-D7). [P0]
7. THE Platform_Check SHALL have a test that asserts one failing sample for every OS_Specific_Token and one passing sample for a file under `packages/platform` that uses the same tokens. [P0]
8. THE Platform_Check SHALL pass on the real tree of this repository (P0-D7). [P0]
9. THE CI_Workflow SHALL run the Platform_Check on each runner (§4.10: "run in `ci.yml` lint"). [P0]
10. THE Platform_Check SHALL report every violation before exiting, not only the first. [P0]

### Requirement 6: Release tarballs and the tap pull request

Phase: P5. Later phase, not designed in this round.
DoD: P5-D6, P5-D14, P5-D16.

**User Story:** As an operator without the desktop app, I want a tarball per target and a Homebrew formula, so that I can install `wraith-node` and `wraith-sprite` on a headless machine.

Implements §20 row 23 R6, §4.6.1 (install channels, the tap rules, the token), §16 (CI and Packaging rows), §22.1 (publishing is human-gated).

#### Acceptance Criteria

1. WHEN a `v*` tag is pushed, THE release workflow SHALL build `wraith-node-<v>-<target>.tar.gz` for every Release_Target (`darwin-arm64`, `darwin-x64`, `linux-x64`). [P5]
2. THE tarball SHALL contain `bin/wraith-node`, `bin/wraith-sprite`, `LICENSE` and `THIRD_PARTY.md`. [P5]
3. THE release workflow SHALL attach every tarball and a `SHA256SUMS` file to a draft release. [P5]
4. THE release workflow SHALL ad-hoc sign the macOS binaries (`codesign --sign -`). [P5]
5. WHEN the owner publishes the draft release (`release: published`), THE tap job SHALL fill in version and SHA-256 from `deploy/homebrew/wraith-node.rb.tmpl` and open a pull request on the Tap: on `main` for a normal release, on a `test` branch for a prerelease tag (`v*-test`, `v*-rc*`). [P5]
6. THE tap job SHALL use the fine-grained `HOMEBREW_TAP_TOKEN` stored in the GitHub Environment `tap`, which requires the owner's approval for each run. [P5]
7. THE formula SHALL contain no `service do` block, and its caveats SHALL name `wraith-node service install` and, after `brew upgrade`, `wraith-node service restart`. [P5]
8. THE release workflow SHALL pin every third-party action by Pinned_SHA (Requirement 10) and SHALL declare the least permission each job needs. [P5]
9. THE Ops_Package SHALL NOT publish a release, merge a tap pull request, create the Tap or create the token; these are Human_Steps. [P5]
10. THE tarball layout SHALL follow the Q24b result in `docs/spikes/RESULTS.md`. [P5]

### Requirement 7: Sprite start path and `<bin-dir>` check

Phase: P1 (the rule and check), P5 (Wraith.app and Homebrew set `--bin-dir`). Later phase, not designed in this round.
DoD: P1-D9 (respawn), P5-D16.

**User Story:** As the owner, I want the node to start only a sprite binary from a folder that other users cannot write, so that another process cannot swap the sprite.

Implements §20 row 23 R7, §4.6.1 ("Sprite path across upgrades"), §11.3 (`--bin-dir`), §4.10 (file mode checks), §7.6.

#### Acceptance Criteria

1. THE node SHALL start `wraith-sprite` from `<bin-dir>/wraith-sprite`, where `<bin-dir>` is the `--bin-dir` given at start, or else the default of §4.6.1. [P1]
2. WHERE no `--bin-dir` is given, THE node SHALL use the folder of `process.execPath` for a single-file build, and the `bin/` folder of its own package (`realpath(process.argv[1])`) for a JS run. [P1]
3. IF `<bin-dir>` or `<bin-dir>/wraith-sprite` is writable by group or others, or is owned by a user other than the node user or root, THEN THE node SHALL refuse to spawn, SHALL mark the bot `failed` with the reason shown, and `doctor` SHALL name the path. [P1]
4. THE owner and mode check SHALL be implemented in the Platform_Package. [P1]
5. WHEN `service install` or Wraith.app starts the node, THE caller SHALL pass a `--bin-dir` that survives upgrades (Homebrew: `$(brew --prefix)/opt/wraith-node/bin`; Wraith.app: the bundle's `Contents/MacOS`; tarball: the unpacked `bin/`). [P5]
6. THE pane-manager and `doctor` SHALL use the same rule. [P1]

### Requirement 8: Native Windows notice and WSL2

Phase: P0 (stub Platform_Adapter), P1 (entry points print the notice), P9.20 (WSL2 support). The P1 and P9.20 parts are later phase, not designed in this round.
DoD: P0 skeleton (§18.1 "win32 stub"); P9.20 DoD when that phase starts.

**User Story:** As a Windows user, I want a clear message that tells me to use WSL2, so that I do not run an unsupported native build.

Implements §20 row 23 R8, §4.10 ("`win32.ts` is a stub until P9.21"), DECISION-59.

#### Acceptance Criteria

1. THE Platform_Package SHALL contain a `win32.ts` Platform_Adapter that is a stub. [P0]
2. WHEN the Platform_Selector runs with the platform mocked to `win32`, THE Platform_Selector SHALL return the `win32` Platform_Adapter, and the stub SHALL expose the Win32_Notice text and an exit code of 1 for the entry points to use. [P0]
3. WHILE running on native Windows before P9.21, THE `wraith-node` and `wraith-sprite` entry points SHALL print the Win32_Notice and exit 1. [P1]
4. THE Win32_Notice SHALL read "Native Windows is not supported yet. Run Wraith inside WSL2: <docs link>" with the docs link replaced by the real address (Open question OQ-20). [P0]
5. THE Ops_Package SHALL publish no Windows build before P9.21. [P1]
6. WHEN `wraith-node` runs inside WSL2 (P9.20), THE `linux` Platform_Adapter SHALL report `isWsl()` true and SHALL behave as on Linux. [P9.20]
7. THE `docs/` folder SHALL contain a WSL2 install page that the Win32_Notice links to. [P9.20]

### Requirement 9: `packages/platform` skeleton (extends the row)

Phase: P0.
DoD: P0-D7 (supports), P0-D1.
Why it extends the row: R5 and R8 refer to `packages/platform`, but no row requirement creates it. §18.1 lists "`packages/platform` skeleton (`darwin`, `linux`, `win32` stub)" in P0 scope.

**User Story:** As a maintainer, I want the platform package to exist with its adapters and selector now, so that later OS-specific code has one place to go and the Platform_Check has a package to exempt.

Implements §4.10, §17 (`packages/platform`), §18.1 (P0 scope).

#### Acceptance Criteria

1. THE Platform_Package SHALL exist at `packages/platform` as the workspace package `@wraith/platform`, ESM, with `build` and `test` scripts. [P0]
2. THE Platform_Package SHALL contain the adapters `darwin.ts`, `linux.ts` and `win32.ts` behind one interface (§4.10). [P0]
3. THE Platform_Package SHALL export a Platform_Selector that returns the adapter for the value of `process.platform` (`darwin`, `linux`, `win32`), and SHALL throw a Programmer_Error naming the unsupported platform for any other value. [P0]
4. THE Platform_Selector SHALL take the platform as an optional parameter so that a unit test can select each adapter without changing the real platform, and the unit test SHALL assert that `darwin`, `linux` and `win32` select their own adapter and that another value (such as `freebsd`) is refused. [P0]
5. THE Platform_Package SHALL record in its README the list of OS-specific calls it will own (§4.10): local IPC for `sprite.sock` and `control.sock` with the 0600 file and 0700 folder checks; creation of files that hold secrets with mode 0600 and the mode check before reading; the login environment capture (`$SHELL -l`) and finding a command on PATH; the service unit (`service install|uninstall|status|restart`); process control (signals, killing a process tree, the sprite's "pane lost" signals SIGHUP and SIGTERM and TTY read error, exit 75); paths (`~/.wraith`, temp files) and opening a URL in the browser. [P0]
6. THE P0 interface SHALL contain only what the selector and the stub need (Open question OQ-19); the call groups of criterion 5 are added in P1 together with their first caller. [P0]
7. THE Platform_Package SHALL depend on no package other than `@types/node` as a development dependency, and on no workspace package (Open question OQ-18). [P0]
8. THE Platform_Package SHALL be added to the `references` of the root `tsconfig.json` so that `tsc -b` builds it, and SHALL pass Biome. [P0]
9. THE Platform_Package SHALL be the only package that the Platform_Check exempts (Requirement 5). [P0]
10. THE `linux` adapter SHALL provide `isWsl()`; its P0 body MAY return `false` (full detection is P9.20). [P0]

### Requirement 10: Workflow actions pinned by commit SHA (extends the row)

Phase: P0.
DoD: P0-D1 (supports).
Why it extends the row: row R2 asks for CI; the pinning rule and its check come from the P0 instruction of the owner. A `uses:` reference that follows a moving tag lets an upstream change run in the repository's CI.

**User Story:** As the owner of a public repository, I want every third-party action pinned to a commit, so that CI never runs code I did not review.

Implements §16 (CI row), SI-12 (supply chain; no secret in CI), §22.1.

#### Acceptance Criteria

1. THE CI_Workflow and every other workflow file in `.github/workflows/` SHALL reference each third-party action as `owner/repo@<Pinned_SHA>` with the release tag in a trailing comment (`# v4.1.1`). [P0]
2. THE Pin_Check SHALL scan every `*.yml` and `*.yaml` file in `.github/workflows/` and SHALL exit non-zero on a `uses:` value that is not a Pinned_SHA. [P0]
3. THE Pin_Check SHALL exclude a local action or reusable workflow reference that starts with `./`. [P0]
4. IF a `uses:` value ends in a branch name, a tag, a short SHA or an uppercase SHA, THEN THE Pin_Check SHALL fail and name the file and line. [P0]
5. THE Pin_Check SHALL fail on a `uses: docker://` reference that has no `@sha256:` digest. [P0]
6. THE Pin_Check SHALL include a test, run by `pnpm -r test`, with failing samples for a tag, a branch, a 7-character SHA and a 39-character SHA, and passing samples for a 40-hex SHA and a `./` path. [P0]
7. THE CI_Workflow SHALL run the Pin_Check. [P0]
8. THE Pin_Check SHALL ignore `uses:` text inside YAML comments. [P0]
9. THE Pinned_SHA values SHALL be copied from the action's official release (the SHA of the tagged commit) when the workflow is written, and the task that writes them SHALL record the tag next to each. [P0]

### Requirement 11: The P0-D2 and P0-D3 suites actually ran (extends the row)

Phase: P0.
DoD: P0-D1 ("an empty test run does not count"), supports P0-D2, P0-D3.
Why it extends the row: P0-D1 says the P0-D2/P0-D3 suites "exist and run (an empty test run does not count)", and no row requirement checks it.

**User Story:** As the owner of the P0 definition of done, I want CI to fail when the signature and JCS suites ran zero tests, so that a green run is never an empty one.

Implements §18.1 (P0-D1), S-crypto Requirements 12 and 13 (P0-D2, P0-D3 suites).

#### Acceptance Criteria

1. THE `pnpm -r test` step SHALL write one Suite_Report per package that has a `test` script, in a machine-readable format, without changing the pass or fail result of the step (Open question OQ-7). [P0]
2. THE Suites_Check SHALL read the Suite_Reports and the Required_Suites_File and SHALL exit non-zero when a listed test file is missing from a report. [P0]
3. THE Suites_Check SHALL exit non-zero when a listed test file ran fewer passing tests than its `minTests` in a listed Vitest project. [P0]
4. THE Suites_Check SHALL exit non-zero when any test of a listed file is skipped, `todo` or excluded by `.only` (`it.skip`, `describe.skip`, `it.todo`, `it.only`). [P0]
5. THE Required_Suites_File SHALL list `packages/crypto/test/jcs-vectors.test.ts` (the P0_D2_Suite) for the projects `node` and `workers`. [P0]
6. THE Required_Suites_File SHALL list `sign-verify.test.ts`, `mutate-value.test.ts`, `mutate-bytes.test.ts` and `mutate-signature.test.ts` of `packages/crypto/test/` (the P0_D3_Suites) for the project `node`, and for `workers` as well (Open question OQ-8). [P0]
7. THE Suites_Check SHALL hold a minimum list in its own code (the P0_D2_Suite and the P0_D3_Suites with `minTests` 1) and SHALL fail when the Required_Suites_File lacks an entry of that list or lowers a `minTests` below it; the file may add entries and raise counts. This makes a silent hand-edit of the file fail (Open question OQ-8). [P0]
8. THE Suites_Check SHALL have a test with a sample report for each failure: a missing file, a file with zero tests, a file with a skipped test, a file present in `node` but missing in `workers`, and an empty report; and a passing sample. [P0]
9. THE Vitest configuration of every package SHALL leave `passWithNoTests` off (the Vitest default), and the Suites_Check SHALL fail when a package that has a `test` script produced no Suite_Report. [P0]
10. THE CI_Workflow SHALL run the Suites_Check on each runner after `pnpm -r test`. [P0]
11. THE Suites_Check SHALL print the counts per file and project, so that the CI log is the evidence for `docs/PHASE-STATUS.md`. [P0]
12. WHEN the test count of the P0_D2_Suite or the P0_D3_Suites in a project is zero because that file is excluded from the project by name (for example `*.node.test.ts`), THEN THE Required_Suites_File SHALL NOT list the file for that project. [P0]

### Requirement 12: The three P0 hooks and P0-D6 (extends the row)

Phase: P0.
DoD: P0-D6.
Why it extends the row: P0-D6 needs all three hooks; row R3 names only `secret-scan`. The architecture does not name an owner for the other two (Open question OQ-1).
Dependency: the two SI hooks need `packages/protocol/src/unsafe.ts`, delivered by S-protocol tasks 14.1 and 14.2 (Open question OQ-2, resolved).

**User Story:** As the owner, I want the SI-1 and SI-2 hooks and the secret scan to exist and to catch sample violations, so that the agent loop cannot commit an auto-approve path or an unsafe flag unnoticed.

Implements §18.1 (P0 scope, P0-D6), §12.1 (SI-1 "grep hook `no-auto-approve`", SI-2 "Kiro hook `no-trust-all`", SI-12 "hook `secret-scan`"), §17 (hooks list), §20 row 1 R4 and S-protocol Requirement 21 (token ownership).

#### Acceptance Criteria

1. THE `.kiro/hooks/` folder SHALL contain a Hook_File for each of the P0_Hooks before P0-D6 is marked `pass`. [P0]
2. WHILE any of the P0_Hooks lacks a Hook_File or a passing sample test, THE `docs/PHASE-STATUS.md` row P0-D6 SHALL remain `todo`. [P0]
3. THE `no-auto-approve` hook SHALL enforce the SI-1 rule of §12.1: outside `packages/protocol`, product code contains no `by: "autopilot"` (additionally allowed in `apps/node/src/autopilot/`, and only that token), no `approval.answer` or `approval.respond` with an `allow_*` option built without a verified device member, and none of `bypassPermissions`, `acceptEdits`, `dontAsk`, `permissionMode` with a value other than `default`, `trust-all-tools`, `trust-tools=*`, `WRAITH_AUTO_APPROVE`, or `NODE_ENV === "test"` next to `allow`. [P0]
4. THE `no-trust-all` hook SHALL fail on `--trust-all-tools`, `--trust-tools=*` and the equivalent flags of other agents named in SI-2 in product code, and SHALL NOT apply to the repo's `.kiro/agents` build agents (§12.1 SI-2). [P0]
5. THE definition of "product code" SHALL be everything except `**/test/**`, `*.test.ts`, `packages/fakes`, `spike/` and `fixtures/` (§12.1). [P0]
6. THE P0_Hooks SHALL spell the forbidden tokens only by importing them from `packages/protocol/src/unsafe.ts`, since SI-1 allows the tokens only in `unsafe.ts` and the Claude guard template and there is no other exempt folder (Open question OQ-2, resolved). [P0]
7. THE Ops_Package SHALL include a test per P0 hook with at least one sample file per pattern class that MUST be caught and samples that MUST pass (P0-D6: "one per pattern class"). [P0]
8. THE samples of criterion 7 SHALL be assembled at test time and SHALL NOT be committed as files that spell the tokens (Open question OQ-2, resolved). [P0]
9. THE `protocol-codegen` hook belongs to S-protocol (Requirement 23 criterion 7), and the `test-on-save` and `fixture-redact-check` hooks are not part of P0-D6; THE Ops_Package SHALL NOT create them in this round. [P0]
10. THE two SI hooks (`no-trust-all`, `no-auto-approve`) SHALL be built only after S-protocol tasks 14.1 and 14.2 (`packages/protocol/src/unsafe.ts` and its property test, both done in full and ticked) are committed as a separate S-protocol commit before any S-ops-packaging coding, the same way the JWK schema was committed first; the `secret-scan` hook has no such dependency. [P0]

### Requirement 13: P0-D1 evidence and human gating (extends the row)

Phase: P0.
DoD: P0-D1.
Why it extends the row: CI cannot be seen green until the repository is pushed, which is a human step; the evidence rule must be explicit.

**User Story:** As the owner, I want the status file to show exactly what has been proven, so that P0-D1 is not marked `pass` on local evidence alone.

Implements §18.1 (P0-D1, P0 Human), §22.1, §22.5 (status files), DECISION-19, H1.

#### Acceptance Criteria

1. THE P0_Evidence of P0-D1 SHALL have part (a), local evidence: the workflow validation of Requirement 2 criterion 16, the Pin_Check, the Platform_Check, the Secret_Scan and the Suites_Check pass on the dev machine, and `pnpm -r build`, `pnpm -r test` and `tsc -b` pass locally. [P0]
2. THE P0_Evidence of P0-D1 SHALL have part (b), the GitHub run: a green CI_Workflow run on `ubuntu-latest` and `macos-latest`, linked or logged in `docs/PHASE-STATUS.md`. Part (b) is human-gated (Human steps). [P0]
3. WHILE part (b) is missing, THE `docs/PHASE-STATUS.md` row P0-D1 SHALL stay `todo` and its evidence column SHALL record part (a). [P0]
4. THE Ops_Package (workflows, scripts, hooks and the agent loop) SHALL NOT run `git push` or `gh repo create` and SHALL NOT publish the repository or any artifact. Commits made by the loop with explicitly listed files (`git add <file>…` then `git commit`) remain allowed, because that is how this project works. [P0]
5. THE Ops_Package SHALL record in `docs/PHASE-STATUS.md` which runner has run the Workers_Project (Open question OQ-9). [P0]
6. IF the Workers_Project fails on a runner, THEN THE evidence SHALL record the runner, the versions and the error, THE row P0-D1 SHALL stay `todo`, and the loop SHALL NOT drop the Workers_Project from the run (S-crypto Requirement 12 criterion 6). [P0]

### Requirement 14: Docker image workflow for `wraith-relay`

Phase: P4 (§4.6.1). Later phase, not designed in this round (Open question OQ-23).
DoD: P4.

**User Story:** As a self-hoster, I want a Docker image of `wraith-relay`, so that I can run the relay on a server.

Implements §20 row 23 key notes ("Docker"), §16 (CI row: `relay-docker.yml`), §4.6.1 (Docker `wraith-relay`, linux/amd64 and linux/arm64, phase P4).

#### Acceptance Criteria

1. THE Ops_Package SHALL provide `.github/workflows/relay-docker.yml` that builds the `wraith-relay` image for `linux/amd64` and `linux/arm64` from `deploy/docker/`. [P4]
2. THE workflow SHALL pin every third-party action by Pinned_SHA and SHALL declare least permissions. [P4]
3. THE workflow SHALL NOT push an image to a registry without a Human_Step approval (§22.1: publishing to Docker Hub is human-gated). [P4]

### Requirement 15: Headless machine install path

Phase: P5. Later phase, not designed in this round.
DoD: P5-D15.

**User Story:** As the owner of a Mac mini or Linux GPU box, I want to install and run a node over SSH with no browser, so that the machine appears on my phone and survives reboot.

Implements §3.4 item 8, §20 row 23 (phase P5 "headless"), §4.6.1.

#### Acceptance Criteria

1. THE Ops_Package SHALL document in `docs/self-host.md` the headless steps of §3.4 item 8: install the node by Homebrew or tarball, install herdr-core and an agent CLI, run `wraith-node init` and `wraith-node doctor`, join through `wraith-node pair <relay-url> <ticketId>`, then `wraith-node service install`. [P5]
2. THE Ops_Package SHALL document the Local-mode SSH tunnel of §3.4 item 8 step 5 (port 7777) as a secondary path. [P5]
3. WHEN the headless Linux machine reboots with no user logged in, THE node SHALL be running again (linger on, Requirement 4 criterion 5). [P5]

## Phase scope

Only the P0 rows are designed and tasked first. Every other row is written and marked "later phase, not designed in this round".

| Requirement | Title | DoD ids | Phase | Designed in this round |
|---|---|---|---|---|
| 1 | Bare commands on PATH | P1 deliverable, P5-D14 | P1, P5 | No |
| 2 | CI on every pull request | P0-D1 | P0 (criteria 1 to 14, 16, 17), P1 (criterion 15) | Yes (P0 criteria) |
| 3 | `secret-scan` hook | P0-D6 | P0 | Yes |
| 4 | Service units and herdr-core start | P5-D15, P5-D16, P8 | P8 (§11.3 says P1 script) | No |
| 5 | `tools/check-platform.ts` | P0-D7 | P0 (criterion 4: P5) | Yes (P0 criteria) |
| 6 | Release tarballs and tap pull request | P5-D6, P5-D14, P5-D16 | P5 | No |
| 7 | Sprite start path and `<bin-dir>` check | P1-D9, P5-D16 | P1, P5 | No |
| 8 | Native Windows notice and WSL2 | P0 skeleton, P9.20 | P0 (criteria 1, 2, 4), P1 (3, 5), P9.20 (6, 7) | Yes (P0 criteria) |
| 9 | `packages/platform` skeleton (extends) | P0-D7, P0-D1 | P0 | Yes |
| 10 | Workflow actions pinned by SHA (extends) | P0-D1 | P0 | Yes |
| 11 | P0-D2/P0-D3 suites actually ran (extends) | P0-D1 | P0 | Yes |
| 12 | The three P0 hooks and P0-D6 (extends) | P0-D6 | P0 | Yes |
| 13 | P0-D1 evidence and human gating (extends) | P0-D1 | P0 | Yes |
| 14 | Docker image workflow | P4 | P4 | No |
| 15 | Headless machine install path | P5-D15 | P5 | No |

P0-tagged requirements: 2, 3, 5, 8 (part), 9, 10, 11, 12, 13.

DoD coverage by the P0 requirements: P0-D1 by 2, 10, 11, 13; P0-D6 by 3, 12; P0-D7 by 5, 9.

## Out of scope

Not designed in this round (written above as later-phase requirements, or not at all):
- The `wraith-node` and `wraith-sprite` entry-point logic and bare-command packaging (Requirement 1), release tarballs and checksums (6), the Homebrew formula and the tap job (6), Docker (14), launchd and systemd units, linger and the herdr-core start (4), headless install (15), the `<bin-dir>` check (7), the entry-point Win32_Notice and WSL2 (8: P1 and P9.20 parts), conformance and E2E steps of CI (2.15).
- `desktop-release.yml` (S-desktop-tauri, P5), the Homebrew cask (P9.9), winget and Scoop (P9.21), native Windows (P9.21).
- The hooks `protocol-codegen` (S-protocol), `test-on-save` and `fixture-redact-check` (no owner named; Open question OQ-1).
- Any change to `packages/protocol`, `packages/crypto`, `docs/` or any other existing file by this spec's P0 design is limited to what the P0 requirements name (root `tsconfig.json` references, root workflow and script wiring, `docs/PHASE-STATUS.md` status rows).
- Native Windows adapters, a Windows build, code signing (H12).

## Human steps (open items)

Recorded, not performed. Nothing in this spec pushes (§22.1).

| id | Step | Source | Needed before |
|---|---|---|---|
| HS-1 | Create the GitHub repository `github.com/<user>/wraith`, public, owner = the account logged in to `gh` (H1: name, owner, visibility; answered 2026-11-02). No git remote exists today. | §24.2 H1, §18.1 Entry | any push |
| HS-2 | Turn on GitHub secret scanning and push protection on that repository **before the first push** (DECISION-19). | §18.1 P0 scope, DECISION-19 | the first push |
| HS-3 | Run `git config core.hooksPath .githooks` once on the machine that pushes, so that the Pre_Commit_Hook is active; confirm that the Kiro `secret-scan` hook is present (Requirement 3 criteria 15 to 20). The Ops_Package never sets git config. | DECISION-19, H1 | the first push |
| HS-4 | The first push. | §22.1 | P0-D1 part (b) |
| HS-5 | Look at the first CI run on both runners and confirm it is green; paste or approve the evidence for `docs/PHASE-STATUS.md`. | P0-D1 | marking P0-D1 `pass` |
| HS-6 | P5: create the tap repo `<owner>/homebrew-wraith` with protected `main`, create `HOMEBREW_TAP_TOKEN`, create the Environment `tap`, publish the draft release, approve the tap job, merge the tap pull request. | §18 P5 Human, §4.6.1 | P5-D14 |
| HS-7 | P4: approve publishing a Docker image (Docker Hub or other registry). | §22.1 | P4 |

P0-D1 evidence therefore has two parts: (a) local evidence, available now; (b) the GitHub run, available only after HS-1 to HS-4 (Requirement 13).

## Open questions

None open. Every question is resolved; see Resolved decisions below. Requirement text that cites an OQ id points to that table.

## Facts verified from the repository

Checked on 2026-11-15 (read-only).

- `.kiro/hooks/` holds only `.gitkeep`. `.kiro/agents/` and `.kiro/settings/` hold only `.gitkeep`. `.kiro/steering/` has `agent-loop.md`, `product.md`, `security.md`, `structure.md`, `tech.md`, `ux-theme.md`. `.kiro/specs/` has `s-crypto/` and `s-protocol/`.
- `.github/workflows/` exists and holds only `.gitkeep` (tracked by git). `tools/` holds only `.gitkeep` (tracked). No workflow file, no `tools/*.ts` script, no `deploy/homebrew/`.
- `git remote -v` prints nothing: no remote is configured. The log shows the S-crypto commits (latest `[P0][S-crypto] Checkpoint 9 ticks, P0-D3 counts`).
- `packages/` has `acp-lite`, `crypto`, `fakes`, `protocol`, `relay-core`, `ui-kit`. There is no `packages/platform`. `apps/` has `desktop`, `node`, `relay-cf`, `relay-node`, `sprite`, `watch-zepp`, `web`.
- Root `package.json`: `"packageManager": "pnpm@9.15.0"`, `engines.node >=22`, scripts `build` (`pnpm -r --if-present build`), `test` (`pnpm -r --if-present test`), `typecheck` (`tsc -b`), `lint` (`biome check .`); dev dependencies `@biomejs/biome` 2.6.4, `fast-check` 4.10.2, `typescript` 5.9.3, `vitest` 5.0.5. `.nvmrc` holds `22`. `pnpm-workspace.yaml` lists `apps/*` and `packages/*`. `pnpm-lock.yaml` exists. pnpm is not installed on the dev machine; the command is `npx pnpm@9.15.0`.
- Root `tsconfig.json` has `files: []` and references `apps/sprite`, `apps/node`, `apps/relay-cf`, `apps/relay-node`, `packages/acp-lite`, `crypto`, `fakes`, `protocol`, `relay-core`, `ui-kit`. It does not reference `packages/platform` (it does not exist).
- Only `packages/crypto` and `packages/protocol` have a `test` script (`vitest run`); both have `build` scripts that run `scripts/check-boundaries.ts` and `tsc -p tsconfig.json`. No `passWithNoTests` appears in `apps/` or `packages/`.
- `packages/crypto/vitest.config.ts` defines two projects: `node` (include `test/**/*.test.ts`) and `workers` (`cloudflareTest` from `@cloudflare/vitest-plugin`, `miniflare.compatibilityDate` `2026-11-01`, excludes `test/**/*.node.test.ts`), `testTimeout` 60_000. `@cloudflare/vitest-plugin` is pinned at 1.8.2 in `packages/crypto/package.json`.
- The P0_D2_Suite and the four P0_D3_Suites exist in `packages/crypto/test/` (`jcs-vectors.test.ts`, `sign-verify.test.ts`, `mutate-value.test.ts`, `mutate-bytes.test.ts`, `mutate-signature.test.ts`). `docs/PHASE-STATUS.md` records, for 2026-11-15: P0-D2 `pass` (JCS suite 6 `jcs-*` files, 102 tests, in both projects; `node` 41 files, 590 tests; `workers` 33 files, 522 tests); P0-D3 `pass` (node project); P0-D1, P0-D4, P0-D6 and P0-D7 `todo`; P0-D5 `pass`.
- `fixtures/crypto/known-answers.json` is 82,948 bytes in 534 lines. Targeted greps (counts only) found 0 lines matching a PEM private key header, a `"d":` member, GitHub, AWS or Slack token prefixes, a JWT shape, `SETUP_TOKEN` or `VAPID`.
- `.gitignore` already ignores `.env`, `.env.*`, `*.key`, `*.pem`.
- `packages/protocol/scripts/check-boundaries.ts` (314 lines) exports `scan`, `checkSources`, `checkPackageJson`, `checkTree`; its `scan` returns a `code` view (comments, strings, templates and regex bodies blanked) and a `noComments` view (comments blanked, strings kept). It runs as `node --experimental-strip-types`.
- `packages/protocol/src/unsafe.ts` does not exist. S-protocol task 14.1 (P1) creates it.
- grep of `apps/` and `packages/` (excluding `node_modules`, `dist`, `*.tsbuildinfo`) for `process.platform`, `os.platform(`, `os.type(`, `launchctl`, `systemctl`, `chmod`, `SIGHUP`, `SIGTERM` and `/tmp/` returned no match.
- `gitleaks` and `actionlint` are not installed on the dev machine.
- `docs/DECISIONS-PENDING.md` holds H1 to H11 and S-protocol-* and S-crypto-* rows; no S-ops-packaging row exists yet. H1 (repo public from the first push; secret scanning, push protection and the `secret-scan` hook before that push) is answered 2026-11-02.
- Architecture facts used: row 23 is at line 2230 of `docs/architecture.md`; §4.10 at lines 674 to 682; §18.1 at lines 1888 to 1899; §12.1 SI-1, SI-2 and SI-12 at lines 1540, 1541 and 1551; §16 CI row at line 1825; hooks list at line 1836.

## Dependencies on other specs

| Spec | What this spec needs or gives |
|---|---|
| S-protocol (row 1) | Needs `packages/protocol/src/unsafe.ts` (S-protocol tasks 14.1 and 14.2, pulled forward as a separate S-protocol commit before S-ops-packaging coding) for the SI hooks (Requirement 12 criterion 10; OQ-2, resolved). Reuses `packages/protocol/scripts/check-boundaries.ts` scanner (OQ-13). The `protocol-codegen` hook and the CI "stale generated files" check belong to S-protocol (Requirement 23 criteria 6 to 8). S-protocol's `pnpm -r test` suite must be non-empty (S-protocol Requirement 24 criterion 10). |
| S-crypto (row 2) | `pnpm -r test` runs two Vitest projects of `@wraith/crypto`, `node` and `workers`; CI must run both on both runners (Requirement 2.9). The P0_D2_Suite and the P0_D3_Suites are the files the Suites_Check requires (Requirement 11). S-crypto tasks 5.5 and 10.3 need the Secret_Scan to accept `fixtures/crypto/known-answers.json` (Requirement 3.5 and 3.8). S-crypto Requirement 12 criteria 6 and 7 govern a Workers failure on a runner (Requirement 13.6). This spec edits no S-crypto file. |
| S-node-core, S-sprite-acp | Own the entry points and the spawn code that call the Platform_Package and the `<bin-dir>` check (Requirement 7). |
| S-desktop-tauri | Owns `desktop-release.yml` and the `src-tauri` `platform.rs` rule target (Requirement 5.4). |
| S-relay-adapter-node | May own `deploy/docker/` content (OQ-23). |
| All specs | Their test suites run in `pnpm -r test` under this spec's CI; the Platform_Check and Secret_Scan apply to their files. |

## Resolved decisions

| id | Question | Decision | Resolved by |
|---|---|---|---|
| OQ-1 | Which spec owns the hooks `no-trust-all` and `no-auto-approve`? The architecture does not say: §17 only lists them; §12.1 gives the SI-1 pattern list and "Checked by" for SI-1 (`no-auto-approve`) and SI-2 (`no-trust-all`); §20 rows name only `protocol-codegen` (row 1 R4); S-protocol Requirement 21 owns the token data (`unsafe.ts`), not the hooks; the S-crypto tasks call them "the other P0 hook specs". Candidates: S-protocol, S-approval, this spec. | This spec creates all three P0 hooks (Requirement 12), because P0-D6 groups them with `secret-scan`, §18.1 lists them as P0 scope next to the CI work, and no other spec is staged for P0. The token data stays with S-protocol. (default accepted) | `owner, 2026-11-15` |
| OQ-2 | The SI-1 text forbids spelling the tokens anywhere except `packages/protocol/src/unsafe.ts` and the guard template, with no exempt folder, and `unsafe.ts` does not exist yet (S-protocol task 14.1 is P1). A hook script or sample file that spells `bypassPermissions` would trip itself. How do the P0 hooks get the tokens? | Pull S-protocol tasks 14.1 and 14.2 (`packages/protocol/src/unsafe.ts` and its property test) forward in full, as a separate S-protocol commit before S-ops-packaging coding. The hook scripts import the tokens from `@wraith/protocol`, spell no literal, and samples are assembled at test time. The two SI hooks are built after that commit (Requirement 12 criterion 10). | `owner, 2026-11-15` |
| OQ-3 | What is the Kiro hook file format and trigger? §17 lists the hooks and `.kiro/hooks/.gitkeep` is the only file; the architecture does not define the JSON. The Kiro tooling in use here writes `.kiro/hooks/<id>.json` as `{version:"v1", hooks:[{name, trigger, matcher, action:{type:"command", command}}]}` with triggers such as `PreToolUse`, `PostFileSave` and `PreTaskExec`. A Kiro trigger fires on agent or editor events, not on a git commit made in a terminal. | Use the v1 JSON above, confirmed against the Kiro documentation at task time, with a command action that calls the Secret_Scan. Treat the hook as the in-Kiro guard, and treat the CI job (Requirement 3.10) and an optional git `pre-commit` script as the guards for commits made outside Kiro. (default accepted) | `owner, 2026-11-15` |
| OQ-4 | §16 says "commit hook `secret-scan` (gitleaks)". How do the Kiro hook, a git hook and CI relate, and is gitleaks required? | No gitleaks in P0. The Kiro hook file, the Pre_Commit_Hook and CI all call `tools/secret-scan.ts`; the in-house Secret_Scan is the only scanner. Deviation note: §16 says "commit hook `secret-scan` (gitleaks)", and the owner chose the in-house scanner for P0. | `owner, 2026-11-15` |
| OQ-5 | Does the Secret_Scan use entropy or generic-key rules? `fixtures/crypto/known-answers.json` holds long hex and base64url values and must pass. | Named-pattern rules only, no generic high-entropy rule, so the vectors file passes. (default accepted) | `owner, 2026-11-15` |
| OQ-6 | Can sample secrets be committed as files? GitHub push protection and the Secret_Scan would flag them. | No. Samples are assembled from fragments at test time in a temp file removed in `finally` (Requirement 3.7). (default accepted) | `owner, 2026-11-15` |
| OQ-7 | How does `pnpm -r test` write Suite_Reports, and does the report separate the `node` and `workers` projects? Vitest's JSON and JUnit reporters may not name the project. `@wraith/crypto` has one `vitest run` with two projects. | CI passes the reporter flags on the command line (`--reporter=default --reporter=json --outputFile.json=<path>`), no edit to `packages/crypto/vitest.config.ts`. If the report does not name the project, CI runs the crypto tests twice, once per project (`--project node`, `--project workers`), each with its own output file. Confirm at task time. (default accepted) | `owner, 2026-11-15` |
| OQ-8 | What is the minimum test count, and where is it kept? Must the P0_D3_Suites run in the `workers` project as well? | At least 1 passing test per listed file, zero skipped. A minimum list is hard-coded in the Suites_Check; the Required_Suites_File may only add or raise (Requirement 11.7). The P0_D3_Suites are required in `node`, and in `workers` too because they are not `*.node.test.ts` and run in both today; PHASE-STATUS records P0-D3 evidence for `node` only. (default accepted) | `owner, 2026-11-15` |
| OQ-9 | Does workerd (via `@cloudflare/vitest-plugin` 1.8.2, workerd 1.20261113.1) run on the GitHub `ubuntu-latest` and `macos-latest` runners? It has run only on the dev machine (macOS, arm64). `macos-latest` is arm64 today; the Linux x64 run is unverified. | Assume yes, state it as a criterion (Requirement 2.9), and treat the first GitHub run as the test (HS-5). If it fails on a runner, Requirement 13.6 applies; no fallback is adopted without an owner decision (S-crypto Requirement 12 criterion 7). (default accepted) | `owner, 2026-11-15` |
| OQ-10 | How is pnpm 9.15.0 pinned in CI? pnpm is not installed on the dev machine; locally the command is `npx pnpm@9.15.0`. | Install pnpm with `npm install -g pnpm@9.15.0` after `actions/setup-node`. No third-party pnpm action and no corepack. The version-equality step of Requirement 2.6 stays. | `owner, 2026-11-15` |
| OQ-11 | Will CI cost anything (agent-loop stop condition 6: any GitHub Actions spend is a stop)? Private repositories have minute limits and a macOS multiplier; public repositories on standard runners are free. | The repository is public from the first push (DECISION-19, H1), so the standard runners are free. If the repository were private, stop and ask. (default accepted) | `owner, 2026-11-15` |
| OQ-12 | Can a workflow linter (actionlint) be run without a human step? actionlint is a Go binary (MIT); an official npm package is not known to the author. | No actionlint criterion in P0 beyond Requirement 2.16 (YAML parse, structure assertions, Pin_Check); add actionlint only if a permissive, npm-installable or pinned-download route is verified at task time. (default accepted) | `owner, 2026-11-15` |
| OQ-13 | How does the Platform_Check mask comments and strings? `launchctl`, `systemctl` and `/tmp/` appear in string literals, so string content must be scanned; comments should not trigger. `packages/protocol/scripts/check-boundaries.ts` has an exported lexical `scan` that returns `code` (strings blanked) and `noComments` (comments blanked, strings kept), and it is Node-only tooling. | Reuse the `noComments` view of that scanner. Either import it from `packages/protocol/scripts/check-boundaries.ts` or copy it into `tools/lib/`; a copy avoids a `tools` to `packages` script dependency but duplicates 300 lines. Decide at design time; the default is to import. (default accepted) | `owner, 2026-11-15` |
| OQ-14 | What does "tests" mean in the §4.10 exclusion ("tests, `spike/`, `tools/` and `packages/fakes` excluded")? | Test files are `**/test/**`, `**/*.test.ts` and `**/*.test.tsx` (the same definition SI-1 uses for product code). `dist`, `node_modules`, `generated`, `*.d.ts` and `*.tsbuildinfo` are build output, not source, and are skipped. (default accepted) | `owner, 2026-11-15` |
| OQ-15 | Which file types does the Platform_Check read, and how is the `src-tauri` `cfg(target_os)` rule checked while `apps/desktop/src-tauri` does not exist? | TypeScript and JavaScript (`.ts .tsx .mts .cts .js .mjs .cjs`) only in P0; the Rust `cfg` rule is added with `apps/desktop/src-tauri` in P5 (Requirement 5.4). (default accepted) | `owner, 2026-11-15` |
| OQ-16 | Does `chmod` match `chmodSync`, `fchmodSync` and `fs.promises.chmod`? | Yes, substring match of `chmod` (this covers `fchmod`); any file mode call outside the Platform_Package is a violation. (default accepted) | `owner, 2026-11-15` |
| OQ-17 | Facts about the real tree: grep of `apps/` and `packages/` (excluding `node_modules` and `dist`) for the OS_Specific_Tokens found no hit on 2026-11-15. `packages/crypto` and `packages/protocol` are clean. | Recorded as a fact; no existing violation to fix. Re-check at task time, because S-crypto and S-protocol tasks are still running. (default accepted) | `owner, 2026-11-15` |
| OQ-18 | Is `packages/platform` exempt from the runtime-independence rule (it needs `node:` modules)? The `protocol` and `crypto` boundary checks forbid `node:` imports in their `src`; the platform layer cannot. | Yes, `packages/platform` is Node-only by purpose, depends on `@types/node` only, and no browser, Worker or relay-core code may import it (`relay-core` stays platform-free, §4.10). A boundary test asserts that `relay-core`, `protocol` and `crypto` do not import it. (default accepted) | `owner, 2026-11-15` |
| OQ-19 | How much interface does the P0 skeleton hold? §4.10 lists six call groups, none with a caller yet. | Only `id`, `isWsl()` (linux) and the Win32 stub members; the six groups are added in P1 with their first caller (no orphaned code). The list is recorded in the README (Requirement 9.5). (default accepted) | `owner, 2026-11-15` |
| OQ-20 | Which address does the Win32_Notice link to? The repository URL is unknown until HS-1; the WSL2 page is a P9.20 deliverable. | A named constant `WSL2_DOCS_URL` set to the relative repo path `docs/wsl2.md` until the repository URL exists; the P9.20 page fills it in. (default accepted) | `owner, 2026-11-15` |
| OQ-21 | Phase of `service install`: row 23 says P8 (service); §11.3 says "P1 (script)". | Tag P8 as in row 23 and keep the §11.3 "P1 (script)" as a note; the owner confirms. (default accepted) | `owner, 2026-11-15` |
| OQ-22 | Which spec owns the behavior of each `wraith-node` command in §11.3? Row 23 lists "CLI" in its key notes, but its R1 to R8 name no command beyond `service install`. | This spec owns entry points, `bin` entries and packaging; command behavior stays with the node specs (S-node-core, S-pairing-trust and others). The owner confirms. (default accepted) | `owner, 2026-11-15` |
| OQ-23 | Docker (`relay-docker.yml`) is in row 23 key notes and §16 but its phase is P4 (§4.6.1), which row 23 does not list. S-relay-adapter-node (row 4) also mentions Docker. | Requirement 14 is written here with phase P4 and marked later phase; the owner decides whether row 4 owns the Dockerfile and this spec owns the workflow. (default accepted) | `owner, 2026-11-15` |
| OQ-24 | Triggers of the CI_Workflow. | `pull_request` and `push` to the default branch; no schedule; no `pull_request_target`; `workflow_dispatch` omitted. (default accepted) | `owner, 2026-11-15` |
| OQ-25 | Which hook triggers for `test-on-save` and `fixture-redact-check`? Not owned by any spec; not in P0-D6. | Out of scope (Requirement 12.9). (default accepted) | `owner, 2026-11-15` |
