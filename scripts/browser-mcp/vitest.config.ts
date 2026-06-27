import { defineConfig } from "vitest/config";

// Node-environment tests for the browser MCP host (RFC LP-8, M2). Self-contained
// — the host talks to the extension over a bridge and imports no extension
// internals, so no path aliases are needed. Run via: pnpm run mcp:browser:test
export default defineConfig({
  root: import.meta.dirname,
  test: {
    environment: "node",
    globals: false,
    include: ["**/*.test.ts"],
  },
});
