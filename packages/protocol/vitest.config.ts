import { defineConfig } from "vitest/config";

// The `workers` project is added by task 19.1. `*.node.test.ts` run in `node` only.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          environment: "node",
          include: ["test/**/*.test.ts"],
        },
      },
    ],
  },
});
