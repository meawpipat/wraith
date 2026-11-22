# Q30: does Kiro list a closed session again from the same folder?
Question: after `kiro-cli acp` created a session in a folder and its process ended, does a new
process started in that folder list the session id, through ACP `session/list` or through
`kiro-cli chat --list-sessions`?
## How to run
The owner runs it in a real terminal (never CI, never the loop): `pnpm spike q30`
It works in a scratch folder inside the Spike_Root, never in one of your projects. It starts
`kiro-cli acp --agent-engine v3` (no profile, nothing is written to `~/.kiro`), sends one prompt
("reply OK, use no tools"), ends the process, then lists from the same folder. Cost: about 2 to 4
credits. `--allow-home-profile` is accepted but not needed here.
## Human steps
- HS-S2: Kiro is signed in on this machine.
- If Kiro asks permission for anything, you answer in the terminal; a timeout rejects.
## What to read in the evidence
- `session.json`: the session id and the scratch cwd.
- `acp-list.json`: the `session/list` result, or `unsupported` when the method is missing.
- `cli-list.txt`: the output of `chat --list-sessions` from the scratch cwd.
- `index.json`: criteria `q30-acp-session-list` and `q30-cli-list-sessions`.
- `PASS`: either way lists the id for that cwd.
- `FAIL`: neither does. Branch: rely only on the node's `workspaces` table.
- `frames.jsonl`: the redacted ACP frames of both processes.
