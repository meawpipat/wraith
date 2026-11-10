---
inclusion: always
---

# Structure: where things live (§17)

```
.kiro/
  steering/   product, tech, structure, security, ux-theme, agent-loop
  specs/      one folder per spec unit (§20): requirements.md, design.md, tasks.md
  hooks/      protocol-codegen, test-on-save, no-trust-all-tools, no-auto-approve, fixture-redact-check, secret-scan
  agents/     build agents for THIS repo (architect, implementer, reviewer, tester). Explicit allowlists: read/grep everywhere;
              fs_write only inside the repo; shell only `pnpm` (install/build/test/lint/typecheck), `git` (no push --force), `wrangler dev`.
              No wildcards. reviewer is read/grep only. (Bot launch configs in ~/.wraith/agents.json are a different thing; SI-2 applies to those.)
  settings/   mcp.json
apps/
  relay-cf/     Cloudflare adapter: Worker + SpaceDO (wrangler.toml, Deploy button)
  relay-node/   wraith-relay standalone (Fastify, Dockerfile)
  node/         wraith-node (+ embedded relay, migrations/, native/clock helper)
  sprite/        wraith-sprite (ACP client in a herdr-core pane)
  web/          PWA (mobile + desktop WebView + demo build)
  desktop/      Tauri v2 (src-tauri/, binaries/wraith-node-<target-triple>)
  watch-zepp/   Zepp OS Mini Program (app/, app-side/, setting/, app-service/)
packages/
  protocol/     zod schemas, message catalogue, templates, JSON Schema codegen
  crypto/       JCS, sign/verify, HMAC, hashing, key import/export
  relay-core/   relay logic + ports (Storage, Sockets, Timers, Http) + migrations/ + conformance tests
  acp-lite/     minimal ACP JSON-RPC client (only if the SDK fails spike Q10)
  fakes/        fake-acp-agent, fake-hc, fake-kiro-exec, fake-push-service
  platform/     every OS-specific call (IPC, file modes, login env, service unit, signals); darwin, linux, win32 stub (§4.10)
  ui-kit/       design tokens (ux-theme.md), sprite SVGs, shared components
tools/        record-fixture.ts, redact.ts, check-platform.ts, spike/*.ts
fixtures/     *.jsonl (redacted, human-reviewed before publish)
spike/        spike scripts and raw results (not product code)
.github/workflows/  ci.yml, desktop-release.yml, relay-docker.yml
deploy/       launchd/, systemd/, docker/, homebrew/ (formula/cask templates for the separate tap repo)
docs/
  architecture.md        full architecture (English, source of truth)
  PHASE-STATUS.md        DoD tracking per phase
  DECISIONS-PENDING.md   questions for the human + defaults taken
  spikes/RESULTS.md      spike outcomes and chosen branches
  kiro-usage.md          Kiroween write-up (P6)
  THIRD_PARTY.md, demo-script.md, self-host.md
```

## Dependency rules
- `packages/protocol` and `packages/crypto` depend on nothing runtime-specific.
- `packages/relay-core` depends only on `protocol` and `crypto`, and talks to its platform through ports (§6.8).
- OS-specific code (`process.platform`, signals, file modes, launchd/systemd, login shell) lives only in `packages/platform`; `tools/check-platform.ts` fails CI otherwise (§4.10).
- Apps may depend on packages. Packages never depend on apps.
- `apps/web` must build in `VITE_MODE=demo` without any live transport code (SI-14).

## Naming
- Spec folders: `.kiro/specs/<spec-name>/`, using the names from §20 (for example `relay-core`, `sprite-acp`, `approval`, `watch-zepp`).
- Error codes are `E_*` and come only from the catalogue in §6.9.
- Commit message prefix: `[P<n>][S-<spec>] …`. Every PR references DoD ids (for example `P1-D3`).
