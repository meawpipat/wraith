# Phase status

Current phase: **P0 — Spikes & Scaffold**

| phase | DoD id | status | evidence | date |
|---|---|---|---|---|
| P0 | P0-D1 `pnpm -r test` passes on CI (Linux + macOS), with the P0-D2/D3 suites present (empty run does not count) | todo | | |
| P0 | P0-D2 JCS byte-equality on Node and vitest-pool-workers | todo | | |
| P0 | P0-D3 sign→verify round-trip + mutate-any-byte→reject (PBT 1,000 runs) | todo | | |
| P0 | P0-D4 RESULTS.md answers Q1, Q2, Q3, Q3b, Q4, Q6, Q7, Q10, Q11, Q12, Q13, Q23, Q30, Q31, Q32, Q33, Q35, Q43 with evidence + chosen branch (Q14 may be PARTIAL, needs human) | todo | | |
| P0 | P0-D5 `.kiro/steering` states SI-1, SI-2, SI-6, SI-8 as plain sentences (same meaning as §12.1) | pass | `.kiro/steering/security.md` | 2026-11-01 |
| P0 | P0-D6 hooks `no-trust-all-tools`, `no-auto-approve`, `secret-scan` catch sample violations | todo | | |

Later phases (P1–P9): copy DoD ids from `docs/architecture.md` §18 when the phase starts.
