# Q4: does Kiro use ACP `terminal/create` and `terminal/output` when the client declares `terminal:true`?
Question: when the client sends `clientCapabilities.terminal: true`, does `kiro-cli acp` run a long
shell command through the ACP terminal methods, so a chat client could stream its live output?
Q43 decides where the profile is loaded from (`placement.json`). Q3 should have passed first.
## How to run
The owner runs it in a real terminal (never CI, never the loop): `pnpm spike q4`
It writes `wraith-spike-q4.json` (read-only tools pre-approved, nothing else) into
`<scratch>/.kiro/agents/` and starts `kiro-cli acp --agent-engine v3 --agent wraith-spike-q4`
(without `--agent` when Q43 failed). One prompt: run `sleep 20; echo done` with the shell tool.
Cost: about 2 to 6 credits.
If Q43 put the profile in `~/.kiro/agents/`, start with `pnpm spike q4 --allow-home-profile`; one new
file is written there and deleted afterwards. Without the flag the result is `pending`.
The client answers every `terminal/*` request from the agent with a JSON-RPC error and starts no
process. The command can only run through the agent's own tool, after your tap.
## Human steps
- HS-S2: Kiro is signed in on this machine.
- HS-S3: you answer the permission request in the terminal. Press the number of an allow option (not
  `allow_always`). No answer within 120 s rejects, and the result is `PARTIAL` "approval tap missing".
- HS-S6: only for the home profile placement, see above.
## What to read in the evidence
- `frames.jsonl`: the redacted ACP frames. Look for agent requests named `terminal/create` and `terminal/output`.
- `index.json`: criteria `q4-owner-selection`, `q4-terminal-create`, `q4-terminal-output`.
- `PASS`: both `terminal/create` and `terminal/output` arrived. The chat can stream live command output.
- `FAIL`: they did not arrive. Branch: show output in the ToolCard (after the tool finishes).
