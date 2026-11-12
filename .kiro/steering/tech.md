---
inclusion: always
---

# Tech: stack and hard technical rules

## Architecture in one paragraph
Each machine runs **`wraith-node`** next to **herdr-core** (`hc` ≥ 0.1.18, DECISION-58; not the older herdr TUI). Every bot runs in a herdr-core terminal, which Wraith calls a pane. For ACP agents (T1), the pane runs **`wraith-sprite`**, an ACP client that wraps `kiro-cli acp` (or another ACP agent) and reports structured events. Nodes and clients (PWA, desktop, watch) connect **outbound** to a **relay**. The relay sequences, queues, routes, applies the loop-guard, hands out leases and sends push notifications. It never runs agents and **cannot approve**.

The relay is one platform-agnostic library, **`relay-core`**, with adapters:
- **Local** (default): embedded in `wraith-node` on `127.0.0.1:7777`. Other machines and phones cannot reach it, so the UI cannot add machines or phones in Local mode (switching relay = a new Space). This is a reachability limit only: relay-core has no mode-specific pairing rule, and a second node on the same machine may pair (P2 tests). In Local mode the node is the relay, so pausing uses "Pause all bots" (sprites stop, node keeps running).
- **Self-hosted**: `wraith-relay` running on Node or Docker.
- **Cloudflare**: a Worker plus a Space Durable Object in the user's own account.

There is no primary machine (DECISION-4, DECISION-10).

## Integration tiers (§5)
- **T0 Generic**: any CLI in a plain pane. Shows a status card and a labelled raw snapshot.
- **T1 ACP** (main path): the sprite speaks ACP. This gives full chat, approvals via `session/request_permission`, and `session/load`. **ACP engine v3 for every bot** (DECISION-3).
- **T2 Native**: Claude Code TUI plus hooks plus transcript (later).
- **Grok Build** (DECISION-48): `grok` agent is T0 until Q38; T1 = `grok agent stdio` (ACP) with approvals proven, else hook-gated, else T0.
- **Claude driver** (DECISION-47): Claude Code bots run through the **Claude Agent SDK** in the sprite (`--mode sdk`), not the ACP adapter. The sprite maps SDK messages to the same events as ACP; the approval gate is an in-process `PreToolUse` hook (with `canUseTool` as a second gate), so Claude settings allow-rules cannot skip it; checkpoints are always on for Rewind; mapping table in §4.4; SDK license/auth = human decision H11.

## Stack (§16)
- Node 22 LTS, TypeScript 5 (ESM), pnpm workspaces, Biome, `tsc -b`.
- `relay-core`: pure TypeScript. The Node adapter uses `ws`, Fastify 5 and `better-sqlite3`. The Cloudflare adapter uses Workers, Durable Objects (SQLite), and WebSocket Hibernation with auto-response.
- Crypto:
  - WebCrypto ECDSA P-256, HMAC-SHA256 and SHA-256.
  - JCS (RFC 8785), implemented in `packages/crypto`, must produce byte-identical output across Node, Workers and browsers.
- Validation: zod in `packages/protocol`, which is the **only** place schemas are declared.
- IDs are ULIDs.
- Web: React 19, Vite 6, Tailwind 4, TanStack Virtual, `@xterm/xterm`.
- Desktop: Tauri v2 with `wraith-node` as a sidecar (Node SEA by default). Electron is the fallback.
- **One PWA build for every host.** Detect the host once (`tauri`, `browser-local`, `browser-remote`, `mobile`) and gate host-only features with `can(feature)` from `packages/ui-kit` (§4.5.1). Never call a Tauri API unguarded; show the documented fallback instead.
- Watch: a Zepp OS Mini Program (Device App, Side Service, Settings App, App Service). It talks to the relay through the `/api/v1` HTTP API.
- Tests:
  - Vitest and **fast-check** (PBT).
  - Playwright.
  - `@cloudflare/vitest-plugin` (the renamed, Vitest 5 compatible successor of the deprecated `@cloudflare/vitest-pool-workers`; do not install the old name).
  - Fakes in `packages/fakes`: fake ACP agent and `fake-hc` (herdr-core JSON-RPC socket), so CI never needs real Kiro or herdr-core. A contract test checks every hc method the node calls against `spike/hc/schema.json`.

## Hard rules
- **Never parse ANSI or TUI output to build chat.** Chat comes only from structured channels (ACP, hooks, transcripts).
- **Never auto-approve outside Autopilot** (§7.2.1, DECISION-49: node-decided `allow_once` for user-started turns only). A timeout always rejects. See `security.md`.
- **Never spawn agents with `--trust-all-tools`, `--trust-tools=*`** or an equivalent flag.
- **Never declare a message schema outside `packages/protocol`.**
- The relay routes on `meta` only. Fields the relay adds (`relay.*`) are **never** used for security decisions.
- Console mode reads panes with `terminal.read` (strategy S3, plain text) and never parses them.
- The sprite is started as `wraith-sprite --bot <id> [--seat <roomId>]` (`--seat` only for a group seat in process mode; in swap mode one sprite per bot hosts all its sessions, DECISION-54). It asks the node for its launch spec (agent from `~/.wraith/agents.json` + the bot's instructions). There are no preset profiles (DECISION-26).
- The node talks to herdr-core only with `hello`, `server.status`, `terminal.run/list/get/read/send/keys/kill/rm` and `events.subscribe` (plus `terminal.attach{observe}` from P9.5). Never `machine.*`, `file.*`, `machine.exec`, `doc.*`, templates or `on`. A pane is identified by the core id plus its address; labels are only for finding panes.
- There is no resume argv. The node respawns a lost pane itself, once per slot, with ids only, starting `wraith-sprite` by absolute path (§7.6). It decides from its own close intent: the sprite exits 0 only after its close report was acked or the node told it to stop, and 75 on signals or a refused duplicate. The sprite reports status as OSC 7501 on its stdout.
- Tests and spikes use their own `HC_SESSION` with a short socket path. Never stop or restart the owner's `default` core.
- Supported systems: macOS and Linux. Put every OS-specific call in `packages/platform` (§4.10); Windows is WSL2 from P9.20 and native from P9.21 (DECISION-59). The node starts the sprite from `<bin-dir>/wraith-sprite` (`--bin-dir`, a folder that survives upgrades, §4.6.1) and refuses when that folder or file is writable by group/others or owned by another user. Sprite protocol messages are additive only across one release (§6.5).
- Voice (P9.18): call `whisper-cli` and `ffmpeg` as child processes with argv arrays (no shell), audio in a 0600 temp file deleted in `finally`; one job at a time per node (queue ≤ 3), kill both processes after 25 s; verify model SHA-256 from `packages/protocol/src/voice.ts`; models live in `~/.wraith/models/` and are downloaded only by `wraith-node voice install` after the user agrees.
- Media (P9.19): images are stripped by a deterministic TS chunk stripper (no re-encode); `ffmpeg` only for video/posters/thumbnails, as a child process with argv arrays (no shell), one job at a time, 120 s kill; magic bytes with `file-type`; never trust the file extension; previews in `~/.wraith/media/cache/` (LRU); chunk size 32 KB, window 8.
- Use only libraries with permissive licenses (MIT, Apache, BSD, ISC). Fonts may be SIL OFL 1.1 (Poppins, IBM Plex Sans Thai, JetBrains Mono); list each in `docs/THIRD_PARTY.md` with its OFL notice. Record third-party code in `docs/THIRD_PARTY.md`.

## Confidence labels used in docs
✅ verified from official docs · 🧪 needs a spike (see `docs/spikes/RESULTS.md`) · 💡 our own design.
Never treat a 🧪 item as fact. Check `RESULTS.md` first.
