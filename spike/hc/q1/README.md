# Q1: cost of `terminal.read` every 250 ms

**Question.** Does reading a full-screen pane every 250 ms for 5 minutes raise Test_Core CPU by
less than 5 points of one core, with every payload below 64 KB? (hc 0.1.17 or newer.)

**How to run.** `pnpm spike q1` (loop, stage 1, after Q2). It takes about 7 minutes: 60 s
baseline, then 5 minutes of reads. It uses a Test_Session under `/tmp/hcw/q1/` only.

**Method.** Starts `htop` in a pane (`top -s 1` when `htop` is not on PATH; the substitute is
recorded). CPU is the delta of `ps -o cputime=` for the Test_Core pids from `server.status` that
pass the own-pid check, over wall time.

**Human steps.**
- HS-S1 (optional): install `htop` and rerun to compare.
- HS-S5: Herdr.app and Herdr Core app behaviour stays "unobserved" until reported.

**Read in the evidence.** `summary.json` (increase in points, largest payload, read counts,
thresholds, caveat), `samples.csv` (time, bytes, duration and exit code of every read), `index.json`.

**Caveat.** The CLI `read` starts one hc process per read. The numbers cover the core only.

**Branches.** CPU too high: "poll 1 s". Payload too large: "send only line diffs (Q20)".
