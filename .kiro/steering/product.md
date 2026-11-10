---
inclusion: always
---

# Product: Wraith

Wraith is **one place to chat with all your AI coding agents** ("bots"), whichever machine they run on, plus Kiro Cloud sessions. Each bot has its own chat, and you can put several bots in a group chat. You can use it from a phone, the desktop app, or a smartwatch. Every bot lives in a **herdr pane**, so you can switch between **Chat mode** (structured bubbles, tool cards, diffs) and **Console mode** (the real terminal) at any time.

The full architecture is in `docs/architecture.md`. It is the source of truth. Section numbers (§) in specs and steering refer to that document. When writing specs, carry every requirement you use from it into `.kiro/specs/`.

## Differentiators (what we sell)
1. A **Kiro Cloud session is a bot** next to the bots on your machines (own chat only; cloud bots don't join groups). Cloud bots can **delegate with `@name`**. This is the headline feature (DECISION-9).
2. **Per-command approval from phone or watch.** Approvals are signed with the device key.
3. **Group chat between bots.** Bots can @mention each other, hand off a task, and return the result. A loop-guard prevents runaway chains.
4. **Many vendors in one room:** Kiro (local and cloud), Claude Code, local LLMs, and any other CLI.
5. **Every terminal is a herdr pane** (a herdr-core terminal) that can switch to Chat mode.
6. **The Crypt** (theme feature): closed sessions can be resurrected back into the room with their context.
7. **One folder, one bot** (DECISION-24). A bot is identified by its workspace folder (`node:realpath`). Reopening the folder always returns the same bot and session, and the folder tree is the bot hierarchy (a parent folder's bot coordinates its sub-folder bots). Chat-first tools treat the folder as secondary and let sessions collide in one folder.

Baseline features (needed, but not selling points): mobile PWA, Web Push, ACP, dashboard, desktop app.

## Goals
- **G1** Message one or many bots and watch streaming replies on a phone.
- **G2** Approve or reject a bot action from the phone in 2 taps, with Web Push when a bot is blocked. If Web Push is not possible, fall back to in-app notifications (DECISION-8).
- **G3** See the console of every bot through herdr panes.
- **G4** Bots hand off work to each other, and results return to whoever asked, with loop protection.
- **G5** Bots from many machines and from Kiro Cloud share one room, with **no primary machine**.
- **G6** Resurrect closed sessions (The Crypt).
- **G7** A demo/replay site that judges can open without login until 2027-01-29.
- **G8** Works standalone immediately (Local mode). Remote and mobile access is opt-in, through a relay the user runs themselves.
- **G9** Approve `allow_once` / `reject_once` from an **Amazfit Active 2 (Square)** watch, which holds a limited `watch` capability.
- **G10** A desktop app (Tauri) that works in Local mode as soon as it is opened.
- **G11** One folder, one bot: opening a workspace folder always gives the same bot; first run starts by picking a folder.

## Non-goals
- Multi-user or RBAC. One Space has one owner, who may use many devices. Each device gets an access level chosen by the owner at pairing: **Full**, **Approve only**, or **View only**.
- Password or account login. Devices join only through owner-approved pairing (link/QR/code); an unpaired browser sees only the pairing page.
- Forking herdr-core.
- **Parsing a TUI to build chat bubbles.** T0 bots may show a clearly labelled "raw snapshot" instead.
- Terminals outside herdr.
- A public hosted relay (DECISION-7).
- End-to-end encryption (DECISION-6). Signatures stay.
- P2P/CRDT without a relay.
- Native Windows before P9.21 (DECISION-59). Windows users run the node in WSL2 from P9.20.

## Users
The sole user is the owner, a developer running Kiro and Claude Code on a Mac and a Linux GPU box. They use an iPhone paired with an Amazfit Active 2 (Square). Build for real daily use, not only for the hackathon demo.

## Language
All UI, specs, code comments and repo docs are in **English** (Kiroween rule), including `docs/architecture.md`.
