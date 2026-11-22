# Q31: does a write allowlist for the workspace stop writes outside it from running silently?
Question: with a Kiro profile whose write allowlist names the scratch folder (and the write tool NOT
pre-approved), does a write to another folder still ask, or get refused, instead of running?
Q43 decides where the profile is loaded from (`placement.json`); Q32 confirms the profile fields.
## How to run
The owner runs it in a real terminal (never CI, never the loop): `pnpm spike q31`
It writes `wraith-spike-q31.json` (read-only tools pre-approved, write allowlist for the scratch
folder under `toolsSettings` only) into `<scratch>/.kiro/agents/` and starts
`kiro-cli acp --agent-engine v3 --agent wraith-spike-q31` (without `--agent` when Q43 failed).
Two prompts: write one file inside the scratch folder, then one file in another folder of the
Spike_Root. Cost: about 4 to 10 credits.
If Q43 put the profile in `~/.kiro/agents/`, start with `pnpm spike q31 --allow-home-profile`; one new
file is written there and deleted afterwards. Without the flag the result is `pending`.
The field name `toolsSettings.fs_write.allowedPaths` is a working name; check it against the Q32 and
Q43 evidence before you trust a `PASS`.
## Human steps
- HS-S2: Kiro is signed in on this machine.
- HS-S3: you answer every permission request in the terminal. You may reject the inside write (veto
  at the tap). Reject the outside write too. Never choose `allow_always`. No answer within 120 s rejects.
- HS-S6: only for the home profile placement, see above.
## What to read in the evidence
- `frames.jsonl`: the redacted ACP frames. `writes.json`: the verdict and what each prompt did.
- `index.json`: criteria `q31-outside-guarded`, `q31-inside-recorded`, `q31-write-tool-not-preapproved`.
- `PASS`: the outside write was refused or asked you. `q31-inside-recorded` says whether the inside write asked.
- `FAIL`: the outside file was written without your allow. The run stops at once. Branch: "Outside workspace" badge only.
- `PARTIAL`: the agent never tried the outside write, or the run was cut short.
