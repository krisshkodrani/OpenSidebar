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

const packageJson = JSON.parse(
  readFileSync(resolve(rootPath, "package.json"), "utf-8"),
);
const version = packageJson.version;
if (typeof version !== "string" || version.length === 0) {
  throw new Error("package.json version is missing");
}

execFileSync(process.execPath, [resolve(rootPath, "scripts", "check-dist.js")], {
  cwd: rootPath,
  stdio: "inherit",
});

const outputName = `opensidebar-v${version}.zip`;
const outputPath = resolve(artifactDir, outputName);
const checksumPath = `${outputPath}.sha256`;

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

  return Buffer.concat([...localParts, centralDirectory, endOfCentralDirectory]);
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

console.log(`[release:package] Wrote ${relative(rootPath, outputPath)}`);
console.log(`[release:package] Wrote ${relative(rootPath, checksumPath)}`);
