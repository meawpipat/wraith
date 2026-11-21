---
inclusion: always
---

# Agent loop: how to work in this repo (§18–§22)

## Picking work
1. Read `docs/PHASE-STATUS.md` to find the current phase. Then read that phase in `docs/architecture.md` §18 (scope in/out, entry criteria, DoD), the mapped specs in §20, and the guardrails in §22.
2. Phase order: P0 Spikes & scaffold → P1 Local core → P2 Group chat → P3 Kiro Cloud bot → P4 Remote relay → P5 Desktop → P6 Submission (time-boxed) → P7 Watch → P8 Crypt & resilience → P9 Extensions.
3. If the current phase is blocked on the human, switch to the next phase whose **entry criteria are met**, and come back later.
4. Start a new phase only when its entry criteria are met **and** at least 90% of the *applicable* DoD items of the previous phase have passed. "Previous phase" = the nearest lower-numbered phase that is not `blocked-human`. DoD items that depend on a phase not yet done are not applicable and do not count. Record any leftovers in `PHASE-STATUS.md` with a reason. Leftovers must not involve SI-*.
5. **P6 is time-boxed.** Enter it on 2026-11-26 or when P5 is done, whichever comes first. Do not start a new phase until P6 is done.

## Decision authority (§22.1)
| Decide yourself | Log in `docs/DECISIONS-PENDING.md`, take the default, continue | Stop and wait for the human |
|---|---|---|
| Code structure, names, small permissive-licensed libraries | Tuning numeric limits/timeouts within ±50% based on spike evidence (**excluding** lease/self-fence timing 15/35/45 s, replay windows 7/8 days, and the approval timeout, which are human-gated) | Anything touching **SI-1…SI-14**, the cap matrix (§12.2), the signature scope (§6.1), or lease timing (§7.4.2) |
| Choosing a branch from a clear spike result (§19.1) | Small UX copy/layout deviations (attach a screenshot) | Spending money; deploying to real accounts; publishing to stores, npm, Docker Hub, the Homebrew tap, winget or Scoop; submitting to Devpost; posting on social media |
| New `E_*` codes (and update the doc) | New or changed migrations; new native dependencies | Changing any **locked decision** (§24.1), even if it looks better. Write a proposal instead. |
| Adding tests or PBT | Moving work between phases without changing the DoD | Spike results marked STOP (Q3+Q3b both fail; Q5+Q5c both fail) |

## Stop conditions (§22.2): stop and summarise for the human
1. A spike result says STOP.
2. A DoD item fails 3 rounds in a row after fixes.
3. An SI-* test fails and the fix would relax the invariant.
4. A missing credential, account or device blocks the work, and no other phase is ready.
5. The architecture doc contradicts itself on security or DoD. Cite the § and propose a fix. Do not guess.
6. Budget: more than 200 Kiro credits per day, or Cloudflare spend above US$2 in a day (the human is on Workers Paid; P4-D10 still measures Free-plan-equivalent usage), or any GitHub Actions spend.
7. It is 2026-11-26 and P6 has not started.
8. A secret leaked into a commit or log. Stop, revoke, and report.

## Status files (§22.5)
- `docs/PHASE-STATUS.md`: `phase | DoD id | status (todo/pass/fail/blocked-human) | evidence | date`
- `docs/spikes/RESULTS.md`: one entry per spike: question, experiment, result, evidence, branch chosen.
- `docs/DECISIONS-PENDING.md`: `id | date | question | default taken | impact if changed | resolved?`

## Locked decisions (§24.1): do not reopen
- No primary machine.
- `relay-core` with Local as the default.
- No E2E.
- No public relay.
- Pane approval OFF (only exception: Terminal mode, DECISION-52).
- ACP engine v3.
- Cloud Status Bot fallback.
- Cloud `@` delegation is the headline feature. Fall back only after telling the human.
- Web Push may degrade to in-app.
- No scope cuts for the deadline.
- Desktop is Tauri v2 (Electron as fallback). Distribution is build-from-source plus unsigned releases.
- Mobile is a PWA now and Capacitor later.
- The watch is an Amazfit Active 2 (Square) paired with an **iPhone**: mirrored notification → open the Mini Program is the primary path.
- Repo docs are in English. `docs/architecture.md` (English, v4.1) is the master.
- The repo is **public from the first push**. Secret scanning + push protection and the `secret-scan` hook must be on before that push (DECISION-19).
- Bots may only **ask** to spawn bots (`wraith_spawn_request`); a device-signed `allow_once` is required, only for agents with `spawnableByBots` (Settings), counted in the loop-guard budget (DECISION-20, P2).
- Bots are **workspace-centric**: one bot per folder (`nodeId:realpath`), ULID botId stored per workspace, rooms independent (DECISION-24). Kinds: project (any folder incl. a root; leading is derived from the tree), project assistant (`<project>/.wraith/assistants/<name>`), standalone (`~/.wraith/scratch/<name>`). Read anywhere under roots; write only in own workspace (parents also below them). Bots may request new bots only inside their own subtree (DECISION-25).
- **No preset profiles** (DECISION-26): a bot = workspace + detected agent + optional instructions. Wraith writes only `wraith-*.json` files in `~/.kiro/agents/` (the one other exception: on a signed `bot.terminalResolve`, exactly the listed Claude settings entries, after a backup, DECISION-52).
- Bot **name** ≠ identity (DECISION-27): unique in the Space, used for `@mention`, prefilled from the folder, renamable without moving the folder.
- **Chats** (DECISION-28): each bot has its own chat (`dm-<botId>`); groups are created separately from existing bots; replies go back to the chat the prompt came from. Sessions: the main session serves the bot's own chat and bot handoffs; each group the bot belongs to has its own seat (DECISION-31/32).
- **Roots** (DECISION-29): `workspaceRoots` is a list, never `~` by default; projects elsewhere are added as their own root (`node.roots`, desktop picker, `wraith-node open`).
- **Group seats** (DECISION-31/32): each group a bot joins gets its own session in the same workspace (process mode: its own agent process `--seat <roomId>`; swap mode: a session in the bot's one process, opened with `session.open`), seeded with a user-visible summary (fork opt-in); one workspace write lock across the bot's sessions, taken only after Allow; bot handoffs run in the target's main session with a "Worked for…" card; fallback per Q33a–c: `seats: process | swap | none` — `swap` = one process switching sessions, never one session for two chats (DECISION-54); swap is built in P2 only if Q33a fails for Claude or Kiro (then copy P9.17-D1…D3 into P2 in `PHASE-STATUS.md`), else P9.17 with the Codex driver (Q44); Kiro Cloud bots cannot join groups.
- **Allow always** is not offered for write-kind tools while a bot has ≥ 2 live sessions (DECISION-33). Group chat is mention-driven: unmentioned messages are context only.
- **Voice input** (DECISION-55, P9.18): dictation only — speech → editable draft, never auto-sent, never an approval; per-device engine **Automatic** (node if any `caps.voice.ready`, else Browser speech) / Wraith node / Browser speech; node engine whisper.cpp (Whisper large-v3, Thonburian distill fallback), no prompt hint to Whisper, spoken names fixed to `@handles` from room members; audio and transcripts are never stored or logged; cloud engines only by owner opt-in.
- **Group seat panes are read-only** (DECISION-34): no stdin, no Take control (`E_SEAT_READ_ONLY`); messages to a group come only from the group chat.
- **Files and Changes** (DECISION-35): read-only views per bot workspace, opened from small icon buttons in the bot-chat header (not in groups); Changes in P2 with attribution, Files in P9.13; device-only, not persisted, deny-list, redacted.
- **Add machine** (DECISION-36): ticket screen with a copyable `wraith-node pair <relay> <ticket>` command; the node prints QR + `WRP1-` text code + key fingerprint; a desktop owner pastes the code. Local mode cannot add machines (UI rule from reachability) → "Needs an external relay" → a new Space.
- **Add device** (DECISION-37): pairing link `https://<relay>/pair#<ticket>`; the device shows QR + code + fingerprint; the **owner chooses access** Full (`device`) / Approve only (`watch`) / View only (`viewer`). No password login; unpaired browsers see only `/pair`. iOS Safari never creates a key on `/pair` or `/setup` (Add to Home Screen first).
- **Machine vs device** (DECISION-38): a computer is a machine only while its node runs with a roster key. Wraith.app Join has "Also run bots on this Mac"; upgrade/downgrade per role; pause ≠ revoke (`paused` state, `node.paused`). `/machines` is grouped by computer.
- **Phone Home** (DECISION-39): `/` is a chat list sorted by latest event (waiting chats first); Search / New / Settings icons; no bottom tab bar; Back → Home.
- **Settings** (DECISION-40): theme default System; Needs you / Bot finished / Bot stopped, security alerts always on; Touch ID waits for P8; no tray-icon toggle.
- **Approval timeout** (DECISION-41): per machine, 1–240 min, changed by signed `node.configure` (owner/Full only), pushed to sprites with `config`, new requests only. The 30-min default and the range stay human-gated.
- **Pairing payload and Join** (DECISION-42): one `WRP1-` code/QR with full public key(s) + 128-bit secret for every member, never a fingerprint-only code; Join = one ticket, one two-member offer, one HMAC; the secret reaches Wraith.app only via the sidecar's stdout pipe.
- **Local mode** (DECISION-43): relay-core has no mode-specific pairing rule (a second node on the same machine can pair over `127.0.0.1`; P2 tests use it); in Local mode "Run bots on this Mac" is replaced by **Pause all bots**.
- **`/` command picker** (DECISION-44): agents advertise their skills via ACP `available_commands_update` → node-signed `bot.commands` (folder-scan fallback per Q35); composer shows Wraith actions (`/cancel`, `/queue`, `/status`, `/rewind` where supported) and the bot's skills; `@bot /` in groups. Picking only inserts text; descriptions are untrusted, display-only.
- **Autopilot** (DECISION-49/50): the user's bypass for AI loops, **bot chats only, never groups**. The agent still asks; the node auto-answers `allow_once` only for user-started turns via a fail-closed classifier (§7.2.1): hard floor always asks (sudo, `sh -c`, scripts, outside write area, secret files, spawn, `hc`/`herdr`), default rules switchable by the owner; off on Stop/Freeze/pause/device revoke, ≤ 24 h; no push for auto-approved calls; the approval sheet only *suggests* it after 3 allows in 10 min. Agent-native bypass flags stay forbidden.
- **Terminal mode** (DECISION-52, §8.1): the owner or a Full device can hand a T1 local bot's **main session** to the agent's own TUI in the same pane and back (`bot.terminal`); one driver per session at a time (close and wait for exit before launching the other); guarded TUI launch (Claude: `--permission-mode manual` + `--permission-prompts host` + no user setting source + `--settings` guard disabling auto/bypass; Kiro: `--v3 --resume-id`); write lock held (no expiry), Autopilot off, user messages **and handoffs** to the main session queue, commands aimed at the main session → `E_TERMINAL_ACTIVE`; the bot's seats queue new prompts until the return path ends (and while `settingsChanged` waits in `needs_resolve`), the lock is released at `needs_resolve`, `bot.kill` ends the stay; settings-file `PreToolUse`/`PermissionRequest` hooks refuse the launch; on return (node-owned, also after crashes) import ≤ 50 turns as `bot.terminalTurn` "from terminal · not verified" (chat only, never in any bot's context), `needs_resolve` until the owner chooses, git diff card, settings re-check (`E_TERMINAL_SETTINGS_CHANGED`) and session-id check (`E_TERMINAL_SESSION_DIVERGED`). TUI-only `/` commands and unknown names are never sent to the agent: they offer "Open in terminal and run it" (typed without Enter). Per agent only after Q39–Q42; Q43 (Kiro V3 `--agent`) blocks P1.
- **Group context and handoff modes** (DECISION-53): each seat has a watermark `delivered_seq`; a seat prompt carries only unseen signed group events (≤ 24 KB, then a summary line), never thinking or tool commentary; `wraith_room_context` pages with `beforeSeq`; `wraith_mention` has `mode: assign` (default, result returns) or `transfer` (after the relay ack the node sends `prompt.transferred` and the sprite cancels the turn; no auto-return; relay errors mean no transfer; one per turn; result answers the original requester via `prompts.handoff_mode`, climbing past every requester that itself transferred; `prompt.transferred` releases the holder's lock, cancels open approvals and is not a `bot.cancel` for Autopilot). The block is built and the watermark moved when the node creates `bot.prompt` (stored in `payload`, never rebuilt); summary prompts carry it too. Do not add LLM routing of unmentioned messages or model-declared resources.
- **Respond / nudge** (DECISION-51): in groups, long-press a member chip (desktop hover) or the bot card's button sends a signed `room.nudge`; the bot answers the latest group messages; never Autopilot-eligible.
- **Grok Build** (DECISION-48): T0 only until spike Q38 proves every write/execute waits for a Wraith approval (ACP `request_permission` or a blocking `PreToolUse` hook); never launch it with always-approve/auto/yolo; no Rewind.
- **Rewind and the Claude driver** (DECISION-47): Claude approvals go through the sprite's SDK `PreToolUse` hook (deny on timeout/error), Claude launches with no user setting source and the effective launch is checked (SI-2, DECISION-60), `allow_always` lives in memory only, SDK license/auth = H11. Rewind uses only the agent's own rewind (Claude via Agent SDK `rewindFiles`/`resumeSessionAt`, Kiro `/checkpoint` only if Q37 shows it works over ACP with structured data); no fork/summary fallback; bot chats only, every session of the bot idle, Full devices, file list bound by `filesHash` (`bot.rewindPreview`); history is greyed, never deleted.
- **Claude launch** (DECISION-60): a Claude bot never loads the user setting source (and no project/local source for now), so the owner's own `~/.claude/settings.json` never reaches it and is never read or changed; SI-2 checks the effective launch (sources, permission mode allow-list `manual`/`default`, `--permission-prompts` = `host`, allowed tools, guard, managed files); an unchecked Claude Code version (below 2.1.323) is a notice, not a refusal.
- **Stop vs Freeze** (DECISION-46): Interrupt = send button turns into ■ Stop while a bot works (chooser in groups); Freeze stops handoffs only and uses a ❄ icon.
- **Esc to stop** (DECISION-45): desktop Esc closes popups first, then Esc Esc (2s) sends `bot.cancel` → ACP `session/cancel` for every agent; groups with several working bots get "Stop which bot?"; Take control passes Esc to the terminal.
- Naming: the per-bot pane process is **`wraith-sprite`** and the UI motif is sprites (DECISION-23). Do not reintroduce "ghost".
- Desktop has a **direct local channel** to the node on the same machine (`127.0.0.1`) for device-signed approvals/freeze when the relay is down; same verifier, P5-D9 (DECISION-22).
- herdr-core is **not bundled** in the desktop app; first-run checks it and offers to install it after the user confirms (DECISION-21). Wraith targets herdr-core, not the herdr TUI (DECISION-58).
- No pane passphrase approval. A Touch ID approver (a roster *device* with watch-like caps) is **optional P9.12**: do it last, only after P9.1–P9.16 are done or skipped, and only after the human says go (DECISION-18).
- **Spaces and relay switching** (DECISION-56): a machine keeps one folder per Space (`~/.wraith/spaces/<spaceId>/trust.json`) and one `node.key`; Space-scoped `node.db` rows carry `space_id`; the relay is switched only on the machine (CLI in P4, Wraith.app wizard in P5), never by a message (the CLI talks to a running node over `~/.wraith/control.sock`); Switch only when every bot is idle/paused/dormant/closed/failed with no queued prompt, Terminal stay or cloud-host lease; the switch turns Autopilot off and clears grants; main `bot_sessions` rows have `space_id NULL`.
- **Images and video** (DECISION-57, P9.19): Wraith does not generate media — bots do (their own tools, or a bot whose instructions drive the owner's GPU pipeline). Wraith moves media: `wraith_share_file` → node-signed `media.shared` with a ≤ 32 KB thumbnail; full image (≤ 20 MB) or 720p video preview streamed on demand in 32 KB chunks; uploads (bot chats only) land in `<workspace>/.wraith/media/in/`; `wraith_share_file` asks like `wraith_post`; no push or watch item for media; image metadata is stripped by a deterministic TS stripper, ffmpeg is for video only. Do not add a Generate feature, provider integrations, relay-side media storage or automatic sharing of files.
