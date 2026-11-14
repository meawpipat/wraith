import { defineConfig } from "vitest/config";
// The `workers` project is added by task 8.2. `*.node.test.ts` run in `node` only.
// Vite 8 resolves test modules through the SSR pipeline, so the `@wraith/source`
// condition is set there as well (task 2.2 verified `resolve.conditions` alone is not enough).
export default defineConfig({
  test: {
    projects: [
      {
        resolve: {
          conditions: ["@wraith/source"],
        },
        ssr: {
          resolve: {
            conditions: ["@wraith/source"],
          },
        },
        test: {
          name: "node",
          environment: "node",
          include: ["test/**/*.test.ts"],
        },
      },
    ],
  },
});
