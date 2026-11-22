# Q11: does Kiro accept an HTTP `mcpServers` entry in `session/new` and call a tool on it?
Question: when the ACP client passes `mcpServers:[{type:"http", name, url, headers:[{name, value}]}]`
to `session/new`, does `kiro-cli acp` connect to it and call the `echo` tool? The entry shape was
checked against the SDK types by Q10; the `mcpCapabilities` of the `initialize` response are recorded.
## How to run
The owner runs it in a real terminal (never CI, never the loop): `pnpm spike q11`
(normally in the stage 3 batch: `pnpm spike q3 q3b q10 q4 q11 q23`).
It starts a local MCP echo server on `127.0.0.1` (random port, random token required in the
`x-wraith-spike-token` header), writes `wraith-spike-q11.json` (read-only tools pre-approved, nothing
else) into `<scratch>/.kiro/agents/` and starts `kiro-cli acp --agent-engine v3 --agent wraith-spike-q11`
(without `--agent` when Q43 failed). One prompt asks the agent to call `echo`. Cost: about 2 to 6 credits.
If Q43 put the profile in `~/.kiro/agents/`, start with `pnpm spike q11 --allow-home-profile`; one new
file is written there and deleted afterwards. Without the flag the result is `pending`.
## Human steps
- HS-S2: Kiro is signed in on this machine.
- HS-S3: you answer each permission request in the terminal (the MCP tool may ask). Press the number
  of an allow option (not `allow_always`). No answer within 120 s rejects.
- HS-S6: only for the home profile placement, see above.
## What to read in the evidence
- `frames.jsonl`: the redacted ACP frames (the token is replaced by `[spike-token]`).
- `mcp-calls.json`: the `mcpCapabilities` and the calls the echo server saw (tool name and whether the header was present; never its value).
- `index.json`: criteria `q11-mcp-capabilities`, `q11-session-new`, `q11-echo-called`.
- `PASS`: the echo server received an `echo` call with the token header.
- `FAIL`: no call arrived. Branch: stdio shim `wraith-mcp-stdio`. A `FAIL` may be the echo server's
  fault: it answers with plain JSON (no SSE) and implements only `initialize`, `tools/list` and
  `tools/call`. Look in `frames.jsonl` for an MCP error from the agent. If the handshake is suspected,
  re-run with a permissive-licensed MCP SDK server before choosing the shim.
