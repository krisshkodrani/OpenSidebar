import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const tokens = JSON.parse(
  readFileSync(resolve(root, "packages/ui-tokens/tokens.json"), "utf8"),
);

// Each role becomes an RGB triplet so Tailwind opacity modifiers work:
// `rgb(var(--os-fg) / <alpha-value>)`.
const kebab = (name) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const triplet = (hex) =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(" ");
const declarations = (colors) =>
  Object.entries(colors)
    .map(([name, value]) => `  --os-${kebab(name)}: ${triplet(value)};`)
    .join("\n");

const css = `/* Generated from tokens.json by scripts/build-ui-tokens.mjs. */\n:root {\n  color-scheme: light;\n${declarations(tokens.light)}\n}\n:root.dark {\n  color-scheme: dark;\n${declarations(tokens.dark)}\n}\n`;
const destination = resolve(root, "packages/ui-tokens/theme.css");

if (process.argv.includes("--check")) {
  if (readFileSync(destination, "utf8") !== css) {
    console.error("UI token CSS is stale. Run node scripts/build-ui-tokens.mjs.");
    process.exitCode = 1;
  }
} else {
  writeFileSync(destination, css);
}
