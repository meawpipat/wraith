# Q13: do templates, `first_message` or `terminal.wait` replace sprite work?

Question: does any herdr-core template, `first_message` or `terminal.wait` replace part of
the sprite's ACP or queue work? The expected answer is no (branch "use the sprite as designed").

## How to run

Run after Q2 (it reads Q2's `schema.json`). The loop runs it, never CI:

`pnpm spike q13`

Uses the Test_Session only. Runs `hc templates`, a stub run, a template run and `hc wait`.
No agent CLI, no prompts, no cost.

## Human steps

None.

## What to read in the evidence

- `templates.txt`, `stub-run.txt`, `template-run.txt`, `wait.txt`: command, exit code, output.
- `summary.json`: which features matched the lexical check, the result and the branch.
- The match is a lexical hint. The loop writes the judgement into the entry notes at `record`.
