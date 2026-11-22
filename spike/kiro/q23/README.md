# Q23: does `session/load` replay the same message and tool-call ids every time?
Question: when the client loads an existing session twice (same cwd, no prompt), do the replayed
`agent_message_chunk` and `tool_call` updates carry the same ids? If they do, the node can drop
replayed updates by id. If not, it must dedupe with `hash(turnIndex, text)`.
## How to run
The owner runs it in a real terminal, in the same invocation as Q3 (D6): `pnpm spike q3 q23`
Q3 hands its session id and cwd over inside the run. Q23 starts its own
`kiro-cli acp --agent-engine v3 --agent wraith-spike-q23` (without `--agent` when Q43 failed),
calls `session/load` twice on that session and sends no prompt. Cost: 0 to 2 credits.
Alone (`pnpm spike q23`) it ends `pending`: "needs q3 session in the same run".
If Q43 put the profile in `~/.kiro/agents/`, start with `pnpm spike q3 q23 --allow-home-profile`; one new file is written
there and deleted afterwards. Without the flag the result is `pending`.
## Human steps
- HS-S2: Kiro is signed in on this machine.
- HS-S6: only for the home profile placement, see above.
## What to read in the evidence
- `comparison.json`: ids of both loads, and the ids found in only one of them.
- `replay-1.jsonl`, `replay-2.jsonl`: the redacted `session/update` frames of each load.
- `index.json`: criteria `q23-loaded-twice`, `q23-replay-has-ids`, `q23-ids-equal`.
- `PASS`: both loads completed and the ids are equal and in the same order.
- `FAIL`: the ids differ. Branch: dedupe with `hash(turnIndex, text)`.
- `PARTIAL`: a load failed, or the replay carried no ids (Kiro may not send `messageId`); read
  `comparison.json` before deciding.
