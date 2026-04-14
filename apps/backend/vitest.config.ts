import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  root: __dirname,
  test: {
    environment: "node",
    globals: false,
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "../extension/src"),
      "@shared-types": path.resolve(__dirname, "../../packages/shared-types/src"),
      "@prompts": path.resolve(__dirname, "../../packages/prompts/src"),
    },
  },
});
