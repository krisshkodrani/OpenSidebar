#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
const dist = path.join(process.cwd(), "apps", "sandbox", "dist");
const manifest = JSON.parse(readFileSync(path.join(dist, ".vite", "manifest.json"), "utf8"));
const control = readFileSync(path.join(dist, "index.html"), "utf8");
if (!control.includes("/playground/assets/control-")) throw new Error("Missing control entry.");
const assets = new Set();
const visited = new Set();
function visit(key) {
  if (visited.has(key)) return;
  visited.add(key);
  const chunk = manifest[key];
  if (!chunk) throw new Error("Missing target dependency: " + key);
  assets.add(chunk.file);
  for (const file of [...(chunk.css ?? []), ...(chunk.assets ?? [])]) assets.add(file);
  for (const dependency of [...(chunk.imports ?? []), ...(chunk.dynamicImports ?? [])]) visit(dependency);
}
for (const source of ["target.html", "scenario-target.html", "public-scenario-target.html"]) {
  const html = readFileSync(path.join(dist, source), "utf8");
  if (html.includes("control-")) throw new Error("Control Center referenced by " + source);
  const scripts = [...html.matchAll(/<script[^>]+src="\/([^" ]+)"/g)];
  if (!scripts.length) throw new Error("Missing target scripts: " + source);
  for (const match of scripts) {
    const key = Object.keys(manifest).find((key) => manifest[key].file === match[1]);
    if (!key) throw new Error("Target script absent from manifest: " + match[1]);
    visit(key);
  }
}
const forbidden = ["ChakraProvider", "QueryClient", "__Host-os_session", "os_csrf", "/api/v1/playground", "opensidebar:sandbox:runs"];
for (const file of assets) {
  if (file.includes("control-")) throw new Error("Control Center asset in target closure: " + file);
  const body = readFileSync(path.join(dist, file), "utf8");
  for (const token of forbidden) if (body.includes(token)) throw new Error("Forbidden target token " + token + " in " + file);
}
console.log("[playground-boundaries] Verified " + assets.size + " assets across all three target dependency closures.");
