import { defineConfig } from "vitest/config";

// The `workers` project is added by task 8.2. `*.node.test.ts` run in `node` only.
export default defineConfig({
  test: {
    projects: [
      {
        resolve: {
          conditions: ["@wraith/source"],
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
