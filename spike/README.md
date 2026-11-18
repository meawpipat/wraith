# @wraith/spike

Spike runner and its tests. `spike/` is not product code and is imported by no
`apps/` or `packages/` file.

## Commands

- `pnpm spike <q…>`: run one or more spikes by id.
- `pnpm spike list`: list the spike ids.
- `pnpm spike record <q>`: record the outcome of a spike.
- `pnpm spike budget …`: show or update the spike budget.

Package scripts: `pnpm --filter @wraith/spike test` and `pnpm --filter @wraith/spike check`.
