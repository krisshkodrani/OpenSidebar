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
  fail(
    "SITE_CLOUDFRONT_DISTRIBUTION_ID is required (or pass --skip-invalidate).",
  );
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

function validateReferencedMedia() {
  const htmlFiles = [];
  const pending = [DIST];
  while (pending.length > 0) {
    const dir = pending.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) pending.push(entryPath);
      else if (entry.name.endsWith(".html")) htmlFiles.push(entryPath);
    }
  }

  const missing = new Set();
  for (const htmlFile of htmlFiles) {
    const html = fs.readFileSync(htmlFile, "utf8");
    for (const match of html.matchAll(
      /(?:data-src|poster|src)=["'](\/media\/[^"'?#]+)["']/g,
    )) {
      const mediaPath = path.join(DIST, ...match[1].split("/").filter(Boolean));
      if (!fs.existsSync(mediaPath)) missing.add(match[1]);
    }
  }

  if (missing.size > 0) {
    fail(
      "Built HTML references missing media:\n     " +
        [...missing].join("\n     ") +
        "\n  Stage the current media manifest or deploy without --skip-media.",
    );
  }
}

validateReferencedMedia();

const s3 = (p) => `s3://${BUCKET}${p}`;
const IMMUTABLE = "public,max-age=31536000,immutable";
const SHORT = "public,max-age=300,must-revalidate";

// ---------- 3. tiered sync ----------
console.log("\n== Sync: immutable assets ==");
run("aws", [
  "s3",
  "sync",
  path.join(DIST, "assets"),
  s3("/assets"),
  "--cache-control",
  IMMUTABLE,
  "--delete",
  ...(DRY ? ["--dryrun"] : []),
]);

console.log("\n== Sync: immutable media (mp4) ==");
run("aws", [
  "s3",
  "sync",
  path.join(DIST, "media"),
  s3("/media"),
  "--cache-control",
  IMMUTABLE,
  "--exclude",
  "*",
  "--include",
  "*.mp4",
  "--content-type",
  "video/mp4",
  ...(DRY ? ["--dryrun"] : []),
]);
console.log("\n== Sync: immutable media (posters) ==");
run("aws", [
  "s3",
  "sync",
  path.join(DIST, "media"),
  s3("/media"),
  "--cache-control",
  IMMUTABLE,
  "--exclude",
  "*",
  "--include",
  "*.jpg",
  "--content-type",
  "image/jpeg",
  ...(DRY ? ["--dryrun"] : []),
]);

console.log("\n== Sync: short-cache root (html, robots, icons, og) ==");
run("aws", [
  "s3",
  "sync",
  DIST,
  s3("/"),
  "--cache-control",
  SHORT,
  "--exclude",
  "assets/*",
  "--exclude",
  "media/*",
  ...(DRY ? ["--dryrun"] : []),
]);

// Extensionless copies for subpages. CloudFront maps 403 (missing key) to
// /index.html, so a clean subpage URL would silently serve the landing page
// unless an object exists at that exact key.
const CLEAN_URL_PAGES = [
  "walkthrough",
  "ideas",
  "ideas/done-means-verified",
  "ideas/the-sandbox-needs-two-rooms",
];
for (const page of CLEAN_URL_PAGES) {
  const src =
    page === "ideas"
      ? path.join(DIST, "ideas", "index.html")
      : path.join(DIST, `${page}.html`);
  if (!fs.existsSync(src))
    fail(`Expected ${path.relative(DIST, src)} in dist for clean-URL copy.`);
  console.log(`\n== Clean URL: /${page} ==`);
  run("aws", [
    "s3",
    "cp",
    src,
    s3(`/${page}`),
    "--cache-control",
    SHORT,
    "--content-type",
    "text/html",
    ...(DRY ? ["--dryrun"] : []),
  ]);
}

// ---------- 4. invalidation ----------
if (!args.has("--skip-invalidate")) {
  console.log("\n== CloudFront invalidation (short-cache paths) ==");
  run("aws", [
    "cloudfront",
    "create-invalidation",
    "--distribution-id",
    DIST_ID,
    "--paths",
    "/",
    "/index.html",
    "/robots.txt",
    "/og.png",
    "/favicon.png",
    "/logo.png",
    ...CLEAN_URL_PAGES.flatMap((p) => [`/${p}`, `/${p}.html`]),
  ]);
}

console.log(
  `\n  ✓ ${DRY ? "[dry-run] " : ""}deploy complete` +
    (BASE_URL ? ` → ${BASE_URL}` : ""),
);
