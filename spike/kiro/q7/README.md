# Q7: does `kiro-cli chat --list-sessions` have a JSON output option?
Question: can the node list Kiro sessions as JSON from the CLI? If not, the branch is
"use ACP `session/list` only".
## How to run
The loop runs it (group 16), never CI: `pnpm spike q7`
It runs only `kiro-cli chat --list-sessions --help` and the same with `--format json`.
No model prompt, no login use, no cost.
## Human steps
None.
## What to read in the evidence
- `help-plain.txt`, `help-format-json.txt`: command, exit code and help text. Lines that hold
  a secret-shaped value or an SI token are replaced by a marker; the home folder is masked.
- `summary.json`: result and branch.
- PASS means a help line names `--format` and `json`. The loop reads the text and confirms.
- `pending` means `kiro-cli` was not on PATH.
