# Phase status

Current phase: **P0 — Spikes & Scaffold**

| phase | DoD id | status | evidence | date |
|---|---|---|---|---|
| P0 | P0-D1 `pnpm -r test` passes on CI (Linux + macOS), with the P0-D2/D3 suites present (empty run does not count) | todo | | |
| P0 | P0-D2 JCS byte-equality on Node and vitest-pool-workers | pass | `npx pnpm@9.15.0 --filter @wraith/crypto test` (one `vitest run`, two projects): JCS suite (6 jcs-* files, 102 tests) passed in both `node` (41 files, 590 tests) and `workers` (33 files, 522 tests); total 74 files, 1112 tests. Versions: Node v22.15.0, vitest 5.0.5, @cloudflare/vitest-plugin 1.8.2, wrangler 4.162.0, workerd 1.20261113.1, miniflare 5.20261113.0-beta. V8 only: Node and Workers; the browser run is the P1 task 12.2. Owner accepted `@cloudflare/vitest-plugin` (renamed from `@cloudflare/vitest-pool-workers`, C79) as the "vitest-pool-workers" evidence. Vectors: `fixtures/crypto/known-answers.json`. Reuse for S-protocol task 19.1: same package `packages/crypto` and its vitest config, same command; workers project uses `cloudflareTest` with `miniflare.compatibilityDate` "2026-11-01", `resolve.conditions` and `ssr.resolve.conditions` `["@wraith/source"]`, excludes `*.node.test.ts`, `testTimeout` 60_000. | 2026-11-15 |
| P0 | P0-D3 sign→verify round-trip + mutate-any-byte→reject (PBT 1,000 runs) | pass | `npx pnpm@9.15.0 --filter @wraith/crypto test` (node project, V8 only): PBT runs = 1000 (hardcoded in test/config.ts); properties 6, 7, 8, 9 (sign→verify round trip, mutate value/byte/signature) pass across all 8 MESSAGE_TYPES; 37 files, 555 tests; vitest 5.0.5, fast-check 4.10.2 | 2026-11-15 |
| P0 | P0-D4 RESULTS.md answers Q1, Q2, Q3, Q3b, Q4, Q6, Q7, Q10, Q11, Q12, Q13, Q23, Q30, Q31, Q32, Q33, Q35, Q43 with evidence + chosen branch (Q14 may be PARTIAL, needs human) | todo | | |
| P0 | P0-D5 `.kiro/steering` states SI-1, SI-2, SI-6, SI-8 as plain sentences (same meaning as §12.1) | pass | `.kiro/steering/security.md` | 2026-11-01 |
| P0 | P0-D6 hooks `no-trust-all-tools`, `no-auto-approve`, `secret-scan` catch sample violations | todo | | |
| P0 | P0-D7 `tools/check-platform.ts` fails on a sample file outside `packages/platform` that uses `process.platform` or `SIGHUP`, and passes on the real tree | todo | | |

Later phases (P1–P9): copy DoD ids from `docs/architecture.md` §18 when the phase starts.
