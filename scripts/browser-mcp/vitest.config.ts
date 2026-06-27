import { resolve } from "path";

import { defineConfig } from "vitest/config";

// Node-environment tests for the browser MCP host (RFC LP-8, M2). The host talks
// to the extension over a bridge and imports no extension internals; it shares
// only the wire contract via @shared-types. Run via: pnpm run mcp:browser:test
const repoRoot = resolve(import.meta.dirname, "..", "..").replace(/\\/g, "/");

export default defineConfig({
  root: import.meta.dirname,
  resolve: {
    alias: [
      {
        find: /^@shared-types$/,
        replacement: `${repoRoot}/packages/shared-types/src/index.ts`,
      },
      {
        find: /^@shared-types\/(.*)$/,
        replacement: `${repoRoot}/packages/shared-types/src/$1`,
      },
    ],
  },
  test: {
    environment: "node",
    globals: false,
    include: ["**/*.test.ts"],
  },
});
