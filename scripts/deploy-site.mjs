#!/usr/bin/env node
/**
 * Build and deploy the opensidebar.com marketing site to S3 + CloudFront.
 *
 *   1. stage media (videos + posters)         [--skip-media to skip]
 *   2. nx run site:build                        [--skip-build to skip]
 *   3. three tiered `aws s3 sync` passes:
 *        assets/  + media/   → immutable, cache 1 year (content-hashed / versioned)
 *        html/root files      → cache 5 min, must-revalidate
 *   4. CloudFront invalidation of the short-cache paths only
 *
 * Env (no secrets in repo; AWS creds from the ambient CLI config):
 *   SITE_S3_BUCKET                    (required)
 *   SITE_CLOUDFRONT_DISTRIBUTION_ID   (required unless --skip-invalidate)
 *   SITE_BASE_URL                     (optional; passed to the build for OG/canonical)
 *
 * Flags: --dry-run  --skip-media  --skip-build  --skip-invalidate
 *
 *   SITE_S3_BUCKET=opensidebar-site \
 *   SITE_CLOUDFRONT_DISTRIBUTION_ID=E123 \
 *   SITE_BASE_URL=https://opensidebar.com \
 *   node scripts/deploy-site.mjs
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DIST = path.join(ROOT, "apps", "site", "dist");
const args = new Set(process.argv.slice(2));
const DRY = args.has("--dry-run");

const BUCKET = process.env.SITE_S3_BUCKET;
const DIST_ID = process.env.SITE_CLOUDFRONT_DISTRIBUTION_ID;
const BASE_URL = process.env.SITE_BASE_URL || "";

function fail(msg) {
  console.error(`\n  ✗ ${msg}`);
  process.exit(1);
}

try {
  execFileSync("aws", ["--version"], { stdio: "ignore" });
} catch {
  fail("aws CLI not found on PATH. Install it and `aws configure` first.");
}
if (!BUCKET) fail("SITE_S3_BUCKET is required.");
if (!DIST_ID && !args.has("--skip-invalidate")) {
  fail("SITE_CLOUDFRONT_DISTRIBUTION_ID is required (or pass --skip-invalidate).");
}

function run(cmd, cmdArgs, opts = {}) {
  console.log("  $ " + cmd + " " + cmdArgs.join(" "));
  if (DRY && cmd === "aws") return "";
  return execFileSync(cmd, cmdArgs, {
    stdio: opts.capture ? ["ignore", "pipe", "inherit"] : "inherit",
    encoding: "utf8",
    env: { ...process.env },
  });
}

// ---------- 1. media ----------
if (!args.has("--skip-media")) {
  console.log("\n== Stage media ==");
  run("node", ["scripts/build-site-media.mjs"]);
}

// ---------- 2. build ----------
if (!args.has("--skip-build")) {
  console.log("\n== Build ==");
  // Call vite's binary directly through node — robust across platforms
  // (Windows execFileSync can't resolve the corepack/pnpm/nx .cmd shims).
  // SITE_BASE_URL flows through to vite's define via the inherited env.
  run(process.execPath, [
    "node_modules/vite/bin/vite.js",
    "build",
    "--config",
    "apps/site/vite.config.ts",
  ]);
}
if (!fs.existsSync(DIST)) fail(`Build output not found at ${DIST}.`);

const s3 = (p) => `s3://${BUCKET}${p}`;
const IMMUTABLE = "public,max-age=31536000,immutable";
const SHORT = "public,max-age=300,must-revalidate";

// ---------- 3. tiered sync ----------
console.log("\n== Sync: immutable assets ==");
run("aws", [
  "s3", "sync", path.join(DIST, "assets"), s3("/assets"),
  "--cache-control", IMMUTABLE, "--delete",
  ...(DRY ? ["--dryrun"] : []),
]);

console.log("\n== Sync: immutable media (mp4) ==");
run("aws", [
  "s3", "sync", path.join(DIST, "media"), s3("/media"),
  "--cache-control", IMMUTABLE,
  "--exclude", "*", "--include", "*.mp4",
  "--content-type", "video/mp4",
  ...(DRY ? ["--dryrun"] : []),
]);
console.log("\n== Sync: immutable media (posters) ==");
run("aws", [
  "s3", "sync", path.join(DIST, "media"), s3("/media"),
  "--cache-control", IMMUTABLE,
  "--exclude", "*", "--include", "*.jpg",
  "--content-type", "image/jpeg",
  ...(DRY ? ["--dryrun"] : []),
]);

console.log("\n== Sync: short-cache root (html, robots, icons, og) ==");
run("aws", [
  "s3", "sync", DIST, s3("/"),
  "--cache-control", SHORT,
  "--exclude", "assets/*", "--exclude", "media/*",
  ...(DRY ? ["--dryrun"] : []),
]);

// ---------- 4. invalidation ----------
if (!args.has("--skip-invalidate")) {
  console.log("\n== CloudFront invalidation (short-cache paths) ==");
  run("aws", [
    "cloudfront", "create-invalidation",
    "--distribution-id", DIST_ID,
    "--paths", "/", "/index.html", "/robots.txt", "/og.png", "/favicon.png", "/logo.png",
  ]);
}

console.log(
  `\n  ✓ ${DRY ? "[dry-run] " : ""}deploy complete` +
    (BASE_URL ? ` → ${BASE_URL}` : ""),
);
