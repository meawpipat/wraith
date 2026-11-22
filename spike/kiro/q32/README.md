# Q32: does Kiro read an edited agent profile again after `session/load`?
Question: when the profile file changes between two runs of the same session, does the restarted
agent use the new prompt, and is the session history still there after `session/load`?
## How to run
The owner runs it in a real terminal (never CI, never the loop): `pnpm spike q32 --allow-home-profile`
Run it after Q43 (`pnpm spike q43 --allow-home-profile`). Q32 always writes into your
`~/.kiro/agents/`, so without the flag the result is `pending` and nothing is written (HS-S6).
It writes one new file, `wraith-spike-q32.json` (prompt "answer with the word ALPHA ...", read-only
tools pre-approved, nothing else), and never overwrites a file of that name. It starts
`kiro-cli acp --agent-engine v3 --agent wraith-spike-q32`, asks "what are your instructions?", stops
the process, edits the file (prompt now BRAVO), starts a new process, loads the same session with
`session/load` and asks again. The file is deleted at the end. Two prompts, about 4 to 10 credits.
If Q43 failed (no `--agent`), the result is `pending`: selecting the agent after `initialize` is not
sent by this script yet.
## Human steps
- HS-S2: Kiro is signed in on this machine.
- HS-S6: you allow the one new file in `~/.kiro/agents/` with `--allow-home-profile`.
## What to read in the evidence
- `answers.json`: both answers, the profile prompt before and after, the session id, replay count.
- `frames-run1.jsonl`, `frames-run2.jsonl`: the redacted ACP frames of each run.
- `index.json`: criteria `q32-first-prompt`, `q32-edit-applied`, `q32-new-prompt-used`,
  `q32-history-present`, `q32-other-files-untouched`.
- `PASS`: the new prompt (BRAVO) is used and the history is present; an edited profile takes effect on restart.
- `FAIL`: the old prompt is kept or the history is gone; use the default agent, no pre-approved
  tools, and send the instructions as a first context block.
- `PARTIAL`: a limit was reached, or another file in the folder changed.
