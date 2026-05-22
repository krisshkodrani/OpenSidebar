#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, relative, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const rootPath = process.cwd();
const args = new Set(process.argv.slice(2));
const knownArgs = new Set([
  "--allow-dirty",
  "--require-gh",
  "--require-native-smoke",
  "--require-tag",
]);
const allowDirty = args.has("--allow-dirty");
const requireGh = args.has("--require-gh");
const requireNativeSmoke = args.has("--require-native-smoke");
const requireTag = args.has("--require-tag");
const errors = [];
const warnings = [];

for (const arg of args) {
  if (!knownArgs.has(arg)) {
    errors.push(`Unknown argument: ${arg}`);
  }
}

function fail(message) {
  errors.push(message);
}

function warn(message) {
  warnings.push(message);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch (error) {
    fail(`${path}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function git(args) {
  try {
    return execFileSync("git", args, {
      cwd: rootPath,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function commandSucceeds(command, args) {
  try {
    execFileSync(command, args, {
      cwd: rootPath,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function fileSha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function asPosix(path) {
  return path.replace(/\\/g, "/");
}

function collectFiles(directory, predicate) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(path, predicate));
    } else if (entry.isFile() && predicate(path)) {
      files.push(path);
    }
  }
  return files;
}

const packageJson = readJson(resolve(rootPath, "package.json"));
const distManifest = readJson(resolve(rootPath, "dist", "manifest.json"));
const version = packageJson?.version;

if (!version) {
  fail("package.json version is missing");
}

if (version && distManifest?.version !== version) {
  fail(
    `dist/manifest.json version ${distManifest?.version ?? "missing"} does not match package.json ${version}`,
  );
}

const releaseDir = resolve(rootPath, ".artifacts", "releases");
const artifactBaseName = version ? `opensidebar-v${version}` : "opensidebar";
const zipPath = resolve(releaseDir, `${artifactBaseName}.zip`);
const checksumPath = resolve(releaseDir, `${artifactBaseName}.zip.sha256`);
const notesPath = resolve(releaseDir, `${artifactBaseName}-release-notes.md`);
const manifestPath = resolve(releaseDir, `${artifactBaseName}-manifest.json`);
const expectedZipArtifactPath = asPosix(relative(rootPath, zipPath));
const expectedChecksumArtifactPath = asPosix(relative(rootPath, checksumPath));
const expectedNotesArtifactPath = asPosix(relative(rootPath, notesPath));
const releaseManifest = readJson(manifestPath);
const headCommit = git(["rev-parse", "HEAD"]);
const tagName = version ? `v${version}` : null;
let zipHash = null;

for (const path of [zipPath, checksumPath, notesPath, manifestPath]) {
  if (!existsSync(path)) fail(`${path}: missing; run npm run release:package`);
}

if (releaseManifest) {
  if (releaseManifest.version !== version) {
    fail(`release manifest version ${releaseManifest.version} does not match ${version}`);
  }
  if (releaseManifest.packageVersion !== version) {
    fail(
      `release manifest packageVersion ${releaseManifest.packageVersion} does not match ${version}`,
    );
  }
  if (releaseManifest.extensionManifestVersion !== distManifest?.version) {
    fail(
      `release manifest extensionManifestVersion ${releaseManifest.extensionManifestVersion} does not match dist manifest ${distManifest?.version}`,
    );
  }
  if (headCommit && releaseManifest.commit !== headCommit) {
    fail(
      `release manifest commit ${releaseManifest.commit} does not match HEAD ${headCommit}`,
    );
  }
}

if (existsSync(zipPath)) {
  const actualHash = fileSha256(zipPath);
  zipHash = actualHash;
  const checksumText = existsSync(checksumPath)
    ? readFileSync(checksumPath, "utf-8").trim()
    : "";
  const [expectedHash, expectedFileName] = checksumText.split(/\s+/);
  if (!expectedHash) {
    fail("checksum file is empty");
  } else if (actualHash !== expectedHash) {
    fail(`zip SHA-256 ${actualHash} does not match checksum file ${expectedHash}`);
  }
  if (!expectedFileName) {
    fail("checksum file is missing the artifact filename");
  } else if (expectedFileName !== basename(zipPath)) {
    fail(
      `checksum file names ${expectedFileName}, expected ${basename(zipPath)}`,
    );
  }
  const zipArtifact = releaseManifest?.artifacts?.find?.(
    (artifact) => artifact.path === expectedZipArtifactPath,
  );
  const checksumArtifact = releaseManifest?.artifacts?.find?.(
    (artifact) => artifact.path === expectedChecksumArtifactPath,
  );
  const notesArtifact = releaseManifest?.artifacts?.find?.(
    (artifact) => artifact.path === expectedNotesArtifactPath,
  );
  if (zipArtifact) {
    if (zipArtifact.sha256 !== actualHash) {
      fail(
        `release manifest zip SHA-256 ${zipArtifact.sha256} does not match ${actualHash}`,
      );
    }
    const sizeBytes = statSync(zipPath).size;
    if (zipArtifact.sizeBytes !== sizeBytes) {
      fail(
        `release manifest zip size ${zipArtifact.sizeBytes} does not match ${sizeBytes}`,
      );
    }
  } else if (releaseManifest) {
    fail("release manifest is missing the zip artifact entry");
  }
  if (checksumArtifact) {
    const checksumSize = statSync(checksumPath).size;
    if (checksumArtifact.sizeBytes !== checksumSize) {
      fail(
        `release manifest checksum size ${checksumArtifact.sizeBytes} does not match ${checksumSize}`,
      );
    }
    if (checksumArtifact.sha256For !== basename(zipPath)) {
      fail(
        `release manifest checksum sha256For ${checksumArtifact.sha256For} does not match ${basename(zipPath)}`,
      );
    }
  } else if (releaseManifest) {
    fail("release manifest is missing the checksum artifact entry");
  }
  if (!notesArtifact && releaseManifest) {
    fail("release manifest is missing the release notes artifact entry");
  }
}

if (existsSync(notesPath)) {
  const notes = readFileSync(notesPath, "utf-8");
  for (const required of [
    `OpenSidebar v${version}`,
    `${artifactBaseName}.zip`,
    "Known Limitations",
    headCommit ?? "",
  ].filter(Boolean)) {
    if (!notes.includes(required)) {
      fail(`release notes are missing required text: ${required}`);
    }
  }
  if (zipHash && !notes.includes(zipHash)) {
    fail(`release notes are missing zip SHA-256 ${zipHash}`);
  }
}

const nativeSmokeDir = resolve(rootPath, ".artifacts", "e2e", "native-sidepanel");
const nativeSmokeFiles = collectFiles(nativeSmokeDir, (path) =>
  path.endsWith(".json"),
);
const nativeSmokeEvidence = nativeSmokeFiles
  .map((path) => {
    try {
      return { path, report: JSON.parse(readFileSync(path, "utf-8")) };
    } catch {
      return null;
    }
  })
  .filter(Boolean);
const matchingNativeSmoke = nativeSmokeEvidence.find(
  (entry) =>
    entry.report?.result === "passed" &&
    headCommit &&
    entry.report?.commit === headCommit,
);
if (!matchingNativeSmoke) {
  const latestNativeSmoke = nativeSmokeEvidence
    .map((entry) => ({
      ...entry,
      mtimeMs: statSync(entry.path).mtimeMs,
    }))
    .sort((left, right) => right.mtimeMs - left.mtimeMs)[0];
  const detail = latestNativeSmoke
    ? ` Latest native smoke was ${latestNativeSmoke.report?.result ?? "unknown"} at ${asPosix(
        relative(rootPath, latestNativeSmoke.path),
      )}.`
    : "";
  const message = `No passing native side-panel smoke evidence found for HEAD ${headCommit ?? "unknown"}.${detail} Run npm run release:smoke:native-panel before tagging.`;
  if (requireNativeSmoke) fail(message);
  else warn(message);
}

const status = git(["status", "--porcelain"]);
if (status) {
  const message =
    "working tree has uncommitted changes; commit before tagging a final release";
  if (allowDirty) warn(message);
  else fail(message);
}

if (tagName) {
  const tagCommit = git(["rev-list", "-n", "1", tagName]);
  if (tagCommit && headCommit && tagCommit !== headCommit) {
    fail(`${tagName} points at ${tagCommit}, not HEAD ${headCommit}`);
  } else if (!tagCommit) {
    const message = `${tagName} does not exist locally yet`;
    if (requireTag) fail(message);
    else warn(`${message}; create it after the final manual spot-check`);
  }
}

const ghIsReady = commandSucceeds("gh", ["auth", "status"]);
if (!ghIsReady) {
  const message =
    "GitHub CLI is unavailable or not authenticated; run gh auth login or publish the draft release manually";
  if (requireGh) fail(message);
  else warn(message);
}

if (errors.length > 0) {
  console.error("[release:preflight] Failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("[release:preflight] Release artifacts are internally consistent.");
for (const warning of warnings) console.log(`[release:preflight] WARN ${warning}`);

if (tagName) {
  console.log("");
  console.log("[release:preflight] Final publication commands after manual gates:");
  console.log(`  git tag ${tagName}`);
  console.log(`  git push origin ${tagName}`);
  console.log(
    `  gh release create ${tagName} --draft --title "OpenSidebar ${tagName} OSS BYOK Preview" --notes-file ${notesPath} ${zipPath} ${checksumPath}`,
  );
  console.log("");
  console.log("[release:preflight] Upload artifacts:");
  console.log(`  ${basename(zipPath)}`);
  console.log(`  ${basename(checksumPath)}`);
}
