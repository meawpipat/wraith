# Spike results

One entry per question. Plan, pass/fail criteria and fallback branches are in `docs/architecture.md` §19 and §19.1.

| Q | group | runner | result (pass/fail) | evidence | branch chosen | date |
|---|---|---|---|---|---|---|
| Q1 | A | see §19 | pending · pre-check 2026-11-05: `terminal.read` is plain text ✅; cost pending | | | |
| Q2 | A | see §19 | pending · pre-check 2026-11-05 (hc 0.1.16, test core): cwd/env/labels ✅; record schema + Herdr.app visibility | | | |
| Q6 | A | see §19 | pending · pre-check 2026-11-05: core restart keeps pid ✅, holder kill → `holder_lost` ✅; node respawn pending | | | |
| Q12 | A | see §19 | pending · expected FAIL (no input-source event in 0.1.16 schema) | | | |
| Q13 | A | see §19 | pending | | | |
| Q14 | A | see §19 | pending | | | |
| Q3 | B | see §19 | pending | | | |
| Q3b | B | see §19 | pending | | | |
| Q4 | B | see §19 | pending | | | |
| Q7 | B | see §19 | pending | | | |
| Q10 | B | see §19 | pending | | | |
| Q11 | B | see §19 | pending | | | |
| Q23 | B | see §19 | pending | | | |
| Q8 | C | see §19 | pass (user has Kiro Pro; credits requested) | | | |
| Q19 | D | see §19 | pending | | | |
| Q20 | D | see §19 | pending | | | |
| Q21 | D | see §19 | pending | | | |
| Q22 | D | see §19 | pending | | | |
| Q5 | C | see §19 | pending | | | |
| Q5b | C | see §19 | pending | | | |
| Q5c | C | see §19 | pending | | | |
| Q15 | C | see §19 | pending | | | |
| Q16 | C | see §19 | pending | | | |
| Q17 | C | see §19 | pending | | | |
| Q18 | C | see §19 | pending | | | |
| Q24a | E | see §19 | pending | | | |
| Q24b | E | see §19 | pending | | | |
| Q25 | F | see §19 | pending | | | |
| Q25b | F | see §19 | pending | | | |
| Q26 | F | see §19 | pending | | | |
| Q27a | F | see §19 | pending | | | |
| Q27b | F | see §19 | pending | | | |
| Q28 | F | see §19 | pending | | | |
| Q9 | G | see §19 | pending | | | |

## Group H — Local hardware approver (optional, blocks P9.12)
| Q | status | result | evidence | branch |
|---|---|---|---|---|
| Q29 Secure Enclave + Touch ID without Apple Developer ID | todo | | | |

## Group I — Workspaces (blocks P1-D2 session resume)
| Q | status | result | evidence | branch |
|---|---|---|---|---|
| Q30 Kiro ACP session findable from its cwd | todo | | | |
| Q31 Kiro profile can restrict writes to the workspace folder | todo | | | |
| Q32 Generated Kiro custom agent per bot (instructions) loads and survives edits | todo | | | |
| Q33 Seat hosting (DECISION-54): a two processes/same folder · b two sessions/one process · c swap via `session/load`/`resume` · d fork (Kiro, Claude) | todo | | | |
| Q34 Kiro ACP tool calls carry file locations (attribution for Changes) | todo | | | |

## Group J — Agent drivers (Q35, Q43 block P1; Q36–Q38 block P9.14/P9.15; Q39–Q42 block P9.16; Q44 blocks P9.17's Codex part; Q45 blocks P9.18; Q46 blocks P9.19)

| Q | result (pass/fail) | evidence | branch chosen | date |
|---|---|---|---|---|
| Q35 Agents advertise commands/skills (ACP `available_commands_update`, Claude `supportedCommands()`) | todo | | | |
| Q36 Claude Agent SDK driver: terms/auth, PreToolUse gate beats settings allow-rules, checkpoints + rewind | todo | | | |
| Q37 Kiro `/checkpoint` usable over ACP with structured data | todo | | | |
| Q38 Grok Build over ACP: every write/execute waits for approval (ACP or PreToolUse hook) | todo | | | |
| Q39 Claude Terminal-mode round trip (SDK → `claude --resume` → SDK, same session id, one transcript) | todo | | | |
| Q40 Claude TUI guard (manual start, no auto/bypass, `--settings` hooks fire, busy/idle) | todo | | | |
| Q41 Checkpoints across the Terminal-mode detour | todo | | | |
| Q42 Kiro Terminal mode (`kiro-cli chat --v3 --resume-id` ⇄ ACP `session/load`, one process at a time) | todo | | | |
| Q43 Kiro V3 `acp --agent` accepted, or agent selected after `initialize` | todo | | | |
| Q44 Codex T1 driver: permission requests through the protocol, several threads in one process, SI-2 flags (blocks P9.17's Codex part) | todo | | | |
| Q45 Voice input: (a) Thai-English accuracy of whisper.cpp large-v3 / Thonburian distill / Web Speech on 20 owner commands · (b) Zepp OS audio recording · (c) Thonburian license (blocks P9.18) | todo | | | 2026-11-04 pre-test, one sentence "ฉันอยากกินสตาร์บัคส์จังเลย": Paxa ✓ · OpenAI large-v3 (HF) "Starbucks" ✓ · large-v3 q5 ggml 2.1 s ✓ · Thonburian distill 1.4 s ✓ · Pathumma ✓ · large-v3-turbo ✗ ("ตะตาบ๊ัก") · Whisper with a vocabulary prompt returned nothing |
| Q46 Media transfer: (a) 20 MB image / 50 MB preview through the Cloudflare relay in 32 KB chunks · (b) iOS Safari blob video playback and photo picker output · (c) ffmpeg preview time (blocks P9.19) | todo | | | |
