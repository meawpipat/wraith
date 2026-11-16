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
