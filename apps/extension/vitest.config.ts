import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  root: __dirname,
  define: {
    __DEV__: JSON.stringify(true),
    __LOCAL_OBSERVABILITY_SERVER_URL__: JSON.stringify("http://127.0.0.1:7589"),
    __FLEET_TELEMETRY_INTERNAL_ENDPOINT__: JSON.stringify(""),
  },
  test: {
    environment: "happy-dom",
    setupFiles: ["./tests/setup.ts"],
    globals: false,
    exclude: [
      "tests/e2e/**",
      "tests/bench/**/*.bench.test.ts",
      "node_modules/**",
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@shared-types": path.resolve(
        __dirname,
        "../../packages/shared-types/src",
      ),
      "@observability-schema": path.resolve(
        __dirname,
        "../../packages/observability-schema/src",
      ),
      "@prompts": path.resolve(__dirname, "../../packages/prompts/src"),
      "@trace-sync": path.resolve(__dirname, "../../packages/trace-sync/src"),
    },
  },
});
