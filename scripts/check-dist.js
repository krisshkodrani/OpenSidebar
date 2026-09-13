#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

const distPath = resolve(process.cwd(), "dist");
const errors = [];
const checked = [];
let packageJson = null;

function fail(message) {
  errors.push(message);
}

function asPosix(path) {
  return path.replace(/\\/g, "/");
}

function isInsideDist(path) {
  const resolved = resolve(path);
  return resolved === distPath || resolved.startsWith(`${distPath}${sep}`);
}

function existsFile(relativePath, label = relativePath) {
  const filePath = resolve(distPath, relativePath);
  if (!isInsideDist(filePath)) {
    fail(`${label}: path escapes dist (${relativePath})`);
    return false;
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    fail(`${label}: missing file ${relativePath}`);
    return false;
  }
  checked.push(relativePath);
  return true;
}

function existsDir(relativePath, label = relativePath) {
  const dirPath = resolve(distPath, relativePath);
  if (!isInsideDist(dirPath)) {
    fail(`${label}: path escapes dist (${relativePath})`);
    return false;
  }
  if (!existsSync(dirPath) || !statSync(dirPath).isDirectory()) {
    fail(`${label}: missing directory ${relativePath}`);
    return false;
  }
  checked.push(`${relativePath}/`);
  return true;
}

function readJson(relativePath) {
  try {
    return JSON.parse(readFileSync(resolve(distPath, relativePath), "utf-8"));
  } catch (error) {
    fail(`${relativePath}: invalid JSON (${error.message})`);
    return null;
  }
}

function readRootJson(relativePath) {
  try {
    return JSON.parse(readFileSync(resolve(process.cwd(), relativePath), "utf-8"));
  } catch (error) {
    fail(`${relativePath}: invalid JSON (${error.message})`);
    return null;
  }
}

function readText(relativePath) {
  try {
    return readFileSync(resolve(distPath, relativePath), "utf-8");
  } catch (error) {
    fail(`${relativePath}: unreadable (${error.message})`);
    return "";
  }
}

function normalizeAssetRef(raw, htmlPath) {
  if (!raw || raw.startsWith("http://") || raw.startsWith("https://")) {
    return null;
  }
  const withoutQuery = raw.split(/[?#]/, 1)[0];
  const absolutePath = withoutQuery.startsWith("/")
    ? resolve(distPath, withoutQuery.slice(1))
    : resolve(dirname(resolve(distPath, htmlPath)), withoutQuery);
  if (!isInsideDist(absolutePath)) {
    fail(`${htmlPath}: asset path escapes dist (${raw})`);
    return null;
  }
  return asPosix(relative(distPath, absolutePath));
}

function checkHtmlAssets(htmlPath) {
  if (!existsFile(htmlPath)) return;
  const html = readText(htmlPath);
  if (!html.includes('<div id="root"></div>')) {
    fail(`${htmlPath}: missing React root element`);
  }

  const refs = [...html.matchAll(/\b(?:src|href)="([^"]+)"/g)]
    .map((match) => normalizeAssetRef(match[1], htmlPath))
    .filter(Boolean);
  if (refs.length === 0) {
    fail(`${htmlPath}: no built script/style assets referenced`);
  }
  for (const ref of refs) {
    existsFile(ref, `${htmlPath} asset`);
  }
}

function checkServiceWorkerLoader(manifest) {
  const worker = manifest?.background?.service_worker;
  if (typeof worker !== "string" || worker.length === 0) {
    fail("manifest.background.service_worker: missing");
    return;
  }
  if (!existsFile(worker, "service worker loader")) return;

  const source = readText(worker);
  const imports = [...source.matchAll(/import\s+['"]([^'"]+)['"]/g)].map(
    (match) => match[1],
  );
  if (imports.length === 0) {
    fail(`${worker}: no static service worker import found`);
  }
  for (const specifier of imports) {
    const ref = normalizeAssetRef(specifier, worker);
    if (ref) existsFile(ref, "service worker import");
  }
}

function checkManifest() {
  if (!existsFile("manifest.json")) return null;
  const manifest = readJson("manifest.json");
  if (!manifest) return null;

  if (manifest.manifest_version !== 3) {
    fail("manifest.json: manifest_version must be 3");
  }
  if (typeof manifest.name !== "string" || manifest.name.length === 0) {
    fail("manifest.json: missing name");
  }
  if (typeof manifest.version !== "string" || manifest.version.length === 0) {
    fail("manifest.json: missing version");
  }
  if (packageJson?.version && manifest.version !== packageJson.version) {
    fail(
      `manifest.json: version ${manifest.version} does not match package.json ${packageJson.version}`,
    );
  }

  checkServiceWorkerLoader(manifest);

  const sidePanelPath = manifest?.side_panel?.default_path;
  if (typeof sidePanelPath !== "string" || sidePanelPath.length === 0) {
    fail("manifest.side_panel.default_path: missing");
  } else {
    checkHtmlAssets(sidePanelPath);
  }

  for (const [size, iconPath] of Object.entries(manifest.icons ?? {})) {
    if (typeof iconPath !== "string") {
      fail(`manifest.icons.${size}: must be a string`);
      continue;
    }
    existsFile(iconPath, `manifest icon ${size}`);
  }

  for (const [size, iconPath] of Object.entries(
    manifest.action?.default_icon ?? {},
  )) {
    if (typeof iconPath !== "string") {
      fail(`manifest.action.default_icon.${size}: must be a string`);
      continue;
    }
    existsFile(iconPath, `action icon ${size}`);
  }

  for (const [index, script] of (manifest.content_scripts ?? []).entries()) {
    for (const jsPath of script.js ?? []) {
      if (typeof jsPath === "string") {
        existsFile(jsPath, `content script ${index}`);
      } else {
        fail(`manifest.content_scripts.${index}.js: contains non-string entry`);
      }
    }
  }

  for (const [index, resourceBlock] of (
    manifest.web_accessible_resources ?? []
  ).entries()) {
    for (const resource of resourceBlock.resources ?? []) {
      if (resource === "assets/*") {
        existsDir("assets", `web_accessible_resources ${index}`);
      } else if (typeof resource === "string") {
        existsFile(resource, `web_accessible_resources ${index}`);
      } else {
        fail(`manifest.web_accessible_resources.${index}: non-string resource`);
      }
    }
  }

  return manifest;
}

/**
 * The shipped artifact must not contain dev/test surface: the trace
 * viewer (dev observability page), the e2e helper fixtures, or any code
 * path that calls the local log-server. See docs: log-server + trace
 * viewer are development/local-only tools.
 */
function checkNoDevSurface() {
  const forbiddenPaths = [
    "src/trace-viewer",
    "e2e-helper.html",
    "e2e-overlay-loader.js",
  ];
  for (const relativePath of forbiddenPaths) {
    if (existsSync(resolve(distPath, relativePath))) {
      fail(`dev/test surface must not ship: dist/${relativePath}`);
    } else {
      checked.push(`!${relativePath}`);
    }
  }

  const forbiddenStrings = ["127.0.0.1:7589"];
  const stack = [distPath];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const entryPath = resolve(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }
      if (!/\.(js|mjs|css|html|json)$/.test(entry.name)) continue;
      const content = readFileSync(entryPath, "utf-8");
      for (const needle of forbiddenStrings) {
        if (content.includes(needle)) {
          fail(
            `dev-server reference "${needle}" leaked into ${asPosix(relative(distPath, entryPath))}`,
          );
        }
      }
    }
  }
  checked.push("!127.0.0.1:7589");
}

if (!existsSync(distPath) || !statSync(distPath).isDirectory()) {
  fail("dist folder not found");
} else {
  if (existsSync(resolve(distPath, ".remote-mission-acceptance.json"))) {
    fail(
      "acceptance-only dist cannot pass release verification; rebuild with npm run build",
    );
  }
  packageJson = readRootJson("package.json");
  checkManifest();
  checkNoDevSurface();
  existsFile(".vite/manifest.json", "Vite manifest");
}

if (errors.length > 0) {
  console.error("[ci:dist] Dist verification failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(
  `[ci:dist] Dist verification passed (${new Set(checked).size} files/directories checked)`,
);
