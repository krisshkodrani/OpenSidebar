import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const tokens = JSON.parse(
  readFileSync(resolve(root, "packages/ui-tokens/tokens.json"), "utf8"),
);
const declarations = (colors) =>
  Object.entries(colors)
    .map(([name, value]) => `  --os-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}: ${value};`)
    .join("\n");
const css = `/* Generated from tokens.json by scripts/build-ui-tokens.mjs. */\n:root {\n${declarations(tokens.colors)}\n}\n:root.dark {\n${declarations(tokens.darkColors)}\n}\n`;
const destination = resolve(root, "packages/ui-tokens/theme.css");

if (process.argv.includes("--check")) {
  if (readFileSync(destination, "utf8") !== css) {
    console.error("UI token CSS is stale. Run node scripts/build-ui-tokens.mjs.");
    process.exitCode = 1;
  }
} else {
  writeFileSync(destination, css);
}
