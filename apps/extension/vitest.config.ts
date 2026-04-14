import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  root: __dirname,
  test: {
    environment: "happy-dom",
    setupFiles: ["./tests/setup.ts"],
    globals: false,
    exclude: ["tests/e2e/**", "node_modules/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@shared-types": path.resolve(__dirname, "../../packages/shared-types/src"),
      "@prompts": path.resolve(__dirname, "../../packages/prompts/src"),
    },
  },
});
