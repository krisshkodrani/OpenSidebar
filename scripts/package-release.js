#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, relative, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const rootPath = process.cwd();
const distPath = resolve(rootPath, "dist");
const artifactDir = resolve(rootPath, ".artifacts", "releases");
const fixedDosTime = 0;
const fixedDosDate = (1 << 5) | 1; // 1980-01-01
const nxCliPath = resolve(
  rootPath,
  "node_modules",
  "nx",
  "dist",
  "bin",
  "nx.js",
);

const packageJson = JSON.parse(
  readFileSync(resolve(rootPath, "package.json"), "utf-8"),
);
const version = packageJson.version;
if (typeof version !== "string" || version.length === 0) {
  throw new Error("package.json version is missing");
}

execFileSync(process.execPath, [nxCliPath, "run", "extension:build"], {
  cwd: rootPath,
  stdio: "inherit",
});

const builtJavaScript = readdirSync(resolve(distPath, "assets"))
  .filter((name) => name.endsWith(".js"))
  .map((name) => readFileSync(resolve(distPath, "assets", name), "utf8"))
  .join("\n");
for (const marker of [
  "https://opensidebar.com",
  "/api/v1/extension/auth/code",
  "/api/v1/extension/auth/verify",
])
  if (!builtJavaScript.includes(marker))
    throw new Error(
      `Passwordless account sign-in marker is missing: ${marker}`,
    );

execFileSync(
  process.execPath,
  [resolve(rootPath, "scripts", "check-dist.js")],
  {
    cwd: rootPath,
    stdio: "inherit",
  },
);

const outputName = `opensidebar-v${version}.zip`;
const outputPath = resolve(artifactDir, outputName);
const checksumPath = `${outputPath}.sha256`;
const releaseNotesPath = resolve(
  artifactDir,
  `opensidebar-v${version}-release-notes.md`,
);
const releaseManifestPath = resolve(
  artifactDir,
  `opensidebar-v${version}-manifest.json`,
);

function collectFiles(directory) {
  const entries = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      entries.push(...collectFiles(absolutePath));
    } else if (entry.isFile()) {
      entries.push(absolutePath);
    }
  }
  return entries;
}

const crcTable = new Uint32Array(256);
for (let index = 0; index < crcTable.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  crcTable[index] = value >>> 0;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUInt16(value) {
  const buffer = Buffer.allocUnsafe(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function writeUInt32(value) {
  const buffer = Buffer.allocUnsafe(4);
  buffer.writeUInt32LE(value >>> 0);
  return buffer;
}

function makeZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const filePath of files) {
    const name = relative(distPath, filePath).replace(/\\/g, "/");
    const nameBuffer = Buffer.from(name, "utf-8");
    const content = readFileSync(filePath);
    const checksum = crc32(content);

    const localHeader = Buffer.concat([
      writeUInt32(0x04034b50),
      writeUInt16(20),
      writeUInt16(0x0800),
      writeUInt16(0),
      writeUInt16(fixedDosTime),
      writeUInt16(fixedDosDate),
      writeUInt32(checksum),
      writeUInt32(content.length),
      writeUInt32(content.length),
      writeUInt16(nameBuffer.length),
      writeUInt16(0),
      nameBuffer,
    ]);

    localParts.push(localHeader, content);

    centralParts.push(
      Buffer.concat([
        writeUInt32(0x02014b50),
        writeUInt16(20),
        writeUInt16(20),
        writeUInt16(0x0800),
        writeUInt16(0),
        writeUInt16(fixedDosTime),
        writeUInt16(fixedDosDate),
        writeUInt32(checksum),
        writeUInt32(content.length),
        writeUInt32(content.length),
        writeUInt16(nameBuffer.length),
        writeUInt16(0),
        writeUInt16(0),
        writeUInt16(0),
        writeUInt16(0),
        writeUInt32(0),
        writeUInt32(offset),
        nameBuffer,
      ]),
    );

    offset += localHeader.length + content.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const endOfCentralDirectory = Buffer.concat([
    writeUInt32(0x06054b50),
    writeUInt16(0),
    writeUInt16(0),
    writeUInt16(files.length),
    writeUInt16(files.length),
    writeUInt32(centralDirectory.length),
    writeUInt32(offset),
    writeUInt16(0),
  ]);

  return Buffer.concat([
    ...localParts,
    centralDirectory,
    endOfCentralDirectory,
  ]);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function readGitCommit() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: rootPath,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

function writeReleaseNotes({ commit, distManifest, hash }) {
  const notes = `# OpenSidebar v${version}

OpenSidebar v${version} adds supervised remote browser work to the normal production extension while preserving local browser tasks and Direct from this browser. It ships as a reproducible Chrome Web Store update candidate and unpacked-extension zip.

## Highlights

- Linked named-tester devices can receive supervised read-only browser missions from opensidebar.com and compatible MCP clients.
- Remote targets are bound to an existing OpenSidebar tab group with the sidepanel enabled; detached or stale targets fail closed before execution and are rechecked at completion.
- Active-tab, existing-tab, duplicate-tab selection, and isolated-tab creation return bounded workspace, window, URL, title, and sidepanel evidence without raw Chrome identifiers.
- The task-centered workbench presents local tasks, plans, decisions, watch mode, and remote missions as one state-driven workflow with bounded history.
- Account sign-in uses Cognito email OTP and revocable device sessions; serialized refresh preserves the session across extension contexts and token rotation.
- Direct from this browser remains available for local provider use, and local browser tasks continue independently of remote work.
- Settings navigation survives tab switches and sidepanel remounts for the current Chrome session.
- Remote takeover, device-command execution, checkpoint restore, and Temporal coordination remain disabled for this release.
- The extension remains compatible with the audited 0.7.4 backend contract; the production dependency audit reports no known vulnerabilities.
- DOMPurify is updated to \`3.4.13\`, and the container runtime dependency manifest is checked against the audited lockfile during release verification.
- Release packaging builds \`dist/\`, verifies manifest/package version alignment, and writes a deterministic ZIP with a SHA-256 checksum.

## Verification

- \`corepack pnpm install --frozen-lockfile\`
- \`corepack pnpm run lint\`
- \`corepack pnpm run typecheck\`
- \`corepack pnpm run ci:test\`
- \`corepack pnpm run ci:dist\`
- \`corepack pnpm run ci:audit\`
- \`corepack pnpm run release:package\`
- \`corepack pnpm run release:preflight\`
- Assisted native side-panel smoke: \`corepack pnpm run release:smoke:native-panel\`
- Strict native-smoke preflight before tagging: \`corepack pnpm run release:preflight --require-native-smoke\`
- Detached panel smoke: \`E2E_PROFILE=headless E2E_ARTIFACTS=detached-panel,screenshots npx tsx scripts/run-e2e-panel-smoke.ts --holdMs=1\`
- Safe first-task smoke: \`E2E_PROFILE=headless E2E_ARTIFACTS=detached-panel,screenshots npx vitest run --config apps/extension/tests/e2e/vitest.e2e.config.ts apps/extension/tests/e2e/summarize.test.ts\`

## Artifacts

- \`${outputName}\`
- \`${outputName}.sha256\`

SHA-256:

\`\`\`text
${hash}  ${outputName}
\`\`\`

## Install

1. Upload \`${outputName}\` as an update to the existing OpenSidebar Chrome Web Store item, or unzip it for local review.
2. For unpacked review, open \`chrome://extensions/\`, enable Developer mode, click Load unpacked, and select the unzipped folder.
3. Open the side panel, sign in to your OpenSidebar account, and connect a supported provider. Direct from this browser remains available under Advanced.

Start with a read-only task such as "Summarize this page" on a non-sensitive page.

## Known Limitations

Review \`docs/known-limitations.md\` before using the preview on sensitive websites. Browser agents can misread page state, Done/verifier checks are not a guarantee, provider behavior depends on the configured provider, and local traces may contain page content.

## Commit

Release candidate commit: \`${commit}\`

## Extension Manifest

- Version: \`${distManifest.version ?? "unknown"}\`
- Description: ${distManifest.description ?? ""}
`;
  writeFileSync(releaseNotesPath, notes);
}

function writeReleaseManifest({ commit, distManifest, hash, zipSize }) {
  const checksumSize = Buffer.byteLength(`${hash}  ${outputName}\n`);
  const releaseManifest = {
    name: distManifest.name ?? "OpenSidebar",
    version,
    commit,
    date: new Date().toISOString().slice(0, 10),
    packageVersion: version,
    extensionManifestVersion: distManifest.version ?? null,
    extensionManifestDescription: distManifest.description ?? null,
    artifacts: [
      {
        path: asPosix(relative(rootPath, outputPath)),
        sizeBytes: zipSize,
        sha256: hash,
      },
      {
        path: asPosix(relative(rootPath, checksumPath)),
        sizeBytes: checksumSize,
        sha256For: outputName,
      },
      {
        path: asPosix(relative(rootPath, releaseNotesPath)),
      },
    ],
    verification: [
      "corepack pnpm install --frozen-lockfile",
      "corepack pnpm run lint",
      "corepack pnpm run typecheck",
      "corepack pnpm run ci:test",
      "corepack pnpm run ci:dist",
      "corepack pnpm run ci:audit",
      "corepack pnpm run release:package",
      "corepack pnpm run release:preflight",
      "corepack pnpm run release:smoke:native-panel",
      "corepack pnpm run release:preflight --require-native-smoke",
      "E2E_PROFILE=headless E2E_ARTIFACTS=detached-panel,screenshots npx tsx scripts/run-e2e-panel-smoke.ts --holdMs=1",
      "E2E_PROFILE=headless E2E_ARTIFACTS=detached-panel,screenshots npx vitest run --config apps/extension/tests/e2e/vitest.e2e.config.ts apps/extension/tests/e2e/summarize.test.ts",
    ],
    remainingExternalGates: [
      "Native Chrome side-panel smoke with corepack pnpm run release:smoke:native-panel, followed by corepack pnpm run release:preflight --require-native-smoke",
      "GitHub tag",
      "GitHub release notes publication",
      "Release artifact and checksum upload",
    ],
  };
  writeFileSync(
    releaseManifestPath,
    `${JSON.stringify(releaseManifest, null, 2)}\n`,
  );
}

function asPosix(path) {
  return path.replace(/\\/g, "/");
}

if (!existsSync(distPath) || !statSync(distPath).isDirectory()) {
  throw new Error("dist folder not found; run corepack pnpm run dist first");
}

mkdirSync(dirname(outputPath), { recursive: true });
const files = collectFiles(distPath).sort((left, right) =>
  left.localeCompare(right, "en"),
);
if (files.length === 0) {
  throw new Error("dist folder is empty");
}

const zipBuffer = makeZip(files);
writeFileSync(outputPath, zipBuffer);

const hash = createHash("sha256").update(zipBuffer).digest("hex");
writeFileSync(checksumPath, `${hash}  ${basename(outputPath)}\n`);
const distManifest = readJson(resolve(distPath, "manifest.json"));
const commit = readGitCommit();
writeReleaseNotes({ commit, distManifest, hash });
writeReleaseManifest({
  commit,
  distManifest,
  hash,
  zipSize: zipBuffer.length,
});

console.log(`[release:package] Wrote ${relative(rootPath, outputPath)}`);
console.log(`[release:package] Wrote ${relative(rootPath, checksumPath)}`);
console.log(`[release:package] Wrote ${relative(rootPath, releaseNotesPath)}`);
console.log(
  `[release:package] Wrote ${relative(rootPath, releaseManifestPath)}`,
);
