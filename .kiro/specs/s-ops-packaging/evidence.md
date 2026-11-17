# Evidence: task 4.11

## Kiro smoke test of the secret-scan hook

- Date: 2026-11-16 11:55
- Kiro: 1.4.121, new Default session at the workspace root.

Results:

- (a) An ordinary write of `hook-smoke.txt` succeeded. Kiro showed "1 hook triggered".
- (b) A direct `fsWrite` of a fake token-shaped string (GitHub PAT shape) to
  `/tmp/hook-smoke-secret.txt` was blocked. The finding was `secret/github-token`, and the file was not created.
- The relative path `tools/secret-scan.ts` and `node` resolved from the workspace root.
  Working-directory finding: the hook runs from the workspace root.
- `hook-smoke.txt` was deleted afterwards.

## Method note and limitation

An `executeBash` command that joins fragments at runtime never puts the full token in
`tool_input`, so the static scan cannot see it. The smoke test therefore used a direct `fsWrite`.

# Evidence: task 9.7
## Kiro smoke test of the SI hooks (no-trust-all, no-auto-approve)
- Date: 2026-11-16 21:09 to 2026-11-17 08:22
- Kiro: 1.4.121, new Default session at the workspace root.
Results:
1. An ordinary `fsWrite` of `apps/node/src/si-smoke-ok.ts` succeeded. Kiro showed "3 hooks triggered". The file was deleted afterwards.
2. An `fsWrite` of the first `argvFlags` sample was blocked with `si/no-auto-approve/argvFlags`. The file was not created.
   `no-auto-approve` covers `argvFlags` as well, through the SI-1 list. Running both hooks by hand on the same input, both exit 2. Kiro showed the first one that blocked.
3. An `executeBash` with an `echo` of the first `argvFlags` sample was blocked by `no-trust-all` with `si/no-trust-all/argvFlags`. Kiro ran `no-trust-all` and `secret-scan`. `no-auto-approve` did not run, as its matcher intends.
4. An `fsWrite` of the first `envNames` sample was blocked with `si/no-auto-approve/envNames`. The file was not created.
5. An `executeBash` with an `echo` of the first `envNames` sample was not blocked (exit 0), as intended.
- No smoke files remain.
## Method note and limitation
Same as the 4.11 section. The agent typed the token directly in the tool input. The prompts themselves did not spell it. A string joined at runtime would be invisible to the hook.
## Results collected for task 12.3
- `secret-scan`: smoke result in the task 4.11 section above (ordinary write passes, token-shaped write blocked with `secret/github-token`).
- `no-trust-all` and `no-auto-approve`: smoke results in this task 9.7 section (ordinary write passes, `argvFlags` and `envNames` samples blocked, `envNames` in a shell `echo` passes).
