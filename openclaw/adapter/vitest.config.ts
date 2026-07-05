import { defineConfig } from "vitest/config";

// Node-environment loopback tests for the OpenClaw adapter (RFC LP-8, M5).
// Self-contained (built-in node:http only). Run: pnpm run openclaw:adapter:test
export default defineConfig({
  root: import.meta.dirname,
  test: {
    environment: "node",
    globals: false,
    include: ["**/*.test.ts"],
  },
});
