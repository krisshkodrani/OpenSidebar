import { defineConfig } from "vitest/config";
import path from "path";

const appRoot = path.resolve(__dirname, "..", "..");

// Mirrors vitest.e2e.config.ts: headed Chrome, long timeouts, single fork,
// shared log server via the same global setup. Scopes the run to the bench
// runner test only.
export default defineConfig({
  root: appRoot,
  test: {
    environment: "node",
    testTimeout: 600_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
    retry: 0,
    include: ["tests/bench/**/*.bench.test.ts"],
    globalSetup: ["tests/e2e/global-setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(appRoot, "./src"),
    },
  },
});
