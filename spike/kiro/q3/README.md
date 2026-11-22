# Q3: does Kiro send `session/request_permission` with `options[]`, and does the owner's choice run the tool?
Question: for a tool the profile does not pre-approve (the shell tool), does `kiro-cli acp` send an
ACP `session/request_permission` with `options[]`, and does the tool run after the owner selects an
allow option? Q43 decides where the profile is loaded from (`placement.json`).
## How to run
The owner runs it in a real terminal (never CI, never the loop): `pnpm spike q3`
It writes `wraith-spike-q3.json` (read-only tools pre-approved, nothing else) into
`<scratch>/.kiro/agents/` and starts `kiro-cli acp --agent-engine v3 --agent wraith-spike-q3`
(without `--agent` when Q43 failed). One prompt: "run `echo hi`". Cost: about 2 to 6 credits.
If Q43 put the profile in `~/.kiro/agents/`, start with `pnpm spike q3 --allow-home-profile`; one new
file is written there and deleted afterwards. Without the flag the result is `pending`.
## Human steps
- HS-S2: Kiro is signed in on this machine.
- HS-S3: you answer the permission request in the terminal. Press the number of an allow option (not
  `allow_always`). No answer within 120 s rejects, and the result is `PARTIAL` "approval tap missing".
- HS-S6: only for the home profile placement, see above.
## What to read in the evidence
- `frames.jsonl`: the redacted ACP frames. On `PASS` or `PARTIAL` it is also copied to `spike/kiro/q3.jsonl`.
- `session.json`: session id and cwd. Q23 reuses them when it runs in the same batch.
- `index.json`: criteria `q3-request-permission`, `q3-options`, `q3-owner-selection`, `q3-tool-ran`.
- `PASS`: a request with `options[]` arrived, you allowed it, and the tool ran.
- `FAIL`: no request arrived. Approval then depends on Q3b (`preToolUse` + one-shot grant).
