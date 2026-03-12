import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 360_000,
    hookTimeout: 60_000,
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
    retry: 1,
    include: ["tests/e2e/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "../../src"),
    },
  },
});
