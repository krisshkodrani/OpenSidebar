#!/usr/bin/env node
/**
 * Deploy the public Playground without changing the marketing-site deployment.
 *
 * Required environment:
 *   SANDBOX_CONTROL_BUCKET          existing opensidebar.com site bucket
 *   SANDBOX_CONTROL_DISTRIBUTION_ID apex CloudFront distribution
 *   SANDBOX_TARGET_BUCKET           CDK TargetBucketName output
 *   SANDBOX_TARGET_DISTRIBUTION_ID  play.opensidebar.com distribution
 *
 * The CDK stack is deliberately deployed separately (`pnpm sandbox:synth` /
 * `cdk deploy`). This script only publishes immutable browser assets.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
const dist = path.join(root, "apps", "sandbox", "dist");
const redirect = path.join(root, "apps", "sandbox", "sandbox-redirect.html");
const dryRun = process.argv.includes("--dry-run");
const required = [
  "SANDBOX_CONTROL_BUCKET",
  "SANDBOX_CONTROL_DISTRIBUTION_ID",
  "SANDBOX_TARGET_BUCKET",
  "SANDBOX_TARGET_DISTRIBUTION_ID",
];
for (const name of required) if (!process.env[name]) throw new Error(`${name} is required.`);

function run(command, args) {
  console.log(`$ ${command} ${args.join(" ")}`);
  if (dryRun && command === "aws") return;
  execFileSync(command, args, { cwd: root, stdio: "inherit", env: process.env });
}

run(process.execPath, ["node_modules/vite/bin/vite.js", "build", "--config", "apps/sandbox/vite.config.ts"]);
if (!existsSync(dist)) throw new Error("Sandbox build did not produce apps/sandbox/dist.");
const indexHtml = readFileSync(path.join(dist, "index.html"), "utf8");
if (!indexHtml.includes('/playground/assets/') || indexHtml.includes('="/assets/')) {
  throw new Error("Playground build must reference assets below /playground/assets/.");
}

function isolatedTargetDirectory() {
  const manifestPath = path.join(dist, ".vite", "manifest.json");
  if (!existsSync(manifestPath)) throw new Error("Playground build did not produce its Vite manifest.");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const entry = Object.entries(manifest).find(([, value]) => value.isEntry && value.src?.endsWith("target.html"));
  if (!entry) throw new Error("Vite manifest is missing the target entry.");
  const files = new Set();
  const visit = (key) => {
    const chunk = manifest[key];
    if (!chunk) throw new Error(`Target manifest dependency ${key} is missing.`);
    files.add(chunk.file);
    for (const file of [...(chunk.css ?? []), ...(chunk.assets ?? [])]) files.add(file);
    for (const imported of [...(chunk.imports ?? []), ...(chunk.dynamicImports ?? [])]) visit(imported);
  };
  visit(entry[0]);
  for (const file of files) {
    if (file.includes("control-")) throw new Error(`Target dependency closure contains Control Center asset ${file}.`);
  }
  const directory = mkdtempSync(path.join(tmpdir(), "opensidebar-target-"));
  copyFileSync(path.join(dist, "target.html"), path.join(directory, "index.html"));
  for (const file of files) {
    const destination = path.join(directory, file);
    mkdirSync(path.dirname(destination), { recursive: true });
    copyFileSync(path.join(dist, file), destination);
  }
  return { directory, files };
}

const cache = "public,max-age=31536000,immutable";
const shortCache = "public,max-age=300,must-revalidate";
const awsDry = dryRun ? ["--dryrun"] : [];

// Apex Control Center is canonical at /playground. /sandbox remains a static
// redirect during migration so old links never hit the marketing error page.
run("aws", ["s3", "sync", path.join(dist, "playground", "assets"), `s3://${process.env.SANDBOX_CONTROL_BUCKET}/playground/assets`, "--cache-control", cache, "--delete", ...awsDry]);
run("aws", ["s3", "cp", path.join(dist, "index.html"), `s3://${process.env.SANDBOX_CONTROL_BUCKET}/playground`, "--content-type", "text/html", "--cache-control", shortCache, ...awsDry]);
run("aws", ["s3", "cp", path.join(dist, "index.html"), `s3://${process.env.SANDBOX_CONTROL_BUCKET}/playground/index.html`, "--content-type", "text/html", "--cache-control", shortCache, ...awsDry]);
run("aws", ["s3", "cp", path.join(dist, "index.html"), `s3://${process.env.SANDBOX_CONTROL_BUCKET}/account`, "--content-type", "text/html", "--cache-control", shortCache, ...awsDry]);
run("aws", ["s3", "cp", path.join(dist, "index.html"), `s3://${process.env.SANDBOX_CONTROL_BUCKET}/settings`, "--content-type", "text/html", "--cache-control", shortCache, ...awsDry]);
for (const route of [
  "dashboard",
  "dashboard/activation",
  "sessions",
  "viewer",
  "app",
  "app/account",
  "app/settings",
  "app/sessions",
  "app/viewer",
  "app/playground",
  "app/sign-in",
  "app/internal/activation",
]) {
  run("aws", ["s3", "cp", path.join(dist, "index.html"), `s3://${process.env.SANDBOX_CONTROL_BUCKET}/${route}`, "--content-type", "text/html", "--cache-control", shortCache, ...awsDry]);
}
run("aws", ["s3", "cp", redirect, `s3://${process.env.SANDBOX_CONTROL_BUCKET}/sandbox`, "--content-type", "text/html", "--cache-control", shortCache, ...awsDry]);

// The target origin receives only the target entry's manifest closure. Keeping
// Control Center code off this origin makes the two-room boundary physical, not
// merely dependent on the target HTML avoiding those files.
const isolatedTarget = isolatedTargetDirectory();
console.log(`Target deployment contains ${isolatedTarget.files.size} isolated assets.`);
try {
  run("aws", ["s3", "sync", isolatedTarget.directory, `s3://${process.env.SANDBOX_TARGET_BUCKET}`, "--cache-control", shortCache, "--delete", ...awsDry]);
} finally {
  rmSync(isolatedTarget.directory, { recursive: true, force: true });
}
if (!dryRun) {
  run("aws", ["cloudfront", "create-invalidation", "--distribution-id", process.env.SANDBOX_CONTROL_DISTRIBUTION_ID, "--paths", "/playground", "/playground/index.html", "/playground/assets/*", "/account", "/settings", "/dashboard", "/dashboard/activation", "/sessions", "/viewer", "/app", "/app/*", "/sandbox"]);
  run("aws", ["cloudfront", "create-invalidation", "--distribution-id", process.env.SANDBOX_TARGET_DISTRIBUTION_ID, "--paths", "/*"]);
}
