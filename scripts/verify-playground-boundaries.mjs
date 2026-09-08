#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const dist = path.join(root, "apps", "sandbox", "dist");
for (const file of ["index.html", "target.html", "scenario-target.html"]) {
  if (!existsSync(path.join(dist, file)))
    throw new Error(`Missing Playground build artifact ${file}.`);
}
const control = readFileSync(path.join(dist, "index.html"), "utf8");
const target = readFileSync(path.join(dist, "target.html"), "utf8");
const scenarioTarget = readFileSync(
  path.join(dist, "scenario-target.html"),
  "utf8",
);
const controlSourceFiles = [
  "main.tsx",
  "account.tsx",
  "app/AppShell.tsx",
  "app/control-providers.tsx",
  "app/theme.ts",
  "app/ui.tsx",
];
const controlSources = controlSourceFiles.map((file) => ({
  file,
  body: readFileSync(
    path.join(root, "apps", "sandbox", "src", ...file.split("/")),
    "utf8",
  ),
}));
const controlSource = controlSources.map(({ body }) => body).join("\n");
for (const token of [
  "./styles.css",
  "./guide.css",
  "account-secret-input",
  "account-preferences",
]) {
  if (controlSource.includes(token))
    throw new Error(
      `Control Center source still contains legacy presentation token ${token}.`,
    );
}
for (const { file, body } of controlSources) {
  const rawColor = body.match(/#[0-9a-f]{3,8}\b/i);
  if (rawColor)
    throw new Error(
      `Control Center source ${file} contains raw color ${rawColor[0]}; use a theme or semantic token.`,
    );
}
if (!control.includes("/playground/assets/control-"))
  throw new Error(
    "Control Center entry is missing its isolated control bundle.",
  );
if (!target.includes("/playground/assets/target-"))
  throw new Error("Target entry is missing its isolated target bundle.");
if (target.includes("control-"))
  throw new Error("Target HTML references a Control Center bundle.");
if (!scenarioTarget.includes("/playground/assets/scenarioTarget-"))
  throw new Error("ModelBench target entry is missing its isolated bundle.");
if (scenarioTarget.includes("control-"))
  throw new Error("ModelBench target HTML references a Control Center bundle.");

const assetDir = path.join(dist, "playground", "assets");
const targetAssets = readdirSync(assetDir).filter(
  (name) =>
    name.startsWith("target-") ||
    name.startsWith("target-api-") ||
    name.startsWith("scenarioTarget-"),
);
const forbidden = [
  "ChakraProvider",
  "QueryClient",
  "__Host-os_session",
  "os_csrf",
  "/api/v1/playground",
  "opensidebar:sandbox:runs",
];
for (const name of targetAssets) {
  const body = readFileSync(path.join(assetDir, name), "utf8");
  for (const token of forbidden)
    if (body.includes(token))
      throw new Error(
        `Target asset ${name} contains forbidden Control Center token ${token}.`,
      );
}
console.log(
  `[playground-boundaries] Verified ${targetAssets.length} isolated target assets.`,
);
