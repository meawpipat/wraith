import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
// `*.node.test.ts` run in `node` only. Vite 8 resolves test modules through the SSR pipeline,
// so the `@wraith/source` condition is set there as well (task 2.2 verified `resolve.conditions`
// alone is not enough). The `workers` project uses `cloudflareTest` from @cloudflare/vitest-plugin
// (https://developers.cloudflare.com/workers/testing/vitest-integration/configuration/); no wrangler
// file is needed because `miniflare.compatibilityDate` is set inline (no nodejs_compat).
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
          testTimeout: 60_000,
          environment: "node",
          include: ["test/**/*.test.ts"],
        },
      },
      {
        plugins: [
          cloudflareTest({
            miniflare: {
              compatibilityDate: "2026-11-01",
            },
          }),
        ],
        resolve: {
          conditions: ["@wraith/source"],
        },
        ssr: {
          resolve: {
            conditions: ["@wraith/source"],
          },
        },
        test: {
          name: "workers",
          testTimeout: 60_000,
          include: ["test/**/*.test.ts"],
          exclude: ["test/**/*.node.test.ts"],
        },
      },
    ],
  },
});
