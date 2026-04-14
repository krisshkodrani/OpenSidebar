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
    include: ["tests/e2e/**/*.test.ts"],
    globalSetup: ["tests/e2e/global-setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(appRoot, "./src"),
    },
  },
});
