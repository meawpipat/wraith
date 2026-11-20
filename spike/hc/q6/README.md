# Q6: does a node stub respawn a lost pane?

Question: after a core restart, a lost holder, or a core stop and start, does a node stub that polls
`ls` every 5 s find the finished pane and respawn it with the same ids within 10 s, and does it
leave `killed` and `exited 0` panes alone?

## How to run

Stage 1 of the runner, last of the five (it restarts the Test_Core), under `wsp-q6` only:

    pnpm spike q6

Needs Q2's `schema.json` first. The `hc` command forms are in one table (`HC_FORMS` in `q6.ts`)
and are an assumption until checked against that schema. No agent, no prompt, no credits.

## Steps

- a: `server restart`; the stub sprite keeps its pid.
- b: kill the holder pid from `server status` (own-pid check first); expect `holder_lost`, respawn within 10 s.
- c: `server stop`, then `server start`; respawn within 10 s of the core being back.
- d: `hc kill` of a stub records `killed`; `kill -TERM` records `exited` 75; `exited 0`; none is respawned.

## Human step

HS-S5 (optional): close a Wraith-labelled pane with the Herdr.app close button and report the
reason. Until then it is recorded as "unobserved". `exited 75` selects the branch "document `/exit`".

## What to read in the evidence

`summary.json` (core pids, finish reason and decision for each pane) and `timeline.txt`
(monotonic times). Raw `ls` and `status` output stays in `q6-raw.log` under the Spike_Root.
`respawnDecision` treats only `holder_lost` and a core stop as respawn reasons.
