# Decisions pending (human)

The loop proceeds with the default unless the human answers. Source: `docs/architecture.md` §24.2.

| id | date | question | default taken | impact if changed | resolved? |
|---|---|---|---|---|---|
| H1 | 2026-11-01 | GitHub repo name/owner/visibility | `github.com/<user>/wraith`, **public from the first push**. Before that push: GitHub secret scanning + push protection on, and the `secret-scan` hook installed (P0). | URLs in docs/CI; free macOS CI minutes | yes (2026-11-02, human) |
| H2 | 2026-11-01 | License | Apache-2.0 | LICENSE file | yes (2026-11-02, default) |
| H3 | 2026-11-01 | Node names / hostPriority | No hard-coded names. `nodeId`/`label` default to the slugified hostname (`-2` suffix on collision), renamable via `wraith-node init --name` or /machines. `hostPriority` defaults to 1; ties go to the lowest `nodeId`. | roster defaults | yes (2026-11-02, human) |
| H4 | 2026-11-01 | Cloudflare domain / plan | `workers.dev`; the human already has **Workers Paid**. P4-D10 still measures against Free-plan limits for other users. | relay URL | yes (2026-11-02, human) |
| H5 | 2026-11-01 | Apple Developer ID | Not purchased. Revisit at P9.2. | signed desktop, Capacitor, Apple Watch | yes (2026-11-02, human) |
| H6 | 2026-11-01 | Cloud-bot test repo + PAT | `<user>/wraith-playground` (private), fine-grained read-only PAT made by the human | P3 entry | yes (2026-11-02, default; PAT still to be created by human before P3) |
| H7 | 2026-11-01 | After P6: P7 (watch) or P8 (crypt) first | P7 if the watch is ready and Q25–Q27 are answered, else P8 | ordering only | yes (2026-11-02, default) |
| H8 | 2026-11-01 | Bonus posts (blog, social, Ghost of Kiroween Past) | Loop drafts, human posts. **Not eligible** for Ghost of Kiroween Past (did not register in 2025). | P6 | yes (2026-11-02, human) |
| H9 | 2026-11-01 | Kiro Crew bridge | not before P9.11 | none | yes (2026-11-02, default) |
| H10 | 2026-11-01 | Watch quick messages / approval timeout | list in §14.4 / 30 min | P7 / P1 | yes (2026-11-02, default) |
| H11 | 2026-11-02 | Claude Agent SDK: accept its license (Anthropic terms), auth (own Claude login vs API key), bundle in Wraith.app or not | not bundled; `doctor` installs it when the first Claude bot is created; own login if Q36 confirms the terms allow it, else API key | P9.14 (Claude bots, Rewind) | yes (2026-11-02, default) |
