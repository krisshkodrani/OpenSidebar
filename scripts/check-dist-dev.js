#!/usr/bin/env node

/**
 * Guard the e2e build artifact (dist-dev) — the mirror image of
 * check-dist.js. The production dist must NOT contain the dev surface;
 * dist-dev MUST contain it, or every trace-based e2e assertion silently
 * reads empty air (this exact failure hid three "agent regressions" for
 * weeks in 2026-06/07: the harness drove a build with no trace drain).
 *
 * Asserts:
 * - dist-dev exists with a Vite manifest
 * - the overlay harness entry (src/overlay/index.tsx) is built — headed
 *   e2e drives the agent through it
 * - the trace drain (127.0.0.1:7589) is present in the built background
 *   code — the log server records the traces the tests assert against
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

const distDevPath = resolve(process.cwd(), "dist-dev");
const errors = [];

if (!existsSync(distDevPath) || !statSync(distDevPath).isDirectory()) {
  errors.push(
    "dist-dev not found — run `corepack pnpm run build:e2e` (nx extension:build-e2e) first",
  );
} else {
  const manifestPath = resolve(distDevPath, ".vite", "manifest.json");
  if (!existsSync(manifestPath)) {
    errors.push("dist-dev/.vite/manifest.json missing");
  } else {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
      if (!Object.keys(manifest).includes("src/overlay/index.tsx")) {
        errors.push(
          "dist-dev Vite manifest lacks the overlay entry (src/overlay/index.tsx) — headed e2e cannot mount its panel",
        );
      }
    } catch (error) {
      errors.push(`dist-dev/.vite/manifest.json invalid: ${error.message}`);
    }
  }

  let drainFound = false;
  const stack = [distDevPath];
  while (stack.length > 0 && !drainFound) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const entryPath = resolve(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }
      if (!/\.(js|mjs)$/.test(entry.name)) continue;
      if (readFileSync(entryPath, "utf-8").includes("127.0.0.1:7589")) {
        drainFound = true;
        break;
      }
    }
  }
  if (!drainFound) {
    errors.push(
      "trace drain (127.0.0.1:7589) absent from dist-dev JS — the __DEV__ surface was compiled out; trace-based e2e assertions will silently fail",
    );
  }
}

if (errors.length > 0) {
  console.error("[e2e:dist-dev] Dev-surface verification failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("[e2e:dist-dev] Dev-surface verification passed (overlay entry + trace drain present)");
