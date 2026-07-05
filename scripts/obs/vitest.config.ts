import { resolve } from "path";

import { defineConfig } from "vitest/config";

// Node-environment tests for the observability core (RFC LP-7, Stage A).
// Scoped to scripts/obs only — run via: pnpm run obs:test
//
// The core imports the trace-viewer analysis modules, which resolve the repo's
// tsconfig `paths` aliases (`@shared-types`, `@prompts`, `@/*`). At tsx runtime
// those come from tsconfig.base.json; vitest needs them mirrored here. Regex
// finds keep `@/` from matching scoped packages like `@modelcontextprotocol`.
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
      {
        find: /^@prompts$/,
        replacement: `${repoRoot}/packages/prompts/src/index.ts`,
      },
      {
        find: /^@prompts\/(.*)$/,
        replacement: `${repoRoot}/packages/prompts/src/$1`,
      },
      { find: /^@\/(.*)$/, replacement: `${repoRoot}/apps/extension/src/$1` },
    ],
  },
  test: {
    environment: "node",
    globals: false,
    include: ["**/*.test.ts"],
  },
});
