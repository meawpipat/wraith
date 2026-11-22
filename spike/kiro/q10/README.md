# Q10: can the ACP SDK drive Kiro as well as the raw JSON-RPC client?
Question: does `@agentclientprotocol/sdk` run the same ACP scenario against `kiro-cli acp` as the
raw client (initialize, new session, one prompt, update stream, permission request) with the same
frames and no schema rejection? It also confirms against the SDK's own schema the field names Q11
uses (`mcpServers` http entry, `session/list`).
## How to run
The owner runs it in a real terminal (never CI, never the loop): `pnpm spike run q10`
It writes `wraith-spike-q10.json` (read-only tools pre-approved, nothing else) into
`<scratch>/.kiro/agents/`, then starts `kiro-cli acp --agent-engine v3 --agent wraith-spike-q10`
twice, one run per client (raw, then SDK). One prompt each, asking for a read-only tool. Cost:
about 4 to 10 credits. Best run in the same batch as Q3: `pnpm spike q3 q10`.
If Q43 put the profile in `~/.kiro/agents/`, start with `pnpm spike q10 --allow-home-profile`; one new
file is written there and deleted afterwards. Without the flag the result is `pending`.
If the SDK package was not added (task 8.1 stopped) or its license is not permissive, the result is
`pending` with that reason.
## Human steps
- HS-S2: Kiro is signed in on this machine.
- HS-S3: if a permission request appears (on either run), you answer it in the terminal. Press the
  number of an allow option (not `allow_always`) or a reject option. No answer within 120 s rejects.
- HS-S6: only for the home profile placement, see above.
## What to read in the evidence
- `frames-raw.jsonl`, `frames-sdk.jsonl`: the redacted ACP frames of each run.
- `comparison.json`: the `dir:method` sequences (responses left out, consecutive repeats collapsed
  because the number of streamed chunks depends on the model) and the first difference.
- `field-names.json`: SDK version, license, the `mcpServers` http entry fields, the header fields and
  the `session/list` method and fields, read from the SDK schema (no agent involved).
- `index.json`: criteria `q10-raw-scenario`, `q10-sdk-scenario`, `q10-frames-match`, `q10-permission`,
  `q10-q11-field-names`.
- `PASS`: the SDK ran the whole scenario with the same method sequence; use the SDK in the sprite.
- `FAIL`: the SDK threw or its sequence differs; build `packages/acp-lite` (about +1 to 2 days).
- `PARTIAL`: a limit was reached, the raw baseline did not finish, or the Q11 field names differ.
