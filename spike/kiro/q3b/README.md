# Q3b: does a Kiro `preToolUse` hook fire before the tool, does exit code 2 block it, and what is the hook timeout?
Question: if Kiro does not send `session/request_permission` (Q3 `FAIL`), can approval go through a
`preToolUse` hook? The hook must fire before the tool, exit code 2 must stop the tool, and the time
Kiro waits for a hook that does not answer must be known. Q43 decides where the profile is loaded from.
## How to run
The owner runs it in a real terminal (never CI, never the loop): `pnpm spike q3b`
Run Q3 first (`depends: q3`), so the joint branch can be decided.
It writes `wraith-spike-q3b.json` (read-only tools pre-approved, plus one `preToolUse` hook) into
`<scratch>/.kiro/agents/` and starts `kiro-cli acp --agent-engine v3 --agent wraith-spike-q3b`
(without `--agent` when Q43 failed). The hook command is
`node --experimental-strip-types <repo>/spike/kiro/q3b/hook-client.ts <spike root>`. No token is in the
profile or in `~/.kiro`: the client reads it from `<spike root>/hook.token` (mode 0600).
A receiver listens on `127.0.0.1:7782` only (free the port first; a busy port gives `pending`).
Two prompts are sent (cap 4): "run `echo hi`", then once more for the timeout probe. About 2 to 6 credits.
If Q43 put the profile in `~/.kiro/agents/`, start with `pnpm spike q3b --allow-home-profile`; one new
file is written there and deleted afterwards. Without the flag the result is `pending` (HS-S6 open).
## Human steps
- HS-S2: Kiro is signed in on this machine.
- HS-S3: when the hook fires, the terminal asks you about that one call. Press `1` (Block). Pressing `2`
  (Allow this one call) lets the tool run and the result is `PARTIAL`, because the block path is then not
  observed. If Kiro also asks its own permission, answer that as in Q3 (never `allow_always`).
  No answer within 120 s blocks.
- HS-S6: only for the home profile placement, see above.
The timeout probe takes up to 130 s and needs no key: the receiver holds one request unanswered.
## What to read in the evidence
- `frames.jsonl`: the redacted ACP frames. `hook-events.jsonl`: what the receiver decided per call.
- `hook-timeout.json`: an upper bound, not the hook timeout itself. The receiver cannot see the hook connection
  close, so `timeoutUpperBoundMs` is the time until the agent's next tool update (`timeoutBoundKind` =
  `agent-resumed`), the end of the prompt (`prompt-ended`), or the 130 s cap (`cap`: the timeout is above it),
  whichever came first. It bounds how long the agent waited; the real timeout is at most that value.
  Both fields are `null` when nothing was measured.
- `decision.json`: Q3 result, Q3b result, `stop`, and the selected branch.
- `index.json`: criteria `q3b-hook-fires`, `q3b-before-tool`, `q3b-exit2-blocks`, `q3b-timeout-measured`.
- `PASS`: the hook fired before the tool, the block stopped it, and the timeout was measured.
- Q3 `FAIL` and Q3b `FAIL`: STOP (`stop: true` in `decision.json`, branch text starts with "STOP"). The exit code stays 0.
- Q3 `FAIL` and Q3b `PASS`: approval via `preToolUse` + one-shot grant.
- Q3 `PASS`: Q3b is still recorded.
