# Requirements Document

## Introduction

S-spikes is the spec for the P0 spike work of Project Wraith. It is not one of the numbered rows of architecture.md §20; it exists so that P0-D4 has a testable contract. It covers how the 19 spikes of the owner list are run safely and recorded: the isolation of the herdr-core under test, the pre-flight check, the layout of scripts and evidence, the result record in `docs/spikes/RESULTS.md`, evidence and secret hygiene, approval handling inside spikes, the credit and quota budget, the human steps, branch selection and the run order.

Source of truth: `docs/architecture.md` v4.1.7: §19 (spike plan, groups A, B, I, J, §19.1 branch table), §22.1 (decision authority), §22.2 (stop conditions 1, 6, 8), §22.3 (re-routing when a spike fails), §22.5 (status file formats), §18.1 (P0 scope, entry criteria, P0-D4, Human row), §17 (layout: `spike/`, `tools/`), §4.10 (platform check excludes `spike/`), §12.1 (SI-1, SI-2, SI-7, SI-8, SI-12), §21.4 (what a human must check). The steering files `.kiro/steering/{tech,security,agent-loop,structure}.md` carry the same rules.

**Phasing statement (owner instruction).** Every requirement here is tagged `Phase: P0` and serves DoD P0-D4. The spikes decide branches for P1, P2 and later phases (the "Affects" column of the register); this spec designs none of those branches. Only this document is written in this round (no design, no tasks).

**Numbering.** Requirements 1 to 12 are cross-cutting (safety, layout, records, budget, order). Requirements 13 to 16 hold the spike-specific criteria per group (A, B, I, J). Requirement 17 is the P0-D4 gate.

Scope of the owner list (19 spikes): Group A (herdr-core): Q1, Q2, Q6, Q12, Q13, Q14 (PARTIAL allowed). Group B (Kiro ACP local): Q3, Q3b, Q4, Q7, Q10, Q11, Q23. Group I (workspaces): Q30, Q31, Q32, Q33. Group J (agent drivers): Q35, Q43. The P0-D4 DoD text lists 18 ids; Q14 is added by the owner list and may be PARTIAL.

Boundary (out of scope, owned elsewhere): see "Out of scope".

## Glossary

- **Spike**: One experiment that answers one question Qn of §19 (Q3b counts as its own spike).
- **Spike_Runner**: The Node entry point behind `pnpm spike <q>` (proposed `spike/run.ts`, run with `node --experimental-strip-types`, like `tools/`).
- **Default_Core**: The owner's herdr-core running under `HC_SESSION` unset or `default`, with state in `~/.local/state/herdr-core/default/` and the Herdr.app. It holds the owner's live panes.
- **Test_Core**: A herdr-core started by a spike under its own session (§19 Group A: `HC_SESSION=wsp…`, `XDG_STATE_HOME` and `XDG_CONFIG_HOME` under `/tmp/hcw/`).
- **Test_Session**: The value of `HC_SESSION` for one spike. Proposed form `wsp-<q>` in lowercase, for example `wsp-q6` (Resolved decision RD-2).
- **Spike_Root**: The directory `/tmp/hcw/<q>/` that holds everything one spike creates outside the repository: state, config, sockets, scratch workspace, raw logs.
- **Observe_Mode**: The separate owner-only mode `pnpm spike q14 --observe-default` that reads the Default_Core with an enforced allow-list of one read (`server.status`; the CLI form is `server status`). It does not use the normal Preflight (Requirement 1 criteria 8 to 10).
- **Run_By**: Who runs a spike: `loop (non-interactive)` for stages 0 to 2, `owner (interactive terminal)` for every spike that needs approval taps or ledger input (stages 3 to 5 and Q14). Stages are defined in "Run order".
- **Preflight**: The check `spike/lib/preflight.ts` (proposed name) that every Spike_Runner run executes before it starts any process.
- **Own_Marker**: A file `<Spike_Root>/.wraith-spike-owner` written by the Preflight that holds the Test_Session, the Spike_Runner pid and a start time. Only paths and processes recorded under an Own_Marker may be cleaned up.
- **Scratch_Workspace**: A throwaway project folder inside the Spike_Root (never one of the owner's projects) where an agent session runs.
- **Agent_Spike**: A spike that starts `kiro-cli` or `claude` and therefore may spend Kiro credits or Claude quota.
- **Evidence_File**: A redacted file under `spike/<dir>/<q>/evidence/` (log, JSONL, JSON, schema, screenshot note) that a RESULTS entry cites.
- **RESULTS_File**: `docs/spikes/RESULTS.md`.
- **Result_Value**: One of `PASS`, `FAIL`, `PARTIAL` (Requirement 6).
- **Register**: The table "Spike register" in this document: one row per spike.
- **Estimate**: A number written before a run that predicts credits, quota or time. It is never a measurement (Requirement 9).
- **Budget_Ledger**: The file `spike/budget-ledger.json` (proposed) that records, per date, estimated and human-entered actual use.
- **Human_Step**: An action only the owner performs: a login or logout, a reboot, an approval tap, a look at Herdr.app, a device (Requirement 10).
- **Branch**: The architecture alternative that §19 or §19.1 names for a spike result, for example `seats:"swap"` for Q33.
- **SI_Token_Set**: The strings that SI-1 and SI-2 forbid outside `packages/protocol/src/unsafe.ts` (the SI-2 always-approve flags and settings values). This document does not spell them.
- **Secret_Rules**: The pattern set in `tools/lib/secret-rules.ts` that `tools/secret-scan.ts` uses, and that SI-8 requires for the redactor.

Naming note: `spike/run.ts`, `spike/lib/preflight.ts`, `spike/lib/hc.ts`, `spike/lib/redact.ts`, `spike/lib/budget.ts` and `spike/budget-ledger.json` are working names (proposals). The hc variable names, `/tmp/hcw/`, `docs/spikes/RESULTS.md`, `spike/hc/schema.json` and `spike/kiro/q3.jsonl` are fixed by the architecture.

## Requirements

### Requirement 1: The owner's Default_Core is never touched

Phase: P0.
DoD: P0-D4 (applies to every spike).

**User Story:** As the owner, I want every spike to run on its own herdr-core, so that my live panes in the default core are never stopped, restarted or reconfigured.

Implements §19 Group A preamble ("never `hc server stop`/`restart` on the owner's `default` core"), tech.md ("Tests and spikes use their own `HC_SESSION` with a short socket path. Never stop or restart the owner's `default` core"), §22.1.

#### Acceptance Criteria

1. THE Spike_Runner SHALL run every `hc` command of a spike with `HC_SESSION` set to the Test_Session of that spike, never to `default` and never unset.
2. THE Spike_Runner SHALL set `XDG_STATE_HOME` and `XDG_CONFIG_HOME` to directories under the Spike_Root for every `hc` command and every Test_Core process.
3. THE Spike_Runner SHALL start no Test_Core, run no `hc` command and call no herdr-core socket until the Preflight of Requirement 2 has passed for that run.
4. THE Spike_Runner SHALL send every `hc` command through one wrapper (`spike/lib/hc.ts`), and a spike script SHALL NOT spawn `hc` or `herdr-core` directly.
5. IF a command to the wrapper would run `server stop`, `server restart`, `server start`, `update` or any command that writes configuration while the resolved session is `default` or unset, THEN THE wrapper SHALL refuse it with an error and run nothing.
6. THE Spike_Runner SHALL build the environment of every child process (`hc`, Test_Core, stub sprite, node stub, agent) from scratch out of an explicit allow-list (Requirement 7 criterion 6): the runner itself sets `HC_SESSION=wsp-<q>` and the `XDG_*` values, and SHALL pass no inherited `HC_*` or `HERDR_*` variable (including `HC_SCOPE`, `HC_TERMINAL_ID`, `HC_TERMINAL_SOCKET` and `HC_SOCKET`) to any child, because a Herdr pane exports `HC_SCOPE`, `HC_TERMINAL_ID` and `HC_TERMINAL_SOCKET` and the owner may run `pnpm spike` from such a pane (tech.md: the sprite strips `HC_*` and `HERDR_*`).
7. THE Spike_Runner SHALL kill a process only when its pid was started by that spike run, or was returned by the Test_Core's own `server.status` and passes the check of Requirement 3 criterion 3.
8. WHERE the owner runs `pnpm spike q14 --observe-default` (Observe_Mode, a separate mode that does not pass through the normal Preflight, which keeps refusing `default`), THE hc wrapper SHALL enforce a method allow-list of `server.status` only and SHALL refuse every other method or command (including `terminal.list`, `ls`, `server stop`, `server restart`, `server start`, `terminal.create`, `terminal.run`, `terminal.send` and any write to configuration) before it runs anything, so that the observer never lists, starts, stops, restarts, writes to or creates a terminal in the Default_Core and never reads the owner's project names or paths (Resolved decision OQ-5). THE observer SHALL build its child environment with the same allow-list builder as every other child (no inherited `HC_*` or `HERDR_*` variable, and no `HC_SESSION`), and SHALL write to evidence only timing and status lines with the home path masked.
9. THE Observe_Mode SHALL refuse to run when the terminal is not interactive and SHALL refuse to run while any other spike is running (an Own_Marker with a live pid under `/tmp/hcw/`), and no other spike SHALL start while the Observe_Mode runs.
10. THE hc wrapper SHALL carry a unit test (fake `hc` on PATH, no real core) in which the Observe_Mode allow-list accepts `server.status` only and refuses `terminal.list`, `ls`, `server stop`, `server restart`, `server start`, `terminal.create`, `terminal.run`, `terminal.send` and a configuration write, and in which the normal mode still refuses a session of `default`.

### Requirement 2: Pre-flight check before anything starts

Phase: P0.
DoD: P0-D4.

**User Story:** As the owner, I want a check that fails closed before a spike starts anything, so that a wrong environment variable or a long socket path cannot hit my default core.

Implements the owner's mandatory item 1, §19 Group A preamble (short socket path, macOS refuses socket paths over 103 bytes), tech.md.

#### Acceptance Criteria

1. THE Preflight SHALL run first in every Spike_Runner run, before any `hc`, `kiro-cli`, `claude` or listener process starts, and SHALL exit non-zero without side effects other than the log when any criterion below fails (fail closed).
2. THE Preflight SHALL verify that `HC_SESSION` is set, is not `default`, is not empty and matches `^wsp(-[a-z0-9]{1,8})?$`.
3. THE Preflight SHALL verify that `XDG_STATE_HOME` and `XDG_CONFIG_HOME` are set and that their `realpath` lies under `/tmp/hcw/` (on macOS, `/private/tmp/hcw/`).
4. THE Preflight SHALL verify that `HC_SOCKET`, when set, and every socket path the Test_Core will use (the main socket and the holder sockets, built with the longest observed name pattern) have a byte length of at most 90 after `realpath` resolution of the Spike_Root, so that the 103-byte macOS limit is never reached.
5. THE Preflight SHALL verify that none of those socket paths equals, or lies under, the Default_Core state directory (`~/.local/state/herdr-core/default/`), by comparing path strings only, without connecting to any socket.
6. THE Preflight SHALL verify that `HOME` is the real home and that `HC_CONFIG`-style overrides, if any exist in the `hc` help, point under the Spike_Root.
7. THE Preflight SHALL verify that `hc --version` reports at least 0.1.18 (§18.1 Entry, DECISION-58) and, for Q1, at least 0.1.17 (§19 Q1), and SHALL record the version in the evidence.
8. THE Preflight SHALL refuse to run when the Spike_Root already exists without an Own_Marker whose pid is dead, or exists with a live pid, so that a stale or foreign directory is never adopted.
9. THE Preflight SHALL write the Own_Marker before the first process starts.
10. THE Preflight SHALL verify that the wrapper of Requirement 1 criterion 4 is the only `hc` invocation path of the spike (a static check of the spike's script directory for a direct `spawn`/`exec` of `hc` or `herdr-core`).
11. WHEN the Preflight fails, THE Spike_Runner SHALL print which criterion failed and SHALL NOT print the value of any environment variable other than `HC_SESSION`, the `XDG_*` paths and `HC_SOCKET`.
12. THE Preflight SHALL carry a unit test (Vitest, no real `hc` needed; a fake `hc` script on PATH) with one failing case per criterion 2 to 8 and 13 to 14, a failing case "pane env present" (criterion 15) and a passing case; the tests SHALL start no real core.
13. THE Preflight SHALL verify that the environment the hc wrapper would pass to `hc` contains no `HC_*` or `HERDR_*` variable other than the ones the Spike_Runner set itself (`HC_SESSION`, and `HC_SOCKET` only when the runner set it to a path under the Spike_Root).
14. IF the Spike_Runner's own process environment contains `HC_TERMINAL_SOCKET`, `HC_TERMINAL_ID` or `HC_SCOPE` and the runner has not removed it from every child environment it builds, THEN THE Preflight SHALL fail closed (the check reads the names only and never prints the values).
15. THE unit test for criteria 13 and 14 SHALL set `HC_SCOPE`, `HC_TERMINAL_ID` and `HC_TERMINAL_SOCKET` in the runner's environment ("pane env present") and SHALL assert that the Preflight passes only when the child environment built from the allow-list contains none of them, and fails when a wrapper variant passes them through.
16. THE normal Preflight SHALL keep refusing `HC_SESSION` of `default` or unset in every mode other than the Observe_Mode of Requirement 1 criterion 8.

### Requirement 3: Cleanup removes only what the spike created

Phase: P0.
DoD: P0-D4.

**User Story:** As the owner, I want a spike to leave my machine as it found it, so that no stale core, socket or temp file remains and nothing of mine is deleted.

Implements §19 Group A preamble ("stopped and deleted afterwards"), §22.1 (no deleting the user's files).

#### Acceptance Criteria

1. WHEN a spike run ends (success, failure, SIGINT or SIGTERM), THE Spike_Runner SHALL stop the Test_Core it started with a stop command that runs under the Test_Session, then SHALL delete the Spike_Root.
2. THE Spike_Runner SHALL delete only paths that lie under a Spike_Root with a matching Own_Marker, resolved with `realpath`, and SHALL NOT follow symlinks while deleting.
3. BEFORE the Spike_Runner kills a pid it did not start itself, THE Spike_Runner SHALL verify that the pid appears in the output of the Test_Core's own `server.status` or `terminal.list` and that its command line contains the Spike_Root path.
4. THE Spike_Runner SHALL NOT use `pkill`, `killall` or a name-based kill for `hc`, `herdr-core` or `hold` processes.
5. IF cleanup cannot confirm that the Test_Core is stopped, THEN THE Spike_Runner SHALL leave the Spike_Root in place, print its path and exit non-zero, instead of deleting under a live core.
6. WHEN a spike run is repeated, THE Spike_Runner SHALL start from a clean Spike_Root (Requirement 5 criterion 5).
7. THE Spike_Runner SHALL delete every `wraith-spike-<q>.json` file it wrote under `~/.kiro/agents/` (Requirement 15 criterion 8, Requirement 16 criterion 6) in a `finally` path, and only files whose names it created in that run.
8. THE Spike_Runner SHALL NOT delete or change `~/.local/state/herdr-core/default/`, `~/.config/herdr-core/` or any file of the Default_Core.

### Requirement 4: The spike register

Phase: P0.
DoD: P0-D4.

**User Story:** As the owner, I want one table that says, for each spike, what it costs, who must act, when it stops the loop and what it decides, so that I can plan the credits and my own time before anything runs.

Implements the owner's mandatory item 2, §19, §19.1, §22.2, §22.3.

#### Acceptance Criteria

1. THE Register in this document SHALL list exactly the 19 spikes of the owner list, one row per spike, with the columns: spike id, group letter, short question, experiment type, calls an agent CLI and the cost class, Run_By, human step, stop rule, dependencies, branches selected and what they affect, estimate.
2. WHEN a spike script starts, THE Spike_Runner SHALL read the spike's metadata block (cost class, human steps, expected credits, maximum prompts, maximum wall time) from the first lines of its script file and SHALL refuse to run when the block is missing.
3. THE metadata block of each Agent_Spike SHALL state the maximum number of agent prompts it may send and the maximum wall time, and THE Spike_Runner SHALL end the spike when either maximum is reached, recording `PARTIAL` with the reason.
4. THE Register SHALL label every credit, quota and time number as an Estimate with its assumption (Requirement 9).
5. WHEN a spike's group letter, question, pass criterion or branch in §19 changes, THE owner or the loop SHALL update the Register in the same commit.
6. THE Register SHALL record Q5, Q5b, Q5c, Q34 and every other spike outside the owner list as out of scope.

### Requirement 5: Layout, scripts and re-runnability

Phase: P0.
DoD: P0-D4.

**User Story:** As a developer, I want each spike's script and raw evidence in its own folder and a single command to run it again, so that a result can be reproduced when hc or kiro-cli is upgraded.

Implements the owner's mandatory item 3, §19 Result format ("Scripts live in `spike/<group>/<q>.ts` and must be re-runnable with `pnpm spike <q>`"), §17 (`spike/` scripts and raw results, not product code), §19 paths (`spike/hc/schema.json`, `spike/kiro/q3.jsonl`, `spike/acp-echo.ts`).

#### Acceptance Criteria

1. THE spike code SHALL live under `spike/<dir>/<q>/` where `<dir>` is `hc` for Group A, `kiro` for Groups B and I and `agents` for spikes that test several agents (Q33, Q35, with `kiro/` and `claude/` subfolders), and `<q>` is the lowercase id (`q3b`, `q33`) (Open question OQ-9).
2. EACH spike folder SHALL hold a script `<q>.ts`, a folder `evidence/` for Evidence_Files and a `README.md` of at most 40 lines (question, how to run, human steps, what to read in the evidence).
3. THE shared code SHALL live under `spike/lib/` (`preflight.ts`, `hc.ts`, `redact.ts`, `budget.ts`, `acp-echo.ts`, agent profile generator).
4. THE repository SHALL provide `pnpm spike <q>` (a root script that runs `spike/run.ts`), and WHEN `<q>` is unknown, THE Spike_Runner SHALL list the known ids and exit non-zero.
5. WHEN a spike is run again, THE Spike_Runner SHALL write its evidence to a new timestamped subfolder `evidence/<UTC date-time>/` and SHALL NOT overwrite or delete the earlier evidence.
6. THE paths named by the architecture SHALL be kept, with the file at the named path being (or linking to) the latest accepted run: `spike/hc/schema.json` (Q2) and `spike/kiro/q3.jsonl` (Q3).
7. THE spike code SHALL NOT be product code: no package in `apps/` or `packages/` SHALL import from `spike/` (structure.md: packages never depend on apps; `spike/` is not product code).
8. WHERE a spike needs a dependency (`@agentclientprotocol/sdk` for Q10), THE dependency SHALL be permissive-licensed (MIT, Apache, BSD, ISC), SHALL be recorded in `docs/THIRD_PARTY.md`, and SHALL be declared in a private package for `spike/` (Open question OQ-11).

### Requirement 6: Result record in RESULTS.md

Phase: P0.
DoD: P0-D4.

**User Story:** As the loop and the owner, I want one entry per spike with its question, experiment, result, evidence and chosen branch, so that every later phase can read the answer and the reason.

Implements the owner's mandatory item 3, §19 Result format, §22.5, §22.1 ("Pick a branch per §19.1 when the spike result is clear").

#### Acceptance Criteria

1. THE RESULTS_File SHALL hold, for each of the 19 spikes, one entry (a heading `### Qn`) with the fields: question, experiment (what was run, hc and agent versions, date, runner), result (`PASS`, `FAIL` or `PARTIAL`), evidence (one or more paths in `spike/`), branch chosen, affects (specs and phases), and notes (Open question OQ-10).
2. THE existing summary tables in the RESULTS_File (groups A to J) SHALL stay and SHALL carry the Result_Value, the evidence path, the branch and the date for each spike, pointing to the entry.
3. THE Result_Value `PASS` SHALL mean that every "Passes when" criterion of §19 for that spike was observed and recorded in an Evidence_File.
4. THE Result_Value `FAIL` SHALL mean that at least one "Passes when" criterion was observed not to hold, with evidence; an expected failure (Q12) is a valid answer.
5. THE Result_Value `PARTIAL` SHALL mean that part of the criteria was observed and the rest needs a Human_Step or a machine the loop does not have; the entry SHALL list the missing parts and what the owner must do.
6. IF a spike cannot run (missing login, missing tool, budget guard stop), THEN THE entry SHALL stay `pending` with the reason and SHALL NOT be recorded as `FAIL`.
7. THE entry SHALL name the branch that §19 or §19.1 selects for the result, and WHEN the branch has a "Notify" column entry in §22.3, THE entry SHALL say whether the owner was notified.
8. THE RESULTS_File SHALL NOT contain a pre-existing "pre-check" note as a result: the pre-check notes of 2026-11-05 (Q1, Q2, Q6, Q12) SHALL be kept as context, and the spike SHALL still record its own evidence.
9. THE evidence path of every entry SHALL exist in the repository at the time the entry is written, and an entry without an existing evidence path SHALL be rejected by a check (`tools` check or a test) that parses the RESULTS_File.
10. IF a spike whose Run_By is `owner (interactive terminal)` is started without an interactive terminal (no TTY), THEN THE Spike_Runner SHALL start no agent, record the entry as `pending` with the reason "needs interactive terminal", and SHALL NOT record it as `PARTIAL` or `FAIL`.

### Requirement 7: Evidence hygiene and secrets

Phase: P0.
DoD: P0-D4. Supports SI-8, SI-12.

**User Story:** As the owner of a public repository, I want evidence files that contain no secret, token or private path of mine, so that publishing the spikes cannot leak anything.

Implements the owner's mandatory items 4 and 5 (secrets part), §12.1 SI-8 and SI-12, agent-loop.md (repo public from the first push), §17 (`spike/` is not product code).

#### Acceptance Criteria

1. THE Spike_Runner SHALL pass every Evidence_File body through the redactor `spike/lib/redact.ts` before writing it into the repository, and SHALL write the unredacted log only under the Spike_Root, which is deleted at cleanup.
2. THE redactor SHALL use the same pattern set as the Secret_Rules, so that SI-8's "same pattern set" holds (Open question OQ-13).
3. WHEN the redactor finds a match, THE redactor SHALL replace the matching line with `[REDACTED-LINE:<class>]`, SHALL keep the line count, and SHALL record the number of replaced lines in the evidence index.
4. THE redactor SHALL replace the owner's home directory prefix with `~` and SHALL replace the value of every environment variable whose name contains `TOKEN`, `KEY`, `SECRET` or `PASSWORD`.
5. THE Spike_Runner SHALL run `node --experimental-strip-types tools/secret-scan.ts <path>…` on every new Evidence_File after writing and SHALL delete the file and fail the spike when the scan reports a finding.
6. THE Spike_Runner SHALL build every spike child environment from scratch from an explicit allow-list (PATH, HOME, LANG, TERM, TMPDIR, `HC_SESSION=wsp-<q>` and `XDG_*` set by the runner itself, the agent's own login variables when the agent needs them), SHALL pass no inherited `HC_*` or `HERDR_*` variable (Requirement 1 criterion 6, Requirement 2 criteria 13 to 15) and SHALL NOT log the environment.
7. THE evidence files under `spike/` and `docs/spikes/` SHALL stay covered by the secret scan: `tools/secret-scan.ts --tree` scans every tracked or untracked non-ignored file, so `spike/` and `docs/spikes/` SHALL NOT be added to `.gitignore` (an ignored evidence file would escape the CI tree scan).
8. THE pre-commit hook (`--staged`) and the CI tree scan SHALL be the second guard for leftovers; a finding SHALL stop the loop (agent-loop.md stop condition 8).
9. THE spike code and evidence SHALL NOT spell any string of the SI_Token_Set: SI-1 states that there is no exempt folder, and `spike/` is exempt only from product-code scanners (`tools/check-platform.ts`, the SI product-code scan in `tools/lib/si-rules.ts`, which lists `spike/` among its excluded prefixes), not from the token-spelling rule or from the secret scan.
10. WHEN a spike needs to prove that an unsafe flag is refused, THE spike SHALL import the strings from `packages/protocol/src/unsafe.ts` once that file exists, and SHALL otherwise omit that check.
11. THE Spike_Runner SHALL launch every agent with a launch configuration that carries none of the SI-2 always-approve flags or settings, and SHALL run the SI-2 settings checks that exist at the time (argv, `~/.claude/settings.json` and project settings for Claude) before each Claude launch. THE Spike_Runner SHALL also validate the effective Claude launch options (not only the files on disk): no filesystem setting sources loaded (empty), default permission mode, no allow rules and no allowed-tools list beyond read-only tools, and SHALL route every permission request through the owner prompt, denying on timeout.
12. THE spike's local listeners (the Q3b hook receiver on 127.0.0.1:7782, the Q11 MCP echo server) SHALL bind to `127.0.0.1` only and SHALL require a random per-run token in a header, as SI-7 requires for hook and MCP endpoints.
13. THE Q3 record `spike/kiro/q3.jsonl` is described by §19 as "usable as a fixture"; publishing it under `fixtures/` SHALL need the human review of §17 and is out of this spec (Open question OQ-14).

### Requirement 8: Approvals inside spikes need a human

Phase: P0.
DoD: P0-D4. Protects SI-1 and SI-2.

**User Story:** As the owner, I want every permission request in a spike answered by me, so that a spike script never becomes an auto-approver.

Implements the owner's mandatory item 4 (spikes never use the always-approve flags), §12.1 SI-1 ("no other auto-approve, trust mode or dev bypass"), SI-2, agent-loop.md ("Never auto-approve outside Autopilot"), §22.4.

#### Acceptance Criteria

1. THE spike scripts SHALL NOT contain code that answers `session/request_permission`, a `PreToolUse` hook or a permission prompt with an allow-kind option without an interactive confirmation by the owner for that single request.
2. WHEN an ACP client in a spike receives `session/request_permission`, THE client SHALL print the tool, the arguments and the options on the terminal and SHALL wait for a key press of the owner; only the option the owner selects SHALL be returned.
3. IF the terminal is interactive and no key press arrives within 120 seconds, THEN THE client SHALL answer `reject_once` (or `cancelled`) and the spike SHALL be recorded `PARTIAL` with reason "approval tap missing"; IF the terminal is not interactive, THEN the owner-run spike SHALL end `pending` per Requirement 6 criterion 10 and SHALL NOT be `PARTIAL`, and any permission request that reaches a client in a loop-run spike (Q43) SHALL be answered `reject_once`, never with an allow-kind option.
4. THE spike scripts SHALL NOT answer `allow_always` or any option that grants more than one call; WHERE a spike must test a persisted grant (Q33 trust-survival check), THE owner SHALL select `allow_always` by hand and THE client SHALL only record what happened.
5. THE spike agent profiles SHALL trust read-only tools only, and every write or execute tool SHALL ask (SI-2).
6. THE Q3b hook receiver SHALL return a block (exit 2) on timeout, error or no owner decision, and SHALL never return an allow on timeout (SI-1: a timeout always rejects; §7.2 hook rule).
7. WHERE a spike needs more approvals than the owner can reasonably tap (Q33: about 20 edits), THE spike SHALL NOT add an auto-approve path; the owner decided in OQ-1 (no exemption; one tap per request; Q33 on its own day).

### Requirement 9: Budget guard for Kiro credits and Claude quota

Phase: P0.
DoD: P0-D4.

**User Story:** As the owner, I want every spike to state what it may cost and to stop before the daily limit, so that the spikes never exceed 200 Kiro credits a day.

Implements the owner's mandatory item 5, agent-loop.md stop condition 6 ("more than 200 Kiro credits per day"), §22.1 ("Running real agents using more than 200 credits/day" is a stop), H-rules (user has Kiro Pro, Q8).

#### Acceptance Criteria

1. THE Spike_Runner SHALL refuse to start an Agent_Spike when the sum of (a) the Budget_Ledger's entry for today (estimated upper bounds of spikes already run today plus any human-entered actuals, counting the larger of the two) and (b) the upper estimate of the spike to start would exceed the daily spike ceiling.
2. THE daily spike ceiling for Kiro credits SHALL be 100 (half of the 200 of stop condition 6, leaving room for other loop work), and WHEN the owner enters a different value, THE Spike_Runner SHALL use it but SHALL cap it at 200 (Open question OQ-3).
3. THE Spike_Runner SHALL track Claude quota as a count of prompts per day with a default ceiling of 40 and SHALL ask the owner to read the real quota use (Open question OQ-2).
4. THE Spike_Runner SHALL tell the loop's operator that it cannot measure credits and SHALL ask the owner to read the dashboard before and after each Agent_Spike batch and to enter the actual value into the Budget_Ledger.
5. THE Register and every spike's metadata block SHALL label credit and quota numbers as Estimates and SHALL state the assumption (Open question OQ-4).
6. IF the Budget_Ledger has no human-entered actual for the previous batch of the same day, THEN THE Spike_Runner SHALL ask for it before it starts the next Agent_Spike batch and SHALL proceed only after the owner answers or enters `skip`.
7. WHEN a spike reaches its maximum prompt count (Requirement 4 criterion 3), THE Spike_Runner SHALL stop sending prompts, close the agent and record the number of prompts sent.
8. THE Budget_Ledger SHALL hold no secret and SHALL be a committed file so that the loop can read yesterday's value.
9. IF an estimate is exceeded by more than 50 percent in an owner-entered actual, THEN THE Spike_Runner SHALL stop the remaining Agent_Spikes of that day and the loop SHALL notify the owner (stop condition 6).
10. THE Spike_Runner SHALL record no Cloudflare or GitHub Actions use because no spike of the owner list spends either; IF a spike would, THEN the loop SHALL stop (stop condition 6).
11. THE daily 200-credit limit of stop condition 6 SHALL apply to the sum of the Authoring estimate (or its human-entered actual) and the run credits of the same day, and THE Spike_Runner SHALL count a human-entered authoring actual of the day in criterion 1 before it starts an Agent_Spike.

### Requirement 10: Human steps are recorded, not performed

Phase: P0.
DoD: P0-D4.

**User Story:** As the owner, I want the loop to list every step that only I can do and to wait for me, so that it never guesses a login, a reboot or a tap.

Implements the owner's mandatory item 6, §18.1 (Human row; Entry: logged-in kiro-cli), §19 runner symbols, §21.4 (P0: group B/C results that need login), §22.2 stop condition 4.

#### Acceptance Criteria

1. THE spike metadata block SHALL list each Human_Step of the spike by id (HS-S1 and following, see "Human steps").
2. WHEN a spike reaches a Human_Step, THE Spike_Runner SHALL print the step, write it as an open item in the evidence index and wait or exit with a non-zero "needs human" status, and SHALL NOT perform the step.
3. THE loop SHALL NOT log in, log out, reboot, lock a screen, click in Herdr.app or tap an approval for the owner, and SHALL NOT run `kiro-cli login`, `kiro-cli logout` or an equivalent for Claude.
4. IF a Human_Step is missing (Kiro not logged in, no second approval tap, no Linux machine), THEN THE spike SHALL end `PARTIAL` or stay `pending` per Requirement 6 criteria 5 and 6 and the loop SHALL continue with spikes that do not need it (agent-loop.md stop condition 4: only stop when no other work exists).
5. THE Q14 entry SHALL be `PARTIAL` until the owner has performed the logout and login and has pasted or approved the observation; it SHALL list the remaining steps (Linux machine, reboot, reboot with nobody logged in).
6. THE Register SHALL show, per spike, whether the owner must be present during the run (approval taps, Herdr.app) or only before it (login), and its Run_By value (`loop (non-interactive)` or `owner (interactive terminal)`).

### Requirement 11: Branch selection and stop rules

Phase: P0.
DoD: P0-D4.

**User Story:** As the loop, I want each result to select its architecture branch by the §19.1 table and to stop where the architecture says stop, so that later phases start from the right design.

Implements the owner's mandatory item 7, §19 ("If it fails → branch"), §19.1, §22.1 (pick a branch when the result is clear; a STOP result waits for a human), §22.2 conditions 1, 3, 6, 8, §22.3.

#### Acceptance Criteria

1. WHEN a spike result is recorded, THE loop SHALL select the branch that §19.1 or the spike's own §19 row names, and SHALL write it in the RESULTS entry together with the specs and phases it affects (the Register column "Affects").
2. IF Q3 and Q3b both end `FAIL`, THEN THE loop SHALL record both entries, mark the Q3 and Q3b rows "STOP", stop all P1 work that depends on Kiro approval, notify the owner, and wait (§19.1 row "Q3, Q3b fail", §22.2 condition 1, §22.3 row "Q3 + Q3b fail").
3. IF Q3 ends `FAIL` and Q3b ends `PASS`, THEN THE loop SHALL select "Kiro approval via `preToolUse` + one-shot grant", add the hook endpoint to P1 scope in `docs/PHASE-STATUS.md` and notify the owner (not blocking) (§22.3).
4. IF Q3 ends `PASS`, THEN THE loop SHALL select "approval via ACP `request_permission`" and SHALL still record the Q3b answer (Open question OQ-8).
5. IF Q33a ends `FAIL` for Claude or Kiro, THEN THE loop SHALL record whether Q33c passed (`seats:"swap"`) or not (`seats:"none"`), SHALL notify the owner, and SHALL copy P9.17-D1 to D3 into P2 in `docs/PHASE-STATUS.md` (§22.3 row Q33a, §1882 swap rule).
6. IF a spike fails and §22.3 gives no notify entry (Q4, Q7, Q12, Q13, Q14, Q23, Q30, Q31, Q32), THEN THE loop SHALL record the result and branch and SHALL NOT notify unless the branch changes a DoD (Open question OQ-15).
7. THE loop SHALL stop and notify the owner when any of the following occurs during a spike: a pre-flight failure that suggests the Default_Core was targeted (Requirement 1), a budget limit (stop condition 6), a secret in a commit or log (stop condition 8), or a DoD item failing three rounds in a row (stop condition 2).
8. THE loop SHALL NOT change a locked decision because a spike fails; it SHALL write a proposal in `docs/DECISIONS-PENDING.md` (agent-loop.md).
9. THE Q5+Q5c STOP rule SHALL be out of scope: it concerns Group C and is not in the owner list.
10. WHEN a RESULTS entry is written, THE loop SHALL list the later specs and DoD ids whose entry criteria it satisfies (for P1: Q1, Q2, Q3/Q3b, Q6, Q30, Q31, Q32, Q35, Q43, §18.2 Entry; for P2: Q11, Q33, Q34 Entry).

### Requirement 12: Run order, dependencies and parallelism

Phase: P0.
DoD: P0-D4.

**User Story:** As the owner, I want the spikes ordered to spend the fewest credits and to need me the fewest times, so that P0-D4 closes in about a day of my attention.

Implements the owner's mandatory item 8, §19 ("Ordered by how much they unblock: A and B block P1"), the dependency facts of the "Run order" section.

#### Acceptance Criteria

1. THE Spike_Runner SHALL run the herdr-core spikes (Group A, except Q14) in stage 1 with no agent CLI, in the order Q2, Q13, Q12, Q1, Q6.
2. WHERE two Group A spikes run at the same time, THE Spike_Runner SHALL give each its own Test_Session and Spike_Root; the default is serial runs (Resolved decision RD-3).
3. THE Spike_Runner SHALL run Q43 (at most one prompt) before Q3, Q3b, Q10, Q4, Q11 and Q23, because those use `kiro-cli acp --agent-engine v3 --agent wraith-spike-<q>` and Q43 decides whether `--agent` is accepted (Requirement 16 criterion 5).
4. THE Spike_Runner SHALL run every Agent_Spike one at a time (no parallel agent processes) except where the spike itself requires two processes (Q33a).
5. THE Spike_Runner SHALL reuse one Kiro session between Q3 and Q23 and one acp-echo client between Q3, Q10, Q4 and Q11, so that each prompt is paid once (Register "Depends on").
6. THE Spike_Runner SHALL run Q33 on its own budget day (Requirement 9 criterion 2) after the other Agent_Spikes.
7. THE Spike_Runner SHALL run Q14 whenever the owner is ready, independent of the other spikes, because it needs the owner's logout and login.
8. IF a spike's dependency is `FAIL` or `PARTIAL`, THEN THE Spike_Runner SHALL say so before it starts the dependent spike and SHALL follow the dependency's branch (for example, Q43 `FAIL` makes Q3 launch the agent without `--agent` and select it after `initialize`).

### Requirement 13: Group A spikes (herdr-core)

Phase: P0. Later-phase effect: P1 S-node-core, S-console, S-sprite-acp; P8 S-crypt; S-ops-packaging.
DoD: P0-D4 (Q1, Q2, Q6, Q12, Q13, Q14).

**User Story:** As the node developer, I want measured answers about hc, so that pane-manager, console and respawn are designed on facts.

Implements §19 Group A (all six rows), §22.3 rows Q1, Q2, Q6, §7.6 (respawn), §8 (console S3).

#### Acceptance Criteria

1. THE Q2 spike SHALL run `hc schema` of the pinned version into `spike/hc/schema.json`, SHALL `terminal.run` a stub that prints `$PWD`, `$WRAITH_X` and `$HC_TERMINAL_ID`, SHALL call `terminal.list` with labels, SHALL check that `terminal.get` with an address such as `t7` resolves the address and never a terminal named `t7`, SHALL confirm that `env -0` exists on macOS, and SHALL compare the pane's `PATH` and agent variables with a login shell's for a core started from a terminal.
2. THE Q2 result SHALL be `PASS` WHEN cwd, env and labels are applied and `HC_TERMINAL_ID` is set in the child; the Herdr.app visibility and the "core started by the Herdr Core app" PATH comparison SHALL be recorded as Human_Steps (HS-S5) and the entry SHALL say "unobserved" until the owner reports them (Open question OQ-6).
3. THE Q1 spike SHALL run a full-screen program in a pane of the Test_Core, SHALL call `terminal.read` every 250 ms for 5 minutes, SHALL measure the Test_Core's CPU use and the payload size per read, and SHALL pass WHEN the CPU increase is below 5 percent and the payload is below 64 KB.
4. IF the CPU increase is 5 percent or more, THEN THE Q1 entry SHALL select "poll 1 s", and IF the payload is 64 KB or more, THEN it SHALL select "send only line diffs (Q20)" (§19 Q1 branch, §22.3).
5. WHERE `htop` is not installed, THE Q1 spike SHALL use the substitute named in Open question OQ-7 and SHALL record the substitute in the entry.
6. THE Q6 spike SHALL start a stub sprite pane with Wraith labels and a node stub subscribed to events, and SHALL run (a) `hc server restart`, (b) a kill of the holder pid returned by the Test_Core's `server.status`, (c) `hc server stop` and start, all under the Test_Session only.
7. THE Q6 result SHALL be `PASS` WHEN (a) the same pid keeps running, (b) the pane finishes with reason `holder_lost`, a `hc kill` of a stub that exits 75 on SIGHUP records `killed`, `kill -TERM` records `exited` 75, and the node stub respawns the pane with the same ids within 10 s for (b), (c) and `kill -TERM` (with no close intent a finished pane is lost, §7.6: only `killed`, `exited 0` and `spawn_pending` are not respawned at once), never for `exited 0` or `killed`, and waits on `spawn_pending` (at most 3 re-checks) before treating it as lost.
8. THE Q6 entry SHALL record the Herdr.app close-button reason as a Human_Step (HS-S5) and SHALL state the branch "document `/exit`" when the owner reports `exited 75` (§19 Q6).
9. THE Q12 spike SHALL subscribe to events, send input with `hc send` from another shell, and record whether an event names the pane and the sending client; the expected result is `FAIL`, with the branch "drop `herdr-guard`, keep the limitation in §12".
10. THE Q13 spike SHALL read the schema and try hc templates, `first_message` and `terminal.wait`, and SHALL record `PASS` only WHEN one of them replaces part of the sprite's ACP or queue work; otherwise `FAIL` with the branch "use the sprite as designed".
11. THE Q14 spike SHALL run only as `pnpm spike q14 --observe-default` by the owner (Run_By `owner (interactive terminal)`) and SHALL be split into an observer for the macOS logout and login that checks that the socket is ready within 10 seconds after login and that a respawned pane's `PATH` finds `kiro-cli`, and SHALL list the Linux unit, the reboot, the reboot with nobody logged in and the recorded pane reason (not `killed`) as open Human_Steps (HS-S4), result `PARTIAL`.
12. THE Q14 observer SHALL follow Requirement 1 criteria 8 to 10 (Observe_Mode, method allow-list enforced by the hc wrapper, no non-interactive run, no other spike running) and SHALL create no pane in the Default_Core and SHALL NOT list its terminals (only `server.status`; evidence holds timing and status lines only); the `PATH` check SHALL be a script the owner runs inside a pane the owner creates (Open question OQ-5).

### Requirement 14: Group B spikes (Kiro ACP, local)

Phase: P0. Later-phase effect: P1 S-approval, S-sprite-acp, S-console; P2 S-node-local-endpoints; S-crypt, S-cloud-bot.
DoD: P0-D4 (Q3, Q3b, Q4, Q7, Q10, Q11, Q23).

**User Story:** As the sprite developer, I want logged protocol traces from the real Kiro, so that the ACP client is built on what Kiro does.

Implements §19 Group B (Q3, Q3b, Q10, Q11, Q4, Q7, Q23), §19.1, §22.3.

#### Acceptance Criteria

1. THE Q3 spike SHALL start `kiro-cli acp --agent-engine v3 --agent wraith-spike-q3` in a Scratch_Workspace (the agent file in the location Q43 selected, Requirement 16 criterion 6) with an agent profile that does not trust `execute_bash`, SHALL send the prompt "run `echo hi`", SHALL log all JSON-RPC to `spike/kiro/q3.jsonl`, and SHALL record `PASS` WHEN `session/request_permission` arrives with `options[]` and WHEN the owner's selection (Requirement 8) makes the tool run.
2. THE Q3b spike SHALL install a `preToolUse` hook in the spike agent profile that posts to the receiver of Requirement 7 criterion 12, SHALL run `kiro-cli acp`, and SHALL record `PASS` WHEN the hook fires before the tool, WHEN exit code 2 blocks the tool, and SHALL record the measured hook timeout.
3. THE Q10 spike SHALL run the same acp-echo scenario once with `@agentclientprotocol/sdk` and once with raw JSON-RPC, and SHALL record `PASS` WHEN initialize, new session, prompt, update and permission all work with the SDK and no schema is rejected; on `FAIL`, the branch is `packages/acp-lite` (+1 to 2 days, §22.3).
4. THE Q11 spike SHALL read `mcpCapabilities` from the `initialize` response, SHALL send `mcpServers:[{type:"http", …}]` to an MCP echo server (Requirement 7 criterion 12), SHALL ask the agent to call a tool, and SHALL record `PASS` WHEN the agent calls a tool over http; on `FAIL` the branch is the stdio shim `wraith-mcp-stdio`.
5. THE Q4 spike SHALL declare `clientCapabilities.terminal:true`, SHALL ask the agent to run a long command, and SHALL record `PASS` WHEN the agent sends `terminal/create` and `terminal/output`; on `FAIL` the branch is "show output in the ToolCard".
6. THE Q7 spike SHALL run `kiro-cli chat --list-sessions --help` and try `--format json`, SHALL run with zero model prompts, and SHALL record `PASS` WHEN a JSON output exists; on `FAIL` the branch is "use ACP `session/list` only".
7. THE Q23 spike SHALL `session/load` the same session twice (the session created in Q3, which holds a tool call) and compare the ids of `agent_message_chunk` and `tool_call` between the two replays, and SHALL record `PASS` WHEN the ids are equal; on `FAIL` the branch is dedupe with `hash(turnIndex, text)`.
8. WHEN an Agent_Spike of this group sends more prompts than its metadata maximum, THE Spike_Runner SHALL end it per Requirement 4 criterion 3.
9. THE Q3 and Q3b entries SHALL apply Requirement 11 criteria 2 to 4 and SHALL note the P1 specs they unblock (S-approval, S-node-local-endpoints).

### Requirement 15: Group I spikes (workspaces and per-bot instructions)

Phase: P0. Later-phase effect: P1 bot creation and session resume (P1-D2); P2 seats (S-handoff-groupchat); P9.17.
DoD: P0-D4 (Q30, Q31, Q32, Q33).

**User Story:** As the node developer, I want to know how Kiro and Claude behave per folder and per session, so that "one folder, one bot" and group seats are built on facts.

Implements §19 Group I (Q32, Q31, Q33, Q30), §19.1 (Q33a rows), §22.3 (Q33a row), DECISION-24, 31, 32, 33, 54.

#### Acceptance Criteria

1. EVERY Group I spike SHALL run in a Scratch_Workspace inside the Spike_Root, never in one of the owner's projects (§19 Group I).
2. THE Q30 spike SHALL create a Kiro ACP session in a scratch folder, end the process, and check that `--list-sessions` or the ACP session list from the same cwd lists the session id for that cwd; on `FAIL` the branch is "rely only on the node's `workspaces` table".
3. THE Q31 spike SHALL run an agent profile with an allowlist for writes (`toolsSettings.fs_write.allowedPaths` or the equivalent Kiro field) while reads stay open, SHALL ask the agent to write inside and outside the folder, and SHALL record `PASS` WHEN the outside write is refused or asks permission; on `FAIL` the branch is the "Outside workspace" badge only.
4. THE Q32 spike SHALL generate `~/.kiro/agents/wraith-spike-q32.json` (always in `~/.kiro/agents/`, because that path is what Q32 tests) with a prompt and read-only trusted tools, SHALL start `kiro-cli acp --agent wraith-spike-q32`, SHALL ask "what are your instructions?", SHALL edit the file, SHALL restart with `session/load`, and SHALL record `PASS` WHEN the new prompt is used and the history is kept.
5. IF `--agent wraith-spike-q32` is not accepted (Q43 `FAIL`), THEN THE Q32 spike SHALL select the agent after `initialize` and record the difference; on `FAIL` of Q32 itself the branch is the default agent with no trusted tools and the instructions as a first context block (§19 Q32).
6. THE Q33 spike SHALL run checks a, c and d for Kiro and for the Claude Agent SDK driver (Requirement 16 criterion 7 and OQ-2 for Claude; the Claude launch follows Requirement 7 criterion 11: empty setting sources, default permission mode), and check b as record-only: a: two processes, two sessions, same folder, 5 overlapping prompts per process with one read and one edit each, 20 minutes, `pgrep` showing two independent process trees; c: one process, sessions A and B, load A, prompt, load B, prompt, five times, with the switch latency; d: whether the agent offers a fork.
7. THE Q33 result SHALL be, per agent: a `PASS` WHEN all 10 turns complete, there is no `-32603`, no "active in another process", and two distinct session ids; c `PASS` WHEN A never sees B's text; and SHALL record whether an `allow_always` given in A applies in B and whether an "allow always" survives `session/load` (§19 Q33).
8. THE agent file of every spike SHALL be named `wraith-spike-<q>.json` (for example `wraith-spike-q32.json`), and THE Kiro `--agent` value SHALL be `wraith-spike-<q>`; WHEN a spike creates such a file under `~/.kiro/agents/` (Q32 always, others only as Requirement 16 criterion 6 allows), THE spike SHALL create only a file that did not exist before, SHALL delete it at cleanup (Requirement 3 criterion 7), and SHALL NOT change any other file there (§22.1; Resolved decision OQ-12).
9. THE Q33 entry SHALL select `seats:"process"`, `"swap"` or `"none"` per agent by §19.1 (a passes, process; a fails and c passes, swap; both fail, none), SHALL say whether "Native fork" is offered, and SHALL apply Requirement 11 criterion 5.
10. THE Q33 spike SHALL need an owner tap per request (Requirement 8; OQ-1: no exemption), SHALL run on its own budget day as `owner (interactive terminal)`, and SHALL end `pending` ("needs interactive terminal") when run without a TTY.

### Requirement 16: Group J spikes (agent drivers needed by P1)

Phase: P0. Later-phase effect: P1 S-node-core (`bot.commands`), S-sprite-acp (launch argv §4.4/§5).
DoD: P0-D4 (Q35, Q43).

**User Story:** As the node developer, I want to know how the agents list their commands and how they take their agent argument, so that the `/` picker and the launch line are built on facts.

Implements §19 Group J (Q35, Q43), §19.1 rows Q35 and Q43, §22.3 rows Q35 and Q43, DECISION-44.

#### Acceptance Criteria

1. THE Q35 spike SHALL start a Kiro session in a Scratch_Workspace with a test skill and a test prompt, SHALL log every `available_commands_update` after `session/new` and `session/load`, and SHALL add a skill during the session and record whether an update follows.
2. THE Q35 result SHALL be `PASS` WHEN the list arrives after `session/new` or `session/load` and contains the test skill; the branch SHALL be `bot.commands{source:"acp"}` on `PASS`, and the folder scan (`source:"files"`) otherwise, or `source:"none"` WHEN nothing is found (§19.1).
3. THE Q35 spike SHALL repeat the check for Claude with the SDK's `supportedCommands()` and SHALL record the Kiro and Claude results as separate lines of one entry; the Claude half follows OQ-2 and Requirement 7 criterion 11 (empty setting sources, default permission mode).
4. THE Q35 spike SHALL treat command descriptions as untrusted text and SHALL store them redacted (DECISION-44).
5. THE Q43 spike SHALL start `kiro-cli acp --agent-engine v3 --agent wraith-spike-q43` against a scratch agent file, SHALL send `initialize` and `session/new` and at most one prompt that asks for a tool the profile does not trust, and SHALL record `PASS` WHEN the process is accepted and the agent's tools and permissions apply (the tool asks).
6. THE Q43 spike SHALL try the Scratch_Workspace's `.kiro/agents/wraith-spike-q43.json` first and SHALL fall back to `~/.kiro/agents/wraith-spike-q43.json` (a new file, deleted at cleanup, Requirement 15 criterion 8) only when Kiro does not read the local folder; THE result SHALL record which location worked, and the other Agent_Spikes SHALL use that location for their `wraith-spike-<q>.json` files, except Q32, which always uses `~/.kiro/agents/` (Resolved decision OQ-12).
7. IF Q43 ends `FAIL`, THEN THE entry SHALL select "launch Kiro without `--agent` and select it after `initialize` with `session/set_mode` or the agent config option" and SHALL list `§4.4/§5 argv` as the text to update, without editing the architecture itself (§22.3: record, no notify).
8. THE Q35 and Q43 entries SHALL state that they satisfy P1 Entry ("Q1, Q2, Q3/Q3b, Q6, Q30, Q31, Q32, Q35, Q43 answered", §18.2).
9. THE Q43 spike SHALL run as `loop (non-interactive)` and SHALL answer every permission request with `reject_once`, so that "the tool asks" is recorded without any allow (a reject is never an approval, SI-1).

### Requirement 17: P0-D4 gate and status files

Phase: P0.
DoD: P0-D4.

**User Story:** As the loop, I want P0-D4 to turn `pass` only when every listed spike has an answer with evidence, so that P1 does not start on a guess.

Implements the owner's final item, §18.1 DoD P0-D4, §22.5 (status file formats), agent-loop.md (90 percent rule; leftovers recorded, none tied to SI-*).

#### Acceptance Criteria

1. THE row P0-D4 in `docs/PHASE-STATUS.md` SHALL change from `todo` to `pass` only WHEN each of Q1, Q2, Q3, Q3b, Q4, Q6, Q7, Q10, Q11, Q12, Q13, Q23, Q30, Q31, Q32, Q33, Q35 and Q43 has a RESULTS entry with a Result_Value of `PASS`, `FAIL` or `PARTIAL` and an existing evidence path (Requirement 6 criterion 9).
2. THE row SHALL accept Q14 as `PARTIAL` (a recorded entry with what the owner must do), and SHALL NOT accept any other spike as `pending`.
3. WHILE one or more of the 18 spikes is `pending`, THE row SHALL stay `todo`; WHILE the only open item is a Human_Step for a spike that is `PARTIAL`, THE row SHALL be set `blocked-human` when no loop work remains (`todo/pass/fail/blocked-human` of §22.5).
4. THE evidence cell of the P0-D4 row SHALL cite the RESULTS_File, the count of entries by Result_Value, the hc, kiro-cli and Claude Code versions of the runs, and the date, in the style of the P0-D1 to P0-D7 rows.
5. WHERE a spike result changes a later phase's DoD list (Q33a, Q3), THE loop SHALL update `docs/PHASE-STATUS.md` in the same commit as the RESULTS entry (Requirement 11 criteria 3 and 5).
6. IF a Result_Value of `FAIL` leaves a P1 Entry criterion unmet in a way that §22.3 marks as a block (Q3 plus Q3b), THEN the P0-D4 row SHALL still be `pass` for the answer, and the STOP SHALL be recorded in `docs/PHASE-STATUS.md` as a separate item on P1 (the DoD asks for an answer, not a success).
7. THE loop SHALL NOT set a spike's Result_Value from the pre-check notes of 2026-11-05 without a run (Requirement 6 criterion 8).

## Phase scope

All requirements are P0 and designed in the next round.

| Requirement | Title | DoD ids | Phase |
|---|---|---|---|
| 1 | Default_Core never touched | P0-D4 | P0 |
| 2 | Pre-flight check | P0-D4 | P0 |
| 3 | Cleanup of own paths only | P0-D4 | P0 |
| 4 | The spike register | P0-D4 | P0 |
| 5 | Layout, scripts, re-runnability | P0-D4 | P0 |
| 6 | Result record in RESULTS.md | P0-D4 | P0 |
| 7 | Evidence hygiene and secrets | P0-D4 (SI-8, SI-12) | P0 |
| 8 | Approvals inside spikes | P0-D4 (SI-1, SI-2) | P0 |
| 9 | Budget guard | P0-D4 | P0 |
| 10 | Human steps | P0-D4 | P0 |
| 11 | Branch selection and stop rules | P0-D4 | P0 |
| 12 | Run order and dependencies | P0-D4 | P0 |
| 13 | Group A spikes | P0-D4 | P0 |
| 14 | Group B spikes | P0-D4 | P0 |
| 15 | Group I spikes | P0-D4 | P0 |
| 16 | Group J spikes | P0-D4 | P0 |
| 17 | P0-D4 gate | P0-D4 | P0 |

## Spike register

All credit, quota and time numbers are **Estimates** (assumption A1: one small prompt turn costs about 1 to 3 Kiro credits, to be calibrated by the owner reading the dashboard before and after the first Agent_Spike; assumption A2: wall time counts the run only, not writing the script; assumption A3: Claude quota is counted in prompts per day, not in a unit the loop can measure). Cost class: none = no agent CLI call; low = at most 10 prompts; medium = about 20 prompts or more.

| Spike | Grp | Question (short) | Experiment | Agent CLI call and cost | Run by | Human step | Stop rule | Depends on | Branch selected (affects) | Estimate (credits / time) |
|---|---|---|---|---|---|---|---|---|---|---|
| Q1 | A | `terminal.read` every 250 ms cheap? | hc, full-screen program, 5 min | none | loop (non-interactive) | HS-S1 none; install htop optional (OQ-7) | none (record) | Q2 (schema) | poll 1 s, or line diffs (S-console) | 0 / 30 min |
| Q2 | A | Start a pane with argv, cwd, env, labels | hc schema, terminal.run, list | none | loop (non-interactive) | HS-S5 look at Herdr.app (optional) | none (record; branch `hc attach`) | none | `hc attach` for G3 at machine (S-node-core pane-manager) | 0 / 30 min |
| Q6 | A | Node respawn after a lost pane | hc restart, holder kill, stop/start, stub node | none | loop (non-interactive) | HS-S5 Herdr.app close button | none (record) | Q2 | node polls `terminal.list` every 5 s; `/exit` note (S-sprite-acp, S-crypt) | 0 / 45 min |
| Q12 | A | Does hc say who sent input? | event subscribe plus `hc send` | none | loop (non-interactive) | none | none; expected FAIL | Q2 | drop `herdr-guard` (S-node-core) | 0 / 10 min |
| Q13 | A | Do templates, `first_message`, `terminal.wait` help? | read schema, try them | none | loop (non-interactive) | none | none | Q2 | use sprite as designed (S-sprite-acp note) | 0 / 15 min |
| Q14 | A | herdr-core back after login and reboot? | `pnpm spike q14 --observe-default` (Observe_Mode, allow-list `server.status` only; owner only; not the normal Preflight); Linux unit, reboot | none | owner (interactive terminal) | HS-S4 logout/login, reboot, Linux box | none; PARTIAL allowed | none | `wraith-node` unit runs `hc server start` first (S-ops-packaging) | 0 / 30 min plus owner time |
| Q3 | B | Does Kiro ACP send `session/request_permission`? | acp-echo, `echo hi`, log JSON-RPC | kiro-cli, low | owner (interactive terminal) | HS-S2 login; HS-S3 approval taps | **STOP if Q3 and Q3b both FAIL; notify** | Q43 | approval via ACP (S-approval) or Q3b | 2-6 / 30 min |
| Q3b | B | Does `preToolUse` hook work in `kiro-cli acp`? | hook posts to 127.0.0.1:7782; exit 2 | kiro-cli, low | owner (interactive terminal) | HS-S2; HS-S3 | same STOP rule; Q3 FAIL and Q3b PASS notify | Q43, Q3 (acp-echo) | hook fallback (S-approval, S-node-local-endpoints) | 2-6 / 30 min |
| Q10 | B | Does `@agentclientprotocol/sdk` work with Kiro? | acp-echo SDK vs raw JSON-RPC | kiro-cli, low | owner (interactive terminal) | HS-S2; HS-S3 | none | Q3 (acp-echo) | `packages/acp-lite` (S-sprite-acp, +1-2 days) | 4-10 / 40 min |
| Q11 | B | Kiro MCP http in `session/new`? | `mcpCapabilities`, MCP echo, tool call | kiro-cli, low | owner (interactive terminal) | HS-S2; HS-S3 | none | Q43, Q3 | stdio shim `wraith-mcp-stdio` (S-node-local-endpoints) | 2-6 / 30 min |
| Q4 | B | Does Kiro call `terminal/create`? | `terminal:true`, long command | kiro-cli, low | owner (interactive terminal) | HS-S2; HS-S3 | none | Q43, Q3 | output in ToolCard (S-sprite-acp, S-console) | 2-6 / 20 min |
| Q7 | B | Does `--list-sessions` have JSON? | `--help`, `--format json` | kiro-cli, none (help only, no model) | loop (non-interactive) | none | none | none | ACP `session/list` only (S-crypt) | 0 / 5 min |
| Q23 | B | Stable message ids on replay? | `session/load` twice, compare ids | kiro-cli, low (replay, no prompt) | owner (interactive terminal) | HS-S2 | none | Q3 (session with a tool call) | dedupe with `hash(turnIndex, text)` (S-cloud-bot) | 0-2 / 20 min |
| Q30 | I | Session found again from its cwd? | create, kill, list from cwd | kiro-cli, low | owner (interactive terminal) | HS-S2 | none | Q43 | node `workspaces` table only (P1-D2) | 2-4 / 20 min |
| Q31 | I | Can an agent restrict writes to a folder? | profile with allowlist, write in/out | kiro-cli, low | owner (interactive terminal) | HS-S2; HS-S3 | none | Q43, Q32 (profile generator) | "Outside workspace" badge only (P1 bot creation) | 4-10 / 25 min |
| Q32 | I | Generated `wraith-spike-q32.json` (in `~/.kiro/agents/`) loads and survives edits? | generate, ask, edit, `session/load` | kiro-cli, low | owner (interactive terminal) | HS-S2; HS-S6 confirm `~/.kiro/agents/` write | none | Q43 | default agent, no trusted tools (P1 bot creation) | 4-10 / 30 min |
| Q33 | I | Seat hosting: process, two sessions, swap, fork | a/c/d per agent, 20 min overlap | kiro-cli and claude, medium | owner (interactive terminal) | HS-S2; HS-S3 about 20 taps per agent; HS-S7 Claude terms | Q33a FAIL: notify; copy P9.17-D1..D3 into P2 | Q43, Q32 | `seats` process / swap / none (S-handoff-groupchat, P2, P9.17) | Kiro 25-75; Claude about 25 prompts / 2 h |
| Q35 | J | `available_commands_update` and Claude `supportedCommands()` | log updates, add a skill | kiro-cli and claude, low | owner (interactive terminal) | HS-S2; HS-S7 | none | Q43 | `bot.commands` source acp / files / none (P1-D16) | Kiro 2-6; Claude about 3 prompts / 30 min |
| Q43 | J | Does `acp --agent-engine v3 --agent wraith-spike-q43` start with that agent? | launch (scratch `.kiro/agents/` first, then `~/.kiro/agents/`), initialize, one prompt, any permission request answered `reject_once` | kiro-cli, low (0-1 prompt) | loop (non-interactive) | HS-S2; HS-S6 | none (record) | none (first of the Kiro spikes) | `acp --agent` or select after `initialize` (§4.4/§5 argv, P1) | 0-3 / 15 min |

Estimated totals (labelled estimates): Kiro credits about 45 to 140 over all spikes (typical 70 to 100), of which Q33 is 25 to 75; Claude about 28 prompts; wall time about 8 hours of runs spread over two days; owner presence needed for approval taps (HS-S3) in Q3, Q3b, Q10, Q11, Q4, Q31, Q32, Q33.

## Run order

Proposed order that spends the fewest credits and asks the owner the fewest times. Each stage is serial unless stated. Run_By: stages 0 to 2 run as `loop (non-interactive)` (no tap, no ledger input); stages 3 to 5 and Q14 run as `owner (interactive terminal)`. A non-interactive start of an owner-run spike ends `pending` with the reason "needs interactive terminal" (Requirement 6 criterion 10).

| Stage | Spikes | Run by | Reason | Owner needed |
|---|---|---|---|---|
| 0 | `spike/lib` (preflight, hc wrapper, redact, budget, acp-echo), `pnpm spike` script, pure unit tests | loop | Code only; no cost | no |
| 1 | Q2, Q13, Q12, Q1, Q6 (Test_Core, zero credits) | loop | Q2 writes `spike/hc/schema.json` that the others read; Q6 restarts the Test_Core so it runs last | Herdr.app glance (HS-S5, optional) |
| 2 | Q7, Q43 (Q43: at most one prompt, every permission request `reject_once`) | loop | Zero or near-zero cost, no tap; Q43 decides the `--agent` form used by stage 3 | login (HS-S2) beforehand |
| 3 | Q3, Q3b, Q10, Q4, Q11, Q23 | owner | One acp-echo client; Q23 replays the Q3 session; ordered by what blocks P1 first (Q3, Q3b) | taps (HS-S3), session of about 2 hours |
| 4 | Q30, Q32, Q31, Q35 (Kiro part) | owner | One profile generator shared by Q32 and Q31 | taps (HS-S3), HS-S6 |
| 5 | Q33, Q35 (Claude part) on their own budget day | owner | Medium cost, long run (20 minutes overlapped), 20 taps per agent | taps; HS-S7 |
| any time | Q14 (`pnpm spike q14 --observe-default`) | owner | Needs the owner's logout/login and a Linux machine; Observe_Mode, not the normal Preflight | HS-S4 |

Dependency summary: Q43 before Q3, Q3b, Q10, Q4, Q11, Q23, Q30, Q31, Q32, Q33, Q35; Q3 (acp-echo and a session with a tool call) before Q10, Q23, Q11, Q4; Q32 (profile generator) before Q31; Q2 before the other Group A spikes; no spike of the owner list depends on Q14.

## Authoring estimate

Kiro IDE credits the loop spends on writing the work, kept apart from the run estimates of the Register. Every number is an **Estimate**. Assumption A5: one focused agent turn that edits a few files costs about 1 to 3 credits (same basis as A1), tests about double the turns of the code they cover, and a design or tasks document costs a handful of turns of drafting plus validation.

| Work item | Estimate (credits) | Assumption |
|---|---|---|
| design.md | 8 to 15 | 17 requirements, about 5 turns of drafting, prework and correctness properties for the pure parts (preflight, redactor, allow-list, budget) |
| tasks.md | 4 to 8 | 2 to 3 turns plus the wave graph and validation |
| `spike/lib` (preflight, hc wrapper with Observe_Mode allow-list, redact, budget, runner, acp-echo) with unit tests | 45 to 75 | 6 modules, about 3 turns each plus test turns; Vitest with a fake `hc` |
| Group A scripts (Q1, Q2, Q6, Q12, Q13, Q14 observer) | 25 to 45 | 6 scripts, stub sprite and node stub for Q6 |
| Kiro ACP scripts (Q3, Q3b, Q4, Q7, Q10, Q11, Q23) | 30 to 55 | 7 scripts on one acp-echo client, hook receiver and MCP echo server |
| Group I scripts (Q30, Q31, Q32, Q33) | 20 to 35 | 4 scripts, profile generator, two-process harness for Q33 |
| Group J scripts (Q35, Q43) | 8 to 15 | 2 scripts, Kiro and Claude halves of Q35 |
| RESULTS tooling check (entry parser, evidence-path check) | 5 to 10 | one `tools` check plus tests |
| **Total authoring** | **145 to 258 (typical about 190)** | Sum of the rows above; spread over at least two days |

- THE loop cannot measure credits. The owner reads the real dashboard value after stage 0 (and before and after each later batch) and enters it into the Budget_Ledger (HS-S8); the table is then recalibrated.
- The authoring estimate and the run estimates (Register, about 45 to 140 credits) are separate numbers and SHALL NOT be summed into one figure. The daily 200-credit stop (agent-loop.md stop condition 6) applies to authoring and runs together: on any day, authoring plus run credits must stay at or below 200 (Requirement 9 criterion 11).

## Out of scope

- Every spike outside the owner list: Q5, Q5b, Q5c, Q8, Q9, Q15 to Q22, Q24a, Q24b, Q25 to Q29, Q34, Q36 to Q42, Q44 to Q50. Q5 plus Q5c both failing is a STOP rule of §22.1, out of scope here.
- The design of the branches themselves (S-approval, S-sprite-acp, S-node-core and the others own them).
- The fixture publication of `spike/kiro/q3.jsonl` under `fixtures/` (§17 human review).
- The P0 CI, hooks and platform check (S-ops-packaging) and `packages/protocol` and `packages/crypto` (S-protocol, S-crypto).
- Editing `docs/architecture.md` to match a result (for example §4.4/§5 argv after Q43); the loop records a proposal.
- Spending Cloudflare or GitHub Actions money, publishing anything, pushing to a remote (§22.1).

## Human steps (open items)

Recorded, not performed. The loop never does these (Requirement 10).

| id | Step | Source | Needed before |
|---|---|---|---|
| HS-S1 | Optionally install `htop` for Q1 (`htop` is not on PATH today), or accept the substitute of OQ-7. | §19 Q1 | Q1 |
| HS-S2 | Confirm `kiro-cli` is logged in (Pro). The loop does not call it to check. | §18.1 Entry, Human row; §21.4 | Q3 and every Kiro spike |
| HS-S3 | Run the owner-run spikes (stages 3 to 5, Q14) from an interactive terminal and be present for approval taps: one key press per permission request, no exemption (Requirement 8, OQ-1). About 4 to 8 taps for Q3, Q3b, Q10, Q4, Q11; about 20 per agent for Q33. | SI-1 | Stage 3 to 5 |
| HS-S4 | Q14: log out and in on this Mac, observe; on the Linux GPU box: user unit, reboot, reboot with nobody logged in; paste or approve the observer output. | §19 Q14 | Q14 `PASS` instead of `PARTIAL` |
| HS-S5 | Look at Herdr.app: whether API panes of a test session show there (Q2), what its close button records (Q6), and the PATH of a core started by the Herdr Core app (Q2, via a pane the owner creates). | §19 Q2, Q6 | closing the "unobserved" parts of Q2 and Q6 |
| HS-S6 | Allow one new `~/.kiro/agents/wraith-spike-<q>.json` to be created and deleted per run: always for Q32, and for Q43 and the other Kiro spikes only if Kiro does not read the scratch workspace's `.kiro/agents/` (OQ-12). | §22.1 | Q32, Q43 |
| HS-S7 | Recorded owner answer (OQ-2, 2026-11-18): the Claude Agent SDK may run on the owner's own Claude login for personal local spikes only (H11 default, Q36 not yet run); the owner reads the quota use afterwards. | DECISIONS-PENDING H11 | Q33 (Claude), Q35 (Claude) |
| HS-S8 | Read the Kiro credits on the dashboard before and after each Agent_Spike batch and enter the actual into the Budget_Ledger. | stop condition 6 | each batch |

## Open questions

None open. OQ-1 to OQ-15 are resolved (see "Resolved decisions"); the criteria that cite "OQ-n" cite those decisions.

## Resolved decisions

| id | Question | Decision | Resolved by |
|---|---|---|---|
| RD-1 | Isolation rules | Every spike uses its own `HC_SESSION`, `/tmp/hcw/<q>/` paths, a fail-closed pre-flight, and cleanup of its own paths only (Requirements 1 to 3). | `owner, 2026-11-17` (mandatory item 1) |
| RD-2 | Session and root names | Session `wsp-<q>` (for example `wsp-q6`), root `/tmp/hcw/<q>/`, `XDG_STATE_HOME` and `XDG_CONFIG_HOME` below it (§19 uses `wsp`; the suffix lets two spikes coexist). | `loop, 2026-11-17 (default)` |
| RD-3 | Parallel runs | Serial by default; two Group A spikes may run together only on separate sessions. | `loop, 2026-11-17 (default)` |
| RD-4 | Register, layout, records | Register table in this document; code and raw evidence in `spike/`; results in `docs/spikes/RESULTS.md` (Requirements 4 to 6). | `owner, 2026-11-17` (mandatory items 2 and 3) |
| RD-5 | Secrets and unsafe flags | Evidence redacted with the SI-8 pattern set; secret scan covers `spike/` and `docs/spikes/`; spikes use no always-approve flag; `spike/` is exempt from product-code scans only (Requirement 7). | `owner, 2026-11-17` (mandatory item 4) |
| RD-6 | Budget | Estimates labelled, per-spike budget guard, 200 credits a day limit applies (Requirement 9). | `owner, 2026-11-17` (mandatory item 5) |
| RD-7 | Human steps | Recorded as open items, never performed by the loop (Requirement 10). | `owner, 2026-11-17` (mandatory item 6) |
| RD-8 | Branches and STOP | Each spike records its branch by §19.1; Q3 plus Q3b both failing stops and notifies (Requirement 11). | `owner, 2026-11-17` (mandatory item 7) |
| RD-9 | Order | Stages of "Run order" (Requirement 12). | `owner, 2026-11-17` (mandatory item 8) |
| RD-10 | P0-D4 gate | `pass` only with an answer and evidence for every listed spike; Q14 may be `PARTIAL` (Requirement 17). | `owner, 2026-11-17` |
| OQ-1 | Q33 needs about 20 edits per agent, each a permission request. Taps per request are the only answer path (Requirement 8). May the owner instead approve a one-time, written exemption (for example a throwaway profile that trusts writes inside the Scratch_Workspace only)? That would touch SI-2 text "only read-only tools run without asking", so the loop cannot decide it. | No exemption. Per-request taps (SI-1, SI-2 unchanged); Q33 runs on its own day. | `owner, 2026-11-18` |
| OQ-2 | Q33 and Q35 need the Claude Agent SDK, but Q36 (terms, auth) is not in P0 and H11 says "own login if Q36 confirms". May the Claude halves run on the owner's own login for personal spikes? | Yes: the Claude halves of Q33 and Q35 run on the owner's own Claude login, for personal local spikes only (HS-S7). | `owner, 2026-11-18` |
| OQ-3 | Daily ceiling for spike credits. | 100 credits (estimate) of the 200 limit; Q33 on its own day. | `owner, 2026-11-18` |
| OQ-4 | Credit cost per prompt is unknown to the loop. | Assumption A1 (1 to 3 credits); the owner calibrates after the first Agent_Spike. | `owner, 2026-11-18` |
| OQ-5 | Q14 must observe the Default_Core (the Herdr Core app's core), which conflicts with "no hc command targets default". | Read-only observer limited to `server.status` and file `stat`, listed as the only exemption (Requirement 1 criterion 8); the `PATH` check runs inside a pane the owner creates. | `owner, 2026-11-18` |
| OQ-6 | Herdr.app visibility (Q2) and close-button record (Q6) need the human. | Q2 and Q6 are `PASS` on the automated criteria, with the Herdr.app lines marked "unobserved" until HS-S5. | `owner, 2026-11-18` |
| OQ-7 | `htop` is not installed (Q1 names htop). | Use macOS `top -s 1` as the full-screen program and record the substitute; the owner may install htop (HS-S1) and re-run. | `owner, 2026-11-18` |
| OQ-8 | When Q3 passes, §19.1 says Q3b is "not needed", but P0-D4 lists Q3b. | Run Q3b anyway (low cost) and record its answer; it also informs T2 hooks. | `owner, 2026-11-18` |
| OQ-9 | §19 puts scripts at `spike/<group>/<q>.ts` and names `spike/acp-echo.ts`; the owner wants per-spike folders. | `spike/<dir>/<q>/<q>.ts` with `evidence/`, shared code in `spike/lib/` (`acp-echo.ts` moves there); paths named by the architecture are kept as links. | `owner, 2026-11-18` |
| OQ-10 | The §19 result format (columns Q, date, runner, result, evidence, affects) differs from the existing RESULTS tables (columns Q, group, runner, result, evidence, branch chosen, date, and other columns in groups H to J). | Keep the tables as a summary and add an `## Entries` section with one `### Qn` block per spike carrying all §19 and §22.5 fields. | `owner, 2026-11-18` |
| OQ-11 | `spike/` is not a pnpm workspace (`pnpm-workspace.yaml` lists `apps/*`, `packages/*`, `tools`). Q10 needs `@agentclientprotocol/sdk`. | Add `spike` as a private workspace package with no `test` or `build` script, updating the lockfile; confirm the SDK license is permissive and record it in THIRD_PARTY.md. | `owner, 2026-11-18` |
| OQ-12 | §22.1 reserves `~/.kiro` for the human, with one exception for product code (`wraith-<botId>.json`). Q32 and Q43 need such a file. | As amended: the file is `wraith-spike-<q>.json` everywhere (Kiro `--agent wraith-spike-<q>`). Q43 tries the scratch workspace's `.kiro/agents/` first and falls back to `~/.kiro/agents/`; Q32 always uses `~/.kiro/agents/` because that path is what it tests. | `owner, 2026-11-18` |
| OQ-13 | The redactor of SI-8 (`tools/redact.ts`) does not exist yet, and `tools/lib/secret-rules.ts` exposes match offsets only inside its module. | Redact whole lines that `scanText` reports, using the same rule set, plus home path and env-value masking; no change to `tools/`. | `owner, 2026-11-18` |
| OQ-14 | Is the redacted `q3.jsonl` committed under `spike/kiro/` before human review? | Yes under `spike/` (the repo is public, the secret scan guards it); promotion to `fixtures/` is a later reviewed step. | `owner, 2026-11-18` |
| OQ-15 | §22.3 has no "notify" entry for Q4, Q7, Q12, Q13, Q14, Q23, Q30, Q31, Q32. | Record, no notify, unless the branch changes a DoD. | `owner, 2026-11-18` |
| RD-11 | R5.8 exception: `@anthropic-ai/claude-agent-sdk` (npm license "SEE LICENSE IN README.md", Anthropic terms, not permissive). | Allowed as an exact-pinned devDependency of `@wraith/spike` only, never shipped, no other package; recorded in THIRD_PARTY.md and DECISIONS-PENDING (`S-spikes-1`). | `owner, 2026-11-18` |

## Facts verified from the repository and the machine

Checked on 2026-11-17 with read-only commands.

- `hc` is at `/Users/meawpipat/.local/bin/hc`; `hc --version` prints `hc 0.1.20`, which meets the P0 Entry minimum of 0.1.18 and Q1's 0.1.17. `HC_SESSION` is empty and no `HC_*` or `HERDR_*` variable is set in the loop's environment. `/tmp/hcw` does not exist. `~/.config/herdr-core` does not exist.
- A Default_Core is running: `pgrep` lists `herdr-core` holder processes whose sockets are under `~/.local/state/herdr-core/default/`, plus the Herdr Core app's core and a `--hc-launchd` process. These hold the owner's live panes and are the reason for Requirements 1 to 3. `/Applications/Herdr.app` exists.
- `kiro-cli` and `claude` are on PATH (`command -v`: `/Users/meawpipat/.local/bin/kiro-cli`, `/Users/meawpipat/.local/bin/claude`). Deviation to report: the author also ran `kiro-cli --version` (2.37.0) and `claude --version` (Claude Code 2.1.323), although the instruction said not to call either CLI. Both are version flags with no model call and no login use; no credits are expected. Whether Kiro is logged in was not checked (HS-S2).
- `htop` is not on PATH; `env` and `node` v22.15.0 are. Platform is Darwin arm64. `/tmp` is on a volume with about 13 GiB free.
- `spike/` holds only `.gitkeep`. There is no `spike/hc/schema.json` and no `tools/redact.ts`. `docs/spikes/RESULTS.md` (71 lines) has a row per question, all `pending`, with pre-check notes dated 2026-11-05 for Q1, Q2, Q6 and Q12 (hc 0.1.16), and group tables H, I, J in other column layouts; Q30 to Q35 and Q43 are `todo`.
- `docs/PHASE-STATUS.md` row P0-D4 is `todo` with empty evidence; the listed ids are Q1, Q2, Q3, Q3b, Q4, Q6, Q7, Q10, Q11, Q12, Q13, Q23, Q30, Q31, Q32, Q33, Q35, Q43. P0-D1 to D3, D5, D6, D7 are `pass`.
- Root `package.json` has no `spike` script (scripts: `check:platform`, `check:secrets`, `check:pins`, `check:suites`, `check:si`, `verify:local` and others). `pnpm-workspace.yaml` lists `apps/*`, `packages/*` and `tools`; `spike/` is not a workspace.
- `.kiro/hooks/` holds `no-auto-approve.json`, `no-trust-all.json`, `secret-scan.json`. `secret-scan.json` runs `tools/secret-scan.ts --hook-stdin` on `PreToolUse` for write and shell tools. `.kiro/agents/` and `.kiro/settings/` are empty. `~/.kiro/agents/` exists and holds other agents.
- `tools/secret-scan.ts` modes: `--staged`, `--changed <base>`, `--tracked`, `--tree`, explicit paths, `--hook-stdin`. `--tree` takes `git ls-files --cached --others --exclude-standard`, so `spike/` and `docs/spikes/` are scanned unless git-ignored. `.githooks/pre-commit` runs `--staged` and is active only after `core.hooksPath` is set (S-ops HS-3). `tools/lib/secret-rules.ts` classes: github-token, aws-access-key, slack-token, jwt, pem-private-key, jwk-private, vapid-private-key, setup-token, node-key.
- `tools/lib/si-rules.ts` excludes `packages/fakes/`, `spike/`, `fixtures/`, `docs/`, `.kiro/` from the product-code scan; §4.10 excludes `spike/` from `tools/check-platform.ts`. Security.md states that the unsafe tokens may be spelled only in `packages/protocol/src/unsafe.ts` and that tests, fakes, `spike/` and fixtures are not product code (no exempt folder for the spelling rule).
- `docs/DECISIONS-PENDING.md` H11 (Claude Agent SDK terms and auth) is resolved by default: own login if Q36 confirms. Q36 is not in P0.
- Architecture facts: §19 Groups A, B, I, J at lines 2057 to 2150 (Q-rows), §19.1 at 2171, §18.1 at 1886, §22.2 at 2339 to 2348, §22.3 at 2349 to 2395. §22.3 has no row for Q4, Q7, Q12, Q13, Q14, Q23, Q30, Q31, Q32. §19.1 has no combined row for Q1, Q2, Q4, Q6, Q7, Q10 to Q14, Q23, Q30 to Q32 (their branches are in the §19 tables). The §19 Q3 command line uses `--agent-engine v3 --agent spike`, while Q43 asks whether V3 `acp` rejects `--agent`.

- HC_* variables (read-only check, 2026-11-18): `hc --help` (0.1.20) does not mention `HC_SCOPE`, `HC_TERMINAL_ID`, `HC_TERMINAL_SOCKET` or `HC_SOCKET`; a grep of `docs/` and `spike/` finds `HC_TERMINAL_ID` only in §19 Q2 (set in the child of `terminal.run`, to be confirmed by the spike) and `HC_SOCKET` only in §4 (first in hc's socket resolution order). What `HC_SCOPE` and `HC_TERMINAL_SOCKET` do is **unverified**. This spec assumes, as a hazard, that a Herdr pane exports `HC_SCOPE`, `HC_TERMINAL_ID` and `HC_TERMINAL_SOCKET` (per the owner) and that an inherited socket or scope variable could steer `hc` to the owner's core, so none is passed on (Requirement 1 criterion 6, Requirement 2 criteria 13 to 15). Q2 records the real behaviour.

## Dependencies on other specs

| Spec | What this spec needs or gives |
|---|---|
| S-ops-packaging | Gives `tools/secret-scan.ts`, `.githooks/pre-commit`, CI tree scan and the SI scanners that apply to `spike/` and `docs/spikes/` (Requirement 7); P0-D1 CI runs `pnpm install --frozen-lockfile`, so a new `spike` workspace package needs an updated lockfile (OQ-11). Q14 feeds its service units (P8). |
| S-protocol | Gives `packages/protocol/src/unsafe.ts` (Requirement 7 criterion 10) once it exists; owns the `E_*` and message shapes the spike traces will later inform. |
| S-node-core | Consumes Q1, Q2, Q6, Q12, Q13 (pane-manager, respawn, console) and the fake-hc contract test against `spike/hc/schema.json`. |
| S-sprite-acp | Consumes Q3, Q3b, Q4, Q10, Q43, Q23, Q35. |
| S-approval, S-node-local-endpoints | Consume Q3, Q3b (approval path), Q11 (MCP http or stdio shim). |
| S-handoff-groupchat | Consumes Q33 (`seats`), Q34 is out of scope here (P2 Entry). |
| S-crypt, S-cloud-bot | Consume Q7, Q23. |
| All specs | Read `docs/spikes/RESULTS.md` before the dependent phase starts (§19). |
