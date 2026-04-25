#!/usr/bin/env node

import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

const distPath = resolve(process.cwd(), "dist");

if (!existsSync(distPath) || !statSync(distPath).isDirectory()) {
  console.error("[ci:dist] Build failed: dist folder not found");
  process.exit(1);
}

console.log("[ci:dist] Build successful: dist folder exists");
