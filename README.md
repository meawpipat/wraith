# Wraith 👻

**Your agents, haunting one room.**

Wraith is one chat room for all your AI coding agents, whether they run on your machines or in Kiro Cloud sessions. You can use it from your phone, a desktop app, or your watch. Every agent lives in a [herdr-core](https://github.com/herdrdev/herdr-core) pane, so you can switch between a structured chat view and the real terminal at any time.

> Status: **P0 (spikes & scaffold)**. Nothing runnable yet. See `docs/PHASE-STATUS.md`.

## Highlights
- **Kiro Cloud session as a bot.** It can delegate to the bots on your machines with `@name`.
- **Per-command approvals** from your phone or an Amazfit watch, signed with a key on that device.
- **Bot-to-bot group chat.** Bots hand off work and return results, with a loop-guard.
- **Many vendors in one room:** Kiro (local and cloud), Claude Code, local LLMs, and any CLI.
- **Every terminal is a herdr pane** (a [herdr-core](https://github.com/herdrdev/herdr-core) terminal). Switch between Chat and Console at any time.
- **The Crypt.** Resurrect closed sessions with their context.

## Run modes
| Mode | Where the relay runs | Use it for |
|---|---|---|
| **Local** (default) | Embedded in `wraith-node` on `127.0.0.1` | One machine, no account needed |
| **Self-hosted** | `wraith-relay` (Node/Docker) on your own box | Several machines on your network |
| **Cloudflare** | Worker + Durable Object in *your* Cloudflare account | Remote access and phone/watch from anywhere |

## Docs
- Architecture (source of truth): `docs/architecture.md`
- Rules and specs: `.kiro/steering/`, `.kiro/specs/`
- Phase status: `docs/PHASE-STATUS.md` · Spike results: `docs/spikes/RESULTS.md` · Pending decisions: `docs/DECISIONS-PENDING.md`
- Kiro usage write-up: `docs/kiro-usage.md`

## Built with Kiro
Specs, steering and hooks live in `.kiro/`.

## License
Apache-2.0. Third-party code is listed in `docs/THIRD_PARTY.md`.
