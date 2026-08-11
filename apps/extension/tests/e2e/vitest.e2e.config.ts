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
    // retry:1 a flaky test otherwise reports as a plain pass. The OTel
    // reporter exports results to Bluebox and is a no-op unless
    // OTEL_EXPORTER_OTLP_ENDPOINT / .env.otel is configured.
    reporters: [
      "default",
      "./tests/e2e/helpers/flaky-reporter.ts",
      "./tests/e2e/helpers/otel-reporter.ts",
    ],
    include: ["tests/e2e/**/*.test.ts"],
    globalSetup: ["tests/e2e/global-setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(appRoot, "./src"),
      "@shared-types": path.resolve(appRoot, "../../packages/shared-types/src"),
    },
  },
});
