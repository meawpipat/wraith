# Q2: start a pane with argv, cwd, env and labels

Question: does `hc` apply cwd, env and labels to a pane, set `HC_TERMINAL_ID` in the child,
resolve `get t<N>` as an address even when another terminal is named `t<N>`, and which
`HC_*` names does a pane export (the hazard in R1.6)?

## How to run

The loop runs it in stage 1, first of Group A, under the Test_Session `wsp-q2`:

    pnpm spike q2

Authoring only: this script has not been run against a real core yet. The `hc` forms it
uses (`run --cwd --env --label --`, `ls --label`, `get`, `read`, `schema`) are assumptions
until `schema.json` is read; fix the forms, not the criteria, if they differ.

## Human step

HS-S5 (owner): open Herdr.app, note whether the Q2 pane shows there, and compare the PATH
of Herdr Core app with a login shell. The loop records both as `unobserved`.

## Evidence

- `schema.json`: output of `hc schema`. Copied to `spike/hc/schema.json` on PASS or PARTIAL.
- `run-output.txt`: the stub's output (cwd, `WRAITH_X`, `HC_TERMINAL_ID`, `env -0` names).
- `ls.json`, `get-address.json`: labels filter and the address-versus-name check.
- `env-compare.txt`: pane versus login shell. PATH entries, and names only for the rest.
  Also lists the `HC_*` and `HERDR_*` names a pane exports.
- `index.json`: PASS needs cwd, env, labels and `HC_TERMINAL_ID`; PARTIAL if only the
  schema, address or `env -0` check is missing.
