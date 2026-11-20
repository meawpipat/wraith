# Q14: does the owner's own core come back after logout and login?

Question: after the owner logs out and in again, how long until `hc server status` succeeds
(pass line: 10 s or less)? Observe_Mode only: the observer runs `server status` and nothing
else. It starts nothing, creates no pane and never lists terminals.

## How to run

The owner runs it, never the loop and never CI, in an interactive terminal:

`pnpm spike q14 --observe-default`

## Human steps (HS-S4)

1. Log out of your session, log in again, run the command at once.
2. In a pane you create yourself, run `sh spike/hc/q14/path-check.sh` (prints whether
   `kiro-cli` resolves; it never runs it).
3. Record by hand what the observer cannot see: Linux unit, reboot, reboot with nobody
   logged in, and that the recorded pane reason is not `killed`.

## What to read in the evidence

- `observe.txt`: `t+<seconds> ok|fail` lines, the measured time and the state folder (home
  masked). Nothing else.
- The result is PARTIAL by construction while the HS-S4 items are open.
