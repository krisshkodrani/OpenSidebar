import { defineConfig } from "vitest/config";
import path from "path";

const appRoot = path.resolve(__dirname, "..", "..");

export default defineConfig({
  root: appRoot,
  test: {
    environment: "node",
    testTimeout: 600_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
    retry: 1,
    // Surface pass-on-retry rescues (see helpers/flaky-reporter.ts) — with
    // retry:1 a flaky test otherwise reports as a plain pass.
    reporters: ["default", "./tests/e2e/helpers/flaky-reporter.ts"],
    include: ["tests/e2e/**/*.test.ts"],
    globalSetup: ["tests/e2e/global-setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(appRoot, "./src"),
    },
  },
});
