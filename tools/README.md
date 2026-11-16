# @wraith/tools

Repository tooling scripts and their tests.

`tools` is imported by no `apps/` or `packages/` file.

## Scripts

- `pnpm --filter @wraith/tools test`: runs `vitest run` (the `node` project, `test/**/*.test.ts`).
- `pnpm --filter @wraith/tools check`: runs `tsc -p tsconfig.json --noEmit`.
