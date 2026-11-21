# Q43: does `kiro-cli acp --agent-engine v3 --agent <name>` load a custom profile?
Question: is a profile in the Scratch_Workspace (`<scratch>/.kiro/agents/`) found by
`--agent`, or only one in `~/.kiro/agents/`? Do its tools apply (a tool it does not
pre-approve must ask)? Later Kiro spikes read the answer from `placement.json`.
## How to run
The loop runs it (group 16), never CI: `pnpm spike run q43`
It writes `wraith-spike-q43.json` (read-only tools pre-approved, nothing else) into
`<scratch>/.kiro/agents/` and starts `kiro-cli acp --agent-engine v3 --agent wraith-spike-q43`.
It sends `initialize`, `session/new` and one prompt that asks for the shell tool.
Every permission request is answered `reject_once`. Cost: about 0 to 3 credits.
If the agent is not found and the run was started with `--allow-home-profile`, it writes the same
new file into `~/.kiro/agents/` (flag `wx`, an existing file is never overwritten), retries once,
and deletes the file afterwards. Without the flag it ends `pending` and writes nothing there.
## Human steps
- HS-S2: Kiro is signed in on this machine.
- HS-S6: only when the scratch placement fails and you start the run with `pnpm spike q43 --allow-home-profile`. Then one new file goes into `~/.kiro/agents/` and is removed at the end. Without the flag nothing is written there and the result is `pending` (HS-S6 open).
## What to read in the evidence
- `placement.json`: `scratch`, `home`, or `null` (FAIL).
- `summary.json`: result, each attempt, and the branch on FAIL.
- `frames.jsonl`: the redacted ACP frames of every attempt.
- PASS means the process started with `--agent`, and the unapproved tool asked.
- FAIL branch: launch without `--agent` and select it after `initialize` with `session/set_mode`
  or the agent config option. The text to update is "§4.4/§5 argv"; the spike does not edit it.
- The prompt cap is one, so "tools not applied" is judged only after that one prompt.
  A start without a permission request is a FAIL, with no second prompt.
